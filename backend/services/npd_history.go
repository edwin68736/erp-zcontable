package services

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"miappfiber/database"
	"miappfiber/models"
)

const npdHistoryKeep = 100 // consultas que se conservan por empresa

// RecordHistory guarda una consulta (acertada o fallida) en el historial de la empresa y devuelve su id.
// `res` es nil cuando la consulta falló (`qerr`). Nunca interrumpe la consulta: si no se puede guardar, devuelve 0.
func (s *SunatNpdService) RecordHistory(companyID, userID uint, desde, hasta string, res *NPDResult, qerr error) uint {
	row := models.NpdHistory{CompanyID: companyID, Desde: truncateStr(desde, 10), Hasta: truncateStr(hasta, 10), RequestedBy: userID}
	switch {
	case qerr != nil:
		row.Status = models.NpdHistoryFailed
		var ae *SunatSolAccessError
		if errors.As(qerr, &ae) {
			row.ErrorCode, row.ErrorMessage, row.ErrorDetail = truncateStr(ae.Code, 40), truncateStr(ae.Message, 600), truncateStr(ae.Detail, 600)
		} else {
			row.ErrorMessage = "No se pudo completar la consulta."
		}
	case res != nil:
		row.Total, row.TotalImporte, row.Vigentes, row.ImporteVigente = res.Total, res.TotalImporte, res.Vigentes, res.ImporteVigente
		row.Status = models.NpdHistoryReady
		if row.Total == 0 {
			row.Status = models.NpdHistoryNoData
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
	if err := database.DB.Model(&models.NpdHistory{}).Where("company_id = ?", companyID).
		Order("created_at DESC, id DESC").Offset(npdHistoryKeep).Pluck("id", &ids).Error; err == nil && len(ids) > 0 {
		_ = database.DB.Where("id IN ?", ids).Delete(&models.NpdHistory{}).Error
	}
	return row.ID
}

// ListHistory historial de la empresa (lo más reciente primero), sin los resultados.
func (s *SunatNpdService) ListHistory(companyID uint) ([]models.NpdHistory, error) {
	var rows []models.NpdHistory
	err := database.DB.Omit("data").Where("company_id = ?", companyID).Order("created_at DESC, id DESC").Limit(npdHistoryKeep).Find(&rows).Error
	return rows, err
}

// GetHistory el resultado guardado de una consulta (para mostrarlo sin consultar a SUNAT).
func (s *SunatNpdService) GetHistory(companyID, id uint) (*models.NpdHistory, *NPDResult, error) {
	var row models.NpdHistory
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
	var res NPDResult
	if err != nil || json.Unmarshal(raw, &res) != nil {
		return &row, nil, accessErr(SunatAccessUnexpected, "No se pudo leer el resultado guardado.", "json")
	}
	return &row, &res, nil
}

// DeleteHistory quita una consulta del historial.
func (s *SunatNpdService) DeleteHistory(companyID, id uint) error {
	res := database.DB.Where("id = ? AND company_id = ?", id, companyID).Delete(&models.NpdHistory{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return accessErr(SunatAccessInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	return nil
}

// ClearHistory vacía el historial de la empresa y devuelve cuántas consultas quitó.
func (s *SunatNpdService) ClearHistory(companyID uint) (int64, error) {
	res := database.DB.Where("company_id = ?", companyID).Delete(&models.NpdHistory{})
	return res.RowsAffected, res.Error
}
