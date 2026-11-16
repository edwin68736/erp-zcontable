package services

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"

	"miappfiber/database"
	"miappfiber/models"
)

const itfHistoryKeep = 100 // consultas que se conservan por empresa

// RecordHistory guarda una consulta (acertada o fallida) en el historial de la empresa y devuelve su id.
// `res` es nil cuando la consulta falló (`qerr`). Nunca interrumpe la consulta: si no se puede guardar, devuelve 0.
func (s *SunatItfService) RecordHistory(companyID, userID uint, desde, hasta string, res *ITFResult, qerr error) uint {
	row := models.ItfHistory{CompanyID: companyID, Desde: truncateStr(desde, 6), Hasta: truncateStr(hasta, 6), RequestedBy: userID}
	switch {
	case qerr != nil:
		row.Status = models.ItfHistoryFailed
		var ae *SunatSolAccessError
		if errors.As(qerr, &ae) {
			row.ErrorCode, row.ErrorMessage, row.ErrorDetail = truncateStr(ae.Code, 40), truncateStr(ae.Message, 600), truncateStr(ae.Detail, 600)
		} else {
			row.ErrorMessage = "No se pudo completar la consulta."
		}
	case res != nil:
		row.Total = res.Total()
		row.Status = models.ItfHistoryReady
		if row.Total == 0 {
			row.Status = models.ItfHistoryNoData
		}
		if res.Acumulados.TotalImpuesto != nil {
			row.TotalImpuesto = *res.Acumulados.TotalImpuesto
		}
		if res.Acumulados.TotalMovimientos != nil {
			row.TotalMovimientos = *res.Acumulados.TotalMovimientos
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
	if err := database.DB.Model(&models.ItfHistory{}).Where("company_id = ?", companyID).
		Order("created_at DESC, id DESC").Offset(itfHistoryKeep).Pluck("id", &ids).Error; err == nil && len(ids) > 0 {
		_ = database.DB.Where("id IN ?", ids).Delete(&models.ItfHistory{}).Error
	}
	return row.ID
}

// ListHistory historial de la empresa (lo más reciente primero), sin los resultados.
func (s *SunatItfService) ListHistory(companyID uint) ([]models.ItfHistory, error) {
	var rows []models.ItfHistory
	err := database.DB.Omit("data").Where("company_id = ?", companyID).Order("created_at DESC, id DESC").Limit(itfHistoryKeep).Find(&rows).Error
	return rows, err
}

// GetHistory el resultado guardado de una consulta (para mostrarlo sin consultar a SUNAT).
func (s *SunatItfService) GetHistory(companyID, id uint) (*models.ItfHistory, *ITFResult, error) {
	var row models.ItfHistory
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
	var res ITFResult
	if err != nil || json.Unmarshal(raw, &res) != nil {
		return &row, nil, accessErr(SunatAccessUnexpected, "No se pudo leer el resultado guardado.", "json")
	}
	return &row, &res, nil
}

// DeleteHistory quita una consulta del historial.
func (s *SunatItfService) DeleteHistory(companyID, id uint) error {
	res := database.DB.Where("id = ? AND company_id = ?", id, companyID).Delete(&models.ItfHistory{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return accessErr(SunatAccessInvalidParams, "No se encontró esa consulta.", fmt.Sprint(id))
	}
	return nil
}

// ClearHistory vacía el historial de la empresa y devuelve cuántas consultas quitó.
func (s *SunatItfService) ClearHistory(companyID uint) (int64, error) {
	res := database.DB.Where("company_id = ?", companyID).Delete(&models.ItfHistory{})
	return res.RowsAffected, res.Error
}

// itfTableTotals suma las columnas Base e Impuesto de una tabla del resultado leyendo los importes en el formato de SUNAT.
func itfTableTotals(t *ITFTable) (impuesto, base float64, ok bool) {
	ib, ii := -1, -1
	for i, c := range t.Columnas {
		switch strings.ToLower(strings.TrimSpace(c)) {
		case "base":
			ib = i
		case "impuesto":
			ii = i
		}
	}
	if ib < 0 || ii < 0 {
		return 0, 0, false
	}
	for _, f := range t.Filas {
		if ib < len(f) {
			if v, k := parseSunatAmount(f[ib]); k {
				base += v
			}
		}
		if ii < len(f) {
			if v, k := parseSunatAmount(f[ii]); k {
				impuesto += v
			}
		}
	}
	return math.Round(impuesto*100) / 100, math.Round(base*100) / 100, true
}

// RepairItfHistoryAmounts corrige las consultas de ITF guardadas antes de leer bien el formato peruano de los importes
// («78.000,00» se guardaba como 78 y «3,90» como 390): recalcula los totales desde las filas guardadas. Se puede repetir sin
// riesgo (el resultado es el mismo) y devuelve cuántas consultas cambió.
func RepairItfHistoryAmounts() (int, error) {
	var rows []models.ItfHistory
	if err := database.DB.Where("data IS NOT NULL AND status IN ?", []string{models.ItfHistoryReady, models.ItfHistoryNoData}).Find(&rows).Error; err != nil {
		return 0, err
	}
	fixed := 0
	for _, row := range rows {
		zr, err := gzip.NewReader(bytes.NewReader(row.Data))
		if err != nil {
			continue
		}
		raw, rerr := io.ReadAll(io.LimitReader(zr, 64<<20))
		_ = zr.Close()
		var res ITFResult
		if rerr != nil || json.Unmarshal(raw, &res) != nil {
			continue
		}
		changed := false
		for _, t := range []*ITFTable{&res.Acumulados, &res.ContraAsientos, &res.Exoneraciones} {
			imp, base, ok := itfTableTotals(t)
			if !ok || len(t.Filas) == 0 {
				continue
			}
			if t.TotalImpuesto == nil || *t.TotalImpuesto != imp || t.TotalMovimientos == nil || *t.TotalMovimientos != base {
				t.TotalImpuesto, t.TotalMovimientos = &imp, &base
				changed = true
			}
		}
		if !changed {
			continue
		}
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		if err := json.NewEncoder(zw).Encode(&res); err != nil || zw.Close() != nil {
			continue
		}
		upd := map[string]any{"data": buf.Bytes()}
		if res.Acumulados.TotalImpuesto != nil {
			upd["total_impuesto"] = *res.Acumulados.TotalImpuesto
		}
		if res.Acumulados.TotalMovimientos != nil {
			upd["total_movimientos"] = *res.Acumulados.TotalMovimientos
		}
		if err := database.DB.Model(&models.ItfHistory{}).Where("id = ?", row.ID).Updates(upd).Error; err == nil {
			fixed++
		}
	}
	return fixed, nil
}
