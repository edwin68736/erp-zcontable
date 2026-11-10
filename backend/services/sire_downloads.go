package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"
)

// Historial de descargas del SIRE de una empresa: cada consulta (propuesta de ventas o compras de un período) se
// procesa en segundo plano —pide el archivo a SUNAT, espera el ticket, lo convierte a Excel— y el resultado queda
// guardado para volver a bajarlo sin consultar otra vez a SUNAT.

const (
	SireDownloadModeNoGlosas = "sin_glosas"

	sireDlPollEvery     = 3 * time.Second
	sireDlMaxWait       = 5 * time.Minute
	sireDlStaleAfter    = 10 * time.Minute // un "en proceso" más viejo se da por interrumpido (p. ej. se reinició el servidor)
	sireDlRetention     = 60 * 24 * time.Hour
	sireDlMaxConcurrent = 4
)

// Tope global de consultas a SUNAT en paralelo.
var sireDlSem = make(chan struct{}, sireDlMaxConcurrent)

// sireDlPollInterval se puede reemplazar en pruebas.
var sireDlPollInterval = sireDlPollEvery

type sireDlTickets struct {
	Registros []struct {
		NumTicket        string
		CodEstadoProceso string
		CodProceso       string
		PerTributario    string
		ArchivoReporte   []struct {
			NomArchivoReporte     string
			CodTipoAchivoReporte  string
			CodTipoArchivoReporte string
		}
	}
}

// StartDownload registra la consulta y la procesa en segundo plano. Si ya hay una igual en proceso devuelve esa.
func (s *SireService) StartDownload(ss *SireSession, companyID, userID uint, libro, period, mode string) (*models.SireDownload, error) {
	libro = strings.ToLower(strings.TrimSpace(libro))
	period, mode = strings.TrimSpace(period), strings.TrimSpace(mode)
	if mode == "" {
		mode = SireDownloadModeNoGlosas
	}
	if mode != SireDownloadModeNoGlosas {
		return nil, sireErr(SireErrInvalidParams, "Por ahora solo está disponible la descarga sin glosas.", mode)
	}
	if e := sireCheckLibroPeriod(libro, period); e != nil {
		return nil, e
	}

	s.expireStaleDownloads(companyID)
	var dup models.SireDownload
	if err := database.DB.Omit("data").Where("company_id = ? AND libro = ? AND period = ? AND mode = ? AND status = ?",
		companyID, libro, period, mode, models.SireDownloadProcessing).First(&dup).Error; err == nil {
		return &dup, nil
	}

	row := models.SireDownload{CompanyID: companyID, Libro: libro, Period: period, Mode: mode, Status: models.SireDownloadProcessing, Step: "solicitando", RequestedBy: userID}
	if err := database.DB.Create(&row).Error; err != nil {
		return nil, err
	}
	// Mantenimiento: lo muy viejo se borra solo.
	database.DB.Where("company_id = ? AND status <> ? AND created_at < ?", companyID, models.SireDownloadProcessing, time.Now().Add(-sireDlRetention)).Delete(&models.SireDownload{})

	go s.runDownload(ss, row.ID, userID)
	return &row, nil
}

func (s *SireService) updateDownload(id uint, fields map[string]any) {
	database.DB.Model(&models.SireDownload{}).Where("id = ?", id).Updates(fields)
}

func (s *SireService) failDownload(id uint, userID uint, companyID uint, err error) {
	var se *SireError
	if !errors.As(err, &se) {
		se = sireErr(SireErrUnexpected, "No se pudo completar la descarga.", err.Error())
	}
	now := time.Now()
	s.updateDownload(id, map[string]any{
		"status": models.SireDownloadFailed, "step": "", "error_code": se.Code,
		"error_message": truncate(se.Message, 600), "error_detail": truncate(se.Detail, 600), "finished_at": now,
	})
	s.LogAccessTarget(sireAccessTarget, companyID, userID, se)
}

// runDownload pide la propuesta a SUNAT, espera el ticket y guarda el Excel (o el motivo por el que no hay).
func (s *SireService) runDownload(ss *SireSession, id, userID uint) {
	sireDlSem <- struct{}{}
	defer func() { <-sireDlSem }()

	var row models.SireDownload
	if err := database.DB.Omit("data").First(&row, id).Error; err != nil {
		return // la borraron antes de empezar
	}
	fail := func(err error) { s.failDownload(id, userID, row.CompanyID, err) }

	ticket, err := ss.RequestTicket(row.Libro, "propuesta", row.Period, map[string]string{})
	if err != nil {
		fail(err)
		return
	}
	s.updateDownload(id, map[string]any{"ticket": ticket, "step": "esperando"})

	deadline := time.Now().Add(sireDlMaxWait)
	var (
		procCode string
		fileName string
		fileType string
	)
	for {
		time.Sleep(sireDlPollInterval)
		res, terr := ss.Tickets(row.Libro, row.Period, row.Period, 1, 5, ticket)
		if terr != nil {
			fail(terr)
			return
		}
		b, _ := json.Marshal(res)
		var tr sireDlTickets
		_ = json.Unmarshal(b, &tr)
		done := false
		for _, r := range tr.Registros {
			if r.NumTicket != ticket {
				continue
			}
			switch r.CodEstadoProceso {
			case "06", "04":
				done, procCode = true, r.CodProceso
				for _, a := range r.ArchivoReporte {
					if a.NomArchivoReporte != "" {
						fileName = a.NomArchivoReporte
						fileType = a.CodTipoAchivoReporte
						if fileType == "" {
							fileType = a.CodTipoArchivoReporte
						}
						break
					}
				}
			case "03":
				fail(sireErr(SireErrValidation, "SUNAT no pudo generar la propuesta de este período (terminó con errores).", "ticket "+ticket+" en estado 03"))
				return
			}
		}
		if done {
			break
		}
		if time.Now().After(deadline) {
			fail(sireErr(SireErrUnavailable, "SUNAT tarda en preparar el archivo. Intente de nuevo en unos minutos.", "ticket "+ticket+" sin terminar"))
			return
		}
	}

	finish := func(fields map[string]any) {
		now := time.Now()
		fields["step"], fields["finished_at"] = "", now
		s.updateDownload(id, fields)
		// Lo anterior de la misma consulta queda reemplazado por este resultado.
		database.DB.Where("company_id = ? AND libro = ? AND period = ? AND mode = ? AND id <> ? AND status <> ?",
			row.CompanyID, row.Libro, row.Period, row.Mode, id, models.SireDownloadProcessing).Delete(&models.SireDownload{})
	}

	if fileName == "" {
		finish(map[string]any{"status": models.SireDownloadNoData})
		s.LogAccessTarget(sireAccessTarget, row.CompanyID, userID, nil)
		return
	}
	s.updateDownload(id, map[string]any{"step": "generando"})
	data, ferr := ss.TicketFile(TicketFileParams{Libro: row.Libro, Name: fileName, TypeCode: fileType, Period: row.Period, Proceso: procCode, Ticket: ticket})
	if ferr != nil {
		// Un periodo sin comprobantes: SUNAT da el ticket por «Terminado» y anuncia un archivo, pero no lo genera y al
		// pedirlo responde el error 2244 «El archivo solicitado no existe». Es «sin movimientos», no un fallo.
		var se *SireError
		if errors.As(ferr, &se) && se.Code == SireErrValidation && strings.Contains(se.Detail, "2244") {
			finish(map[string]any{"status": models.SireDownloadNoData})
			s.LogAccessTarget(sireAccessTarget, row.CompanyID, userID, nil)
			return
		}
		fail(ferr)
		return
	}
	tables, perr := ParseSireArchive(data, fileName)
	if perr != nil {
		fail(sireErr(SireErrUnexpected, "No se pudo leer el archivo que entregó SUNAT.", perr.Error()))
		return
	}
	xlsx, rows, xerr := SireExcelFromTables(tables, row.Libro)
	if xerr != nil && len(tables) == 0 {
		finish(map[string]any{"status": models.SireDownloadNoData})
		return
	}
	if xerr != nil {
		fail(sireErr(SireErrUnexpected, "No se pudo generar el Excel con lo que entregó SUNAT.", xerr.Error()))
		return
	}
	if rows == 0 {
		finish(map[string]any{"status": models.SireDownloadNoData})
		s.LogAccessTarget(sireAccessTarget, row.CompanyID, userID, nil)
		return
	}
	finish(map[string]any{"status": models.SireDownloadReady, "rows": rows, "size": len(xlsx), "data": xlsx, "error_code": "", "error_message": "", "error_detail": ""})
	s.LogAccessTarget(sireAccessTarget, row.CompanyID, userID, nil)
}

// expireStaleDownloads da por interrumpidas las consultas que llevan demasiado "en proceso".
func (s *SireService) expireStaleDownloads(companyID uint) {
	database.DB.Model(&models.SireDownload{}).
		Where("company_id = ? AND status = ? AND created_at < ?", companyID, models.SireDownloadProcessing, time.Now().Add(-sireDlStaleAfter)).
		Updates(map[string]any{
			"status": models.SireDownloadFailed, "step": "", "error_code": "interrumpida",
			"error_message": "La consulta se interrumpió antes de terminar. Vuelva a pedirla.", "finished_at": time.Now(),
		})
}

// ListDownloads historial de la empresa (lo más reciente primero); libro vacío = ambos.
func (s *SireService) ListDownloads(companyID uint, libro string) ([]models.SireDownload, error) {
	s.expireStaleDownloads(companyID)
	q := database.DB.Omit("data").Where("company_id = ?", companyID)
	if l := strings.ToLower(strings.TrimSpace(libro)); l != "" {
		q = q.Where("libro = ?", l)
	}
	var rows []models.SireDownload
	if err := q.Order("created_at DESC, id DESC").Limit(200).Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// DownloadFile el Excel de una descarga lista y el nombre con que se entrega.
func (s *SireService) DownloadFile(companyID, id uint, ruc string) ([]byte, string, error) {
	var row models.SireDownload
	if err := database.DB.Where("id = ? AND company_id = ?", id, companyID).First(&row).Error; err != nil {
		return nil, "", sireErr(SireErrInvalidParams, "No se encontró esa descarga.", fmt.Sprint(id))
	}
	if row.Status != models.SireDownloadReady || len(row.Data) == 0 {
		return nil, "", sireErr(SireErrInvalidParams, "Esa consulta no tiene un Excel disponible.", row.Status)
	}
	return row.Data, SireExcelFileName(ruc, row.Period, row.Libro), nil
}

// DeleteDownload quita una descarga del historial.
func (s *SireService) DeleteDownload(companyID, id uint) error {
	res := database.DB.Where("id = ? AND company_id = ?", id, companyID).Delete(&models.SireDownload{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return sireErr(SireErrInvalidParams, "No se encontró esa descarga.", fmt.Sprint(id))
	}
	return nil
}

// ClearDownloads limpia el historial (menos lo que sigue en proceso); libro vacío = ambos. Devuelve cuántas quitó.
func (s *SireService) ClearDownloads(companyID uint, libro string) (int64, error) {
	s.expireStaleDownloads(companyID)
	q := database.DB.Where("company_id = ? AND status <> ?", companyID, models.SireDownloadProcessing)
	if l := strings.ToLower(strings.TrimSpace(libro)); l != "" {
		q = q.Where("libro = ?", l)
	}
	res := q.Delete(&models.SireDownload{})
	return res.RowsAffected, res.Error
}

// CompanyRUC valida que la empresa esté en el alcance del usuario (nil = todo el estudio) y devuelve su RUC.
func (s *SireService) CompanyRUC(companyID uint, allowed []uint) (string, error) {
	row, err := s.creds.GetByCompanyID(companyID, allowed)
	if err != nil {
		return "", sireErr(SireErrOutOfScope, "No tiene acceso a esta empresa.", err.Error())
	}
	return strings.TrimSpace(row.RUC), nil
}

// SaveCredentials registra el Client ID y el Client Secret de la API SIRE de la empresa (solo esos dos datos) y deja
// constancia en la bitácora de quién lo hizo. Los errores de validación se devuelven como parámetros inválidos.
func (s *SireService) SaveCredentials(companyID, userID uint, allowed []uint, clientID, clientSecret string) error {
	err := s.creds.SetSireCredentials(companyID, clientID, clientSecret, allowed)
	if err != nil {
		return sireErr(SireErrInvalidParams, err.Error(), "")
	}
	s.LogAccessTarget("sire_credenciales", companyID, userID, nil)
	return nil
}
