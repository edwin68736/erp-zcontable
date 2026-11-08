package services

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"miappfiber/database"
	"miappfiber/models"
)

// Historial de Herramientas → RH: cada consulta a SUNAT queda guardada con su resultado, para volver a verla sin
// consultar otra vez. Es de la empresa (no del usuario), igual que el historial del SIRE.

const rheHistoryKeep = 100 // consultas que se conservan por empresa (las más antiguas se van borrando)

// truncateStr corta a n bytes sin partir un carácter UTF-8 (MySQL rechazaría un texto cortado a medias).
func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// RecordRheHistory guarda una consulta (acertada o fallida) en el historial de la empresa y devuelve su id.
// `res` es nil cuando la consulta falló (`qerr`). Nunca interrumpe la consulta: si no se puede guardar, devuelve 0.
func (s *SireService) RecordRheHistory(companyID, userID uint, q RheQuery, res *RheResult, qerr error) uint {
	row := models.RheHistory{
		CompanyID: companyID, Tipo: strings.ToUpper(strings.TrimSpace(q.Tipo)), CodCpe: strings.TrimSpace(q.CodCpe),
		Desde: strings.TrimSpace(q.Desde), Hasta: strings.TrimSpace(q.Hasta), RequestedBy: userID,
		Estados: truncateStr(strings.Join(q.Estados, ","), 60),
	}
	if row.CodCpe == "" {
		row.CodCpe = "02"
	}
	if row.Tipo == "" {
		row.Tipo = RheTipoCompras
	}
	switch {
	case qerr != nil:
		row.Status = models.RheHistoryFailed
		var se *SireError
		if errors.As(qerr, &se) {
			row.ErrorCode, row.ErrorMessage, row.ErrorDetail = truncateStr(se.Code, 40), truncateStr(se.Message, 600), truncateStr(se.Detail, 600)
		} else {
			row.ErrorMessage = "No se pudo completar la consulta."
		}
	case res != nil:
		row.Total, row.Consultas, row.Truncado = res.Total, res.Consultas, res.Truncado
		row.Status = models.RheHistoryReady
		if res.Total == 0 {
			row.Status = models.RheHistoryNoData
		}
		row.Estados = truncateStr(strings.Join(res.Estados, ","), 60)
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		if err := json.NewEncoder(zw).Encode(res); err != nil || zw.Close() != nil {
			return 0
		}
		row.Data = buf.Bytes()
	default:
		return 0
	}
	if err := database.DB.Create(&row).Error; err != nil {
		return 0
	}
	// Se conservan solo las últimas consultas de la empresa.
	var ids []uint
	if err := database.DB.Model(&models.RheHistory{}).Where("company_id = ?", companyID).
		Order("created_at DESC, id DESC").Offset(rheHistoryKeep).Pluck("id", &ids).Error; err == nil && len(ids) > 0 {
		_ = database.DB.Where("id IN ?", ids).Delete(&models.RheHistory{}).Error
	}
	return row.ID
}

// ListRheHistory historial de la empresa (lo más reciente primero), sin los resultados.
func (s *SireService) ListRheHistory(companyID uint) ([]models.RheHistory, error) {
	var rows []models.RheHistory
	err := database.DB.Omit("data").Where("company_id = ?", companyID).Order("created_at DESC, id DESC").Limit(rheHistoryKeep).Find(&rows).Error
	return rows, err
}

// GetRheHistory el resultado guardado de una consulta (para mostrarlo sin consultar a SUNAT).
func (s *SireService) GetRheHistory(companyID, id uint) (*models.RheHistory, *RheResult, error) {
	var row models.RheHistory
	if err := database.DB.Where("id = ? AND company_id = ?", id, companyID).First(&row).Error; err != nil {
		return nil, nil, sireErr(SireErrInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	if len(row.Data) == 0 {
		return &row, nil, nil
	}
	zr, err := gzip.NewReader(bytes.NewReader(row.Data))
	if err != nil {
		return &row, nil, sireErr(SireErrInvalidParams, "No se pudo leer el resultado guardado.", "gzip")
	}
	defer zr.Close()
	raw, err := io.ReadAll(io.LimitReader(zr, 64<<20))
	var res RheResult
	if err != nil || json.Unmarshal(raw, &res) != nil {
		return &row, nil, sireErr(SireErrInvalidParams, "No se pudo leer el resultado guardado.", "json")
	}
	return &row, &res, nil
}

// DeleteRheHistory quita una consulta del historial.
func (s *SireService) DeleteRheHistory(companyID, id uint) error {
	res := database.DB.Where("id = ? AND company_id = ?", id, companyID).Delete(&models.RheHistory{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return sireErr(SireErrInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	return nil
}

// ClearRheHistory vacía el historial de la empresa y devuelve cuántas consultas quitó.
func (s *SireService) ClearRheHistory(companyID uint) (int64, error) {
	res := database.DB.Where("company_id = ?", companyID).Delete(&models.RheHistory{})
	return res.RowsAffected, res.Error
}
