package services

import (
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Notificaciones de SUNAT SIN LEER por empresa: lo que alimenta el aviso flotante y la campana. Cuentan solo las
// NOTIFICACIONES (tipo 2) que siguen en el buzón; los mensajes (tipo 1) son informativos y son la gran mayoría, así que
// avisarlos haría que el aviso se ignore.
//
// «Leído» lo decide SUNAT: el sistema nunca abre un mensaje (abrirlo lo marcaría como leído). Solo cambia cuando alguien
// lo abre en SUNAT, y el sistema se entera en la siguiente sincronización.

// BuzonUnreadCompany las notificaciones sin leer de una empresa.
type BuzonUnreadCompany struct {
	CompanyID    uint       `json:"company_id"`
	Code         string     `json:"code"`
	BusinessName string     `json:"business_name"`
	RUC          string     `json:"ruc"`
	Unread       int        `json:"unread"`
	Urgent       int        `json:"urgent"`
	Oldest       *time.Time `json:"oldest,omitempty"` // publicación de la más antigua sin leer
	LastSyncAt   *time.Time `json:"last_sync_at,omitempty"`
}

// BuzonUnreadSummary resumen para el aviso flotante, ya limitado al alcance de quien lo pide.
type BuzonUnreadSummary struct {
	Total     int                  `json:"total"`
	Urgent    int                  `json:"urgent"`
	Companies []BuzonUnreadCompany `json:"companies"`
	// Unchecked empresas del alcance que NO se pudieron revisar (credenciales rechazadas o error en la última
	// sincronización): ahí «sin avisos» no significa «sin notificaciones».
	Unchecked UncheckedBuzon `json:"unchecked"`
}

// UncheckedBuzon empresas que no se pudieron revisar, por motivo.
type UncheckedBuzon struct {
	Rejected int `json:"rejected"`
	Error    int `json:"error"`
}

// notifUnreadByCompany notificaciones sin leer de cada empresa dada.
func (s *SunatBuzonService) notifUnreadByCompany(companyIDs []uint) map[uint]int {
	out := map[uint]int{}
	if len(companyIDs) == 0 {
		return out
	}
	var rows []struct {
		CompanyID uint
		N         int
	}
	if err := database.DB.Model(&models.SunatBuzonMessage{}).
		Select("company_id, COUNT(*) AS n").
		Where("company_id IN ? AND tipo = ? AND leido = ? AND en_buzon = ?", companyIDs, 2, false, true).
		Group("company_id").Scan(&rows).Error; err != nil {
		return out
	}
	for _, r := range rows {
		out[r.CompanyID] = r.N
	}
	return out
}

// UnreadSummary notificaciones sin leer de las empresas del alcance (`allowed` nil = todo el estudio), de la empresa con
// más pendientes (urgentes primero) a la que menos. Solo empresas activas del estudio.
func (s *SunatBuzonService) UnreadSummary(allowed []uint) (*BuzonUnreadSummary, error) {
	res := &BuzonUnreadSummary{Companies: []BuzonUnreadCompany{}}
	if allowed != nil && len(allowed) == 0 {
		return res, nil
	}

	var rows []struct {
		CompanyID    uint
		Code         string
		BusinessName string
		RUC          string
		Unread       int
		Urgent       int
		Oldest       *string
	}
	q := database.DB.Table("sunat_buzon_messages AS m").
		Select("m.company_id AS company_id, c.internal_code AS code, c.business_name AS business_name, c.ruc AS ruc, "+
			"COUNT(*) AS unread, SUM(CASE WHEN m.urgente THEN 1 ELSE 0 END) AS urgent, MIN(m.fec_publica) AS oldest").
		Joins("JOIN companies c ON c.id = m.company_id").
		Where("m.tipo = ? AND m.leido = ? AND m.en_buzon = ? AND c.status = ? AND c.client_type = ? AND c.deleted_at IS NULL",
			2, false, true, "activo", models.CompanyClientTypeEstudio)
	if allowed != nil {
		q = q.Where("m.company_id IN ?", allowed)
	}
	if err := q.Group("m.company_id, c.internal_code, c.business_name, c.ruc").
		Order("urgent DESC, unread DESC, oldest ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}
	ids := make([]uint, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.CompanyID)
		res.Total += r.Unread
		res.Urgent += r.Urgent
		item := BuzonUnreadCompany{CompanyID: r.CompanyID, Code: r.Code, BusinessName: r.BusinessName, RUC: r.RUC, Unread: r.Unread, Urgent: r.Urgent}
		if r.Oldest != nil {
			if t, ok := parseDBTime(*r.Oldest); ok {
				item.Oldest = &t
			}
		}
		res.Companies = append(res.Companies, item)
	}
	if len(ids) > 0 {
		var syncs []models.SunatBuzonSync
		if err := database.DB.Select("company_id, last_success_at").Where("company_id IN ?", ids).Find(&syncs).Error; err == nil {
			at := map[uint]*time.Time{}
			for _, sy := range syncs {
				at[sy.CompanyID] = sy.LastSuccessAt
			}
			for i := range res.Companies {
				res.Companies[i].LastSyncAt = at[res.Companies[i].CompanyID]
			}
		}
	}

	// Empresas del alcance que no se pudieron revisar en la última sincronización.
	uq := database.DB.Table("sunat_buzon_syncs AS sy").
		Select("sy.status AS status, COUNT(*) AS n").
		Joins("JOIN companies c ON c.id = sy.company_id").
		Where("sy.status IN ? AND c.status = ? AND c.client_type = ? AND c.deleted_at IS NULL",
			[]string{models.SunatBuzonStatusRechazadas, models.SunatBuzonStatusError}, "activo", models.CompanyClientTypeEstudio)
	if allowed != nil {
		uq = uq.Where("sy.company_id IN ?", allowed)
	}
	var us []struct {
		Status string
		N      int
	}
	if err := uq.Group("sy.status").Scan(&us).Error; err == nil {
		for _, u := range us {
			if u.Status == models.SunatBuzonStatusRechazadas {
				res.Unchecked.Rejected = u.N
			} else {
				res.Unchecked.Error = u.N
			}
		}
	}
	return res, nil
}

// parseDBTime las fechas que devuelve una consulta cruda llegan como texto según el motor (MySQL / SQLite).
func parseDBTime(s string) (time.Time, bool) {
	for _, layout := range []string{"2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05", time.RFC3339, "2006-01-02T15:04:05Z07:00", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
