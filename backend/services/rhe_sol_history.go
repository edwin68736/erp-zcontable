package services

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"miappfiber/database"
	"miappfiber/models"
)

const rheSolHistoryKeep = 100 // consultas que se conservan por empresa

// RecordHistory guarda una consulta (acertada o fallida) en el historial de la empresa y devuelve su id.
// `res` es nil cuando la consulta falló (`qerr`). Nunca interrumpe la consulta: si no se puede guardar, devuelve 0.
func (s *RheSolService) RecordHistory(companyID, userID uint, lado, desde, hasta string, res *RheSolResult, qerr error) uint {
	lado, _ = RheSolNormalizeLado(lado)
	row := models.RheSolHistory{CompanyID: companyID, Lado: lado, Desde: truncateStr(desde, 10), Hasta: truncateStr(hasta, 10), RequestedBy: userID}
	switch {
	case qerr != nil:
		row.Status = models.RheSolHistoryFailed
		var ae *SunatSolAccessError
		if errors.As(qerr, &ae) {
			row.ErrorCode, row.ErrorMessage, row.ErrorDetail = truncateStr(ae.Code, 40), truncateStr(ae.Message, 600), truncateStr(ae.Detail, 600)
		} else {
			row.ErrorMessage = "No se pudo completar la consulta."
		}
	case res != nil:
		row.Total, row.Consultas, row.Truncado = res.Total, res.Consultas, res.Truncado
		row.Status = models.RheSolHistoryReady
		if row.Total == 0 {
			row.Status = models.RheSolHistoryNoData
		}
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
	var ids []uint
	if err := database.DB.Model(&models.RheSolHistory{}).Where("company_id = ? AND lado = ?", companyID, lado).
		Order("created_at DESC, id DESC").Offset(rheSolHistoryKeep).Pluck("id", &ids).Error; err == nil && len(ids) > 0 {
		_ = database.DB.Where("id IN ?", ids).Delete(&models.RheSolHistory{}).Error
	}
	return row.ID
}

// ListHistory historial de la empresa para un lado (lo más reciente primero), sin los resultados.
func (s *RheSolService) ListHistory(companyID uint, lado string) ([]models.RheSolHistory, error) {
	q := database.DB.Omit("data").Where("company_id = ?", companyID)
	if !strings.EqualFold(strings.TrimSpace(lado), "todos") { // «todos»: recibidos y emitidos juntos
		lado, _ = RheSolNormalizeLado(lado)
		q = q.Where("lado = ?", lado)
	}
	var rows []models.RheSolHistory
	err := q.Order("created_at DESC, id DESC").Limit(rheSolHistoryKeep).Find(&rows).Error
	return rows, err
}

// RecordDownloads deja anotado qué se descargó de una consulta del historial (para mostrarlo en la lista).
func (s *RheSolService) RecordDownloads(companyID, id uint, pdf, xml int, txt, excel bool) error {
	if pdf < 0 || xml < 0 {
		return accessErr(SunatAccessInvalidParams, "Cantidades no válidas.", "")
	}
	res := database.DB.Model(&models.RheSolHistory{}).Where("id = ? AND company_id = ?", id, companyID).
		Updates(map[string]any{"dl_pdf": pdf, "dl_xml": xml, "dl_txt": txt, "dl_excel": excel})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return accessErr(SunatAccessInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	return nil
}

// GetHistory el resultado guardado de una consulta (para mostrarlo sin consultar a SUNAT).
func (s *RheSolService) GetHistory(companyID, id uint) (*models.RheSolHistory, *RheSolResult, error) {
	var row models.RheSolHistory
	if err := database.DB.Where("id = ? AND company_id = ?", id, companyID).First(&row).Error; err != nil {
		return nil, nil, accessErr(SunatAccessInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	if len(row.Data) == 0 {
		return &row, nil, nil
	}
	zr, err := gzip.NewReader(bytes.NewReader(row.Data))
	if err != nil {
		return &row, nil, accessErr(SunatAccessUnexpected, "No se pudo leer el resultado guardado.", "gzip")
	}
	defer zr.Close()
	raw, err := io.ReadAll(io.LimitReader(zr, 64<<20))
	var res RheSolResult
	if err != nil || json.Unmarshal(raw, &res) != nil {
		return &row, nil, accessErr(SunatAccessUnexpected, "No se pudo leer el resultado guardado.", "json")
	}
	return &row, &res, nil
}

// DeleteHistory quita una consulta del historial.
func (s *RheSolService) DeleteHistory(companyID, id uint) error {
	res := database.DB.Where("id = ? AND company_id = ?", id, companyID).Delete(&models.RheSolHistory{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return accessErr(SunatAccessInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	return nil
}

// ClearHistory vacía el historial de la empresa y devuelve cuántas consultas quitó.
func (s *RheSolService) ClearHistory(companyID uint) (int64, error) {
	res := database.DB.Where("company_id = ?", companyID).Delete(&models.RheSolHistory{})
	return res.RowsAffected, res.Error
}
