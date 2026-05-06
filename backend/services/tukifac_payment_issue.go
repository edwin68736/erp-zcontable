package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"
)

// SUNAT tipo de ítem en payloads Tukifac: 01 mercadería/bien, 02 servicio (líneas libres = siempre 02).
const (
	tukifacCodigoTipoItemProducto = "01"
	tukifacCodigoTipoItemServicio = "02"
	// tukifacSaleNotePrefix: Tukifac persiste `sale_notes.prefix` (NOT NULL); serie documental nota de venta.
	tukifacSaleNotePrefix = "NV"
)

// tukifacPeruTZ calendario y hora de emisión hacia Tukifac (SUNAT / negocio en Perú).
var tukifacPeruTZ = sync.OnceValue(func() *time.Location {
	loc, err := time.LoadLocation("America/Lima")
	if err != nil {
		return time.UTC
	}
	return loc
})

// tukifacCodigoTipoItemForDocumentDebt decide 01 vs 02 según líneas del documento.
// products.product_kind en este sistema es siempre "product" o "service" (inglés).
// - Sin ítems o solo líneas libres (sin product_id) → 02.
// - Catálogo: unit_type_id ZZ o product_kind service → 02; product_kind product con unidad distinta de ZZ (p. ej. NIU) → 01.
func tukifacCodigoTipoItemForDocumentDebt(doc *models.Document) string {
	if doc == nil {
		return tukifacCodigoTipoItemServicio
	}
	items := append([]models.DocumentItem(nil), doc.Items...)
	sort.Slice(items, func(i, j int) bool { return items[i].SortOrder < items[j].SortOrder })
	sawCatalog := false
	for _, it := range items {
		if it.ProductID == nil || it.Product == nil {
			continue
		}
		sawCatalog = true
		p := it.Product
		ut := strings.ToUpper(strings.TrimSpace(p.UnitTypeID))
		k := strings.TrimSpace(p.ProductKind)
		if ut == "ZZ" || k == "service" {
			continue
		}
		if k == "product" || ut == "NIU" {
			return tukifacCodigoTipoItemProducto
		}
		if ut != "" {
			return tukifacCodigoTipoItemProducto
		}
	}
	if !sawCatalog {
		return tukifacCodigoTipoItemServicio
	}
	return tukifacCodigoTipoItemServicio
}

// tukifacUnidadMedidaFromDocument devuelve código SUNAT de unidad (ZZ servicio, NIU unidad, etc.) para líneas Tukifac.
// - Si el producto (manual o sincronizado desde el módulo de productos) tiene unit_type_id, se usa tal cual (NIU, ZZ, …).
// - Si no hay unidad guardada: servicio → ZZ; producto u otro → ZZ por defecto (operación habitual); NIU solo llega por catálogo explícito.
// - Sin líneas con producto: ZZ (deudas / liquidaciones mayormente servicios).
func tukifacUnidadMedidaFromDocument(d *models.Document) string {
	if d == nil {
		return "ZZ"
	}
	items := append([]models.DocumentItem(nil), d.Items...)
	sort.Slice(items, func(i, j int) bool { return items[i].SortOrder < items[j].SortOrder })
	for i := range items {
		p := items[i].Product
		if p == nil {
			continue
		}
		if u := strings.TrimSpace(strings.ToUpper(p.UnitTypeID)); u != "" {
			return u
		}
		kind := strings.TrimSpace(strings.ToLower(p.ProductKind))
		if kind == "service" {
			return "ZZ"
		}
		// product (u otro) sin unit_type_id en BD: no inventar NIU; predominio servicios / evitar líneas mal rotuladas
		return "ZZ"
	}
	if len(items) > 0 {
		return "ZZ"
	}
	if strings.TrimSpace(d.ServiceMonth) != "" {
		return "ZZ"
	}
	return "ZZ"
}

// PaymentTukifacIssueInput emisión SUNAT desde un pago ya registrado (imputaciones = líneas del comprobante).
type PaymentTukifacIssueInput struct {
	Kind                 string `json:"kind"` // boleta | factura | sale_note
	SerieDocumento       string `json:"serie_documento"`
	SaleNoteSeriesID     uint   `json:"sale_note_series_id"`
	EstablishmentID      uint   `json:"establishment_id"` // nota de venta; si es 0 se usa TUKIFAC_ESTABLISHMENT_ID
	PaymentMethodTypeID  string `json:"payment_method_type_id"`
	PaymentDestinationID string `json:"payment_destination_id"`
	PaymentReference     string `json:"payment_reference"`
}

func roundMoney2(v float64) float64 {
	return math.Round(v*100) / 100
}

func peruDocIdentidadTipo(ruc string) string {
	s := strings.TrimSpace(ruc)
	if len(s) == 8 {
		return "1"
	}
	return "6"
}

func documentLineDescription(d *models.Document) string {
	if d == nil {
		return "Servicio"
	}
	desc := strings.TrimSpace(d.Description)
	if desc != "" {
		r := []rune(desc)
		if len(r) > 400 {
			return string(r[:400])
		}
		return desc
	}
	return strings.TrimSpace(fmt.Sprintf("%s %s", d.Type, d.Number))
}

func leyendaMontoSoles(total float64) string {
	cents := int64(math.Round(total * 100))
	sol := cents / 100
	cen := cents % 100
	if cen < 0 {
		cen = -cen
	}
	return fmt.Sprintf("SON: %d CON %02d/100 SOLES", sol, cen)
}

func receptorMapFromCompany(c *models.Company) map[string]interface{} {
	addr := strings.TrimSpace(c.Address)
	if addr == "" {
		addr = "-"
	}
	email := strings.TrimSpace(c.Email)
	tel := strings.TrimSpace(c.Phone)
	nombreCom := strings.TrimSpace(c.TradeName)
	return map[string]interface{}{
		"codigo_tipo_documento_identidad":    peruDocIdentidadTipo(c.RUC),
		"numero_documento":                   strings.TrimSpace(c.RUC),
		"apellidos_y_nombres_o_razon_social": strings.TrimSpace(c.BusinessName),
		"nombre_comercial":                   nombreCom,
		"codigo_pais":                        "PE",
		"ubigeo":                             "150101",
		"direccion":                          addr,
		"correo_electronico":                 email,
		"telefono":                           tel,
		"codigo_tipo_direccion":              nil,
	}
}

func buildSUNATDocumentItem(codigoInterno, descripcion string, cantidad float64, totalConIGV float64, unidadMedida string, codigoTipoItem string) map[string]interface{} {
	if codigoTipoItem != tukifacCodigoTipoItemProducto && codigoTipoItem != tukifacCodigoTipoItemServicio {
		codigoTipoItem = tukifacCodigoTipoItemServicio
	}
	um := strings.TrimSpace(strings.ToUpper(unidadMedida))
	if um == "" {
		um = "ZZ"
	}
	qty := cantidad
	if qty < 0.0001 {
		qty = 1
	}
	totalItem := roundMoney2(totalConIGV)
	base := roundMoney2(totalItem / 1.18)
	igv := roundMoney2(totalItem - base)
	uv := roundMoney2(base / qty)
	pu := roundMoney2(totalItem / qty)
	// Estructura alineada a PAYLOADS_API_DOCUMENTS_Y_SALE_NOTE.md §1.2 (sin objeto anidado `item`).
	return map[string]interface{}{
		"codigo_interno":                 codigoInterno,
		"descripcion":                    descripcion,
		"nombre":                         nil,
		"nombre_secundario":              nil,
		"codigo_tipo_item":               codigoTipoItem,
		"codigo_producto_sunat":          "90",
		"codigo_producto_gsl":            nil,
		"unidad_de_medida":               um,
		"cantidad":                       qty,
		"valor_unitario":                 uv,
		"codigo_tipo_precio":             "01",
		"precio_unitario":                pu,
		"codigo_tipo_afectacion_igv":     "10",
		"total_base_igv":                 base,
		"porcentaje_igv":                 18,
		"total_igv":                      igv,
		"codigo_tipo_sistema_isc":        nil,
		"total_base_isc":                 0,
		"porcentaje_isc":                 0,
		"total_isc":                      0,
		"total_base_otros_impuestos":     0,
		"porcentaje_otros_impuestos":     0,
		"total_otros_impuestos":          0,
		"total_impuestos_bolsa_plastica": 0,
		"total_impuestos":                igv,
		"total_valor_item":               base,
		"total_cargos":                   0,
		"total_descuentos":               0,
		"total_item":                     totalItem,
		"datos_adicionales":              []interface{}{},
		"descuentos":                     []interface{}{},
		"cargos":                         []interface{}{},
		"informacion_adicional":          nil,
		"lots":                           []interface{}{},
		"actualizar_descripcion":         true,
		"nombre_producto_pdf":            nil,
		"nombre_producto_xml":            nil,
		"dato_adicional":                 nil,
		"esFusionado":                    false,
	}
}

// buildSaleNoteItemForceCreate ítem para POST /api/sale-note con force_create_if_not_exist (ver doc §2.3).
// codigoTipoItem: strings SUNAT "01" (bien) / "02" (servicio); Tukifac espera item_type_id como string en JSON.
func buildSaleNoteItemForceCreate(internalID, desc string, totalConIGV float64, unidadMedida string, codigoTipoItem string) map[string]interface{} {
	if codigoTipoItem != tukifacCodigoTipoItemProducto && codigoTipoItem != tukifacCodigoTipoItemServicio {
		codigoTipoItem = tukifacCodigoTipoItemServicio
	}
	um := strings.TrimSpace(strings.ToUpper(unidadMedida))
	if um == "" {
		um = "ZZ"
	}
	totalItem := roundMoney2(totalConIGV)
	base := roundMoney2(totalItem / 1.18)
	igv := roundMoney2(totalItem - base)
	return map[string]interface{}{
		"id":                      nil,
		"internal_id":             internalID,
		"description":             desc,
		"item_type_id":            codigoTipoItem,
		"unit_type_id":            um,
		"currency_type_id":        "PEN",
		"unit_price":              totalItem,
		"unit_value":              base,
		"quantity":                1,
		"affectation_igv_type_id": "10",
		"total_base_igv":          base,
		"percentage_igv":          18,
		"total_igv":               igv,
		"system_isc_type_id":      nil,
		"total_base_isc":          0,
		"percentage_isc":          0,
		"total_isc":               0,
		"total_base_other_taxes":  0,
		"percentage_other_taxes":  0,
		"total_other_taxes":       0,
		"total_plastic_bag_taxes": 0,
		"total_taxes":             igv,
		"price_type_id":           "01",
		"total_value":             base,
		"total_charge":            0,
		"total_discount":          0,
		"total":                   totalItem,
		"attributes":              []interface{}{},
		"charges":                 []interface{}{},
		"discounts":               []interface{}{},
		"warehouse_id":            nil,
		"additional_information":  nil,
		"name_product_pdf":        nil,
		"item": map[string]interface{}{
			"description":      desc,
			"unit_type_id":     um,
			"has_igv":          true,
			"item_type_id":     codigoTipoItem,
			"currency_type_id": "PEN",
		},
	}
}

// tukifacPaymentReferenceContext texto para OC/leyendas del comprobante; fromSettlement indica liquidación emitida.
func tukifacPaymentReferenceContext(pay *models.Payment) (ref string, fromSettlement bool, err error) {
	if pay.TaxSettlementID != nil && *pay.TaxSettlementID > 0 {
		if pay.TaxSettlement == nil || pay.TaxSettlement.Status != models.TaxSettlementStatusIssued {
			return "", false, errors.New("la liquidación debe estar emitida")
		}
		fromSettlement = true
		if strings.TrimSpace(pay.TaxSettlement.Number) != "" {
			return strings.TrimSpace(pay.TaxSettlement.Number), fromSettlement, nil
		}
		return fmt.Sprintf("LI-%d", *pay.TaxSettlementID), fromSettlement, nil
	}
	if pay.Type != "applied" || len(pay.Allocations) == 0 {
		return "", false, errors.New("solo se puede emitir en Tukifac para pagos aplicados con imputación a deudas")
	}
	if len(pay.Allocations) == 1 {
		r := strings.TrimSpace(documentLineDescription(pay.Allocations[0].Document))
		if r == "" {
			r = fmt.Sprintf("Documento #%d", pay.Allocations[0].DocumentID)
		}
		return r, false, nil
	}
	return fmt.Sprintf("Pago %d · %d deuda(s)", pay.ID, len(pay.Allocations)), false, nil
}

// IssueComprobanteFromPayment construye el JSON según docs y lo envía a Tukifac (liquidación emitida o pago aplicado a deuda(s) sin liquidación).
func (s *TukifacService) IssueComprobanteFromPayment(paymentID uint, in PaymentTukifacIssueInput) (*models.TukifacFiscalReceipt, []byte, error) {
	kind := strings.ToLower(strings.TrimSpace(in.Kind))
	if kind != "boleta" && kind != "factura" && kind != "sale_note" {
		return nil, nil, errors.New("kind debe ser boleta, factura o sale_note")
	}

	var pay models.Payment
	if err := database.DB.
		Preload("Allocations.Document.Items.Product").
		Preload("TaxSettlement").
		First(&pay, paymentID).Error; err != nil {
		return nil, nil, errors.New("pago no encontrado")
	}

	settleRef, fromSettlement, err := tukifacPaymentReferenceContext(&pay)
	if err != nil {
		return nil, nil, err
	}
	if pay.Type != "applied" || len(pay.Allocations) == 0 {
		return nil, nil, errors.New("el pago debe estar aplicado con imputaciones a deudas")
	}

	var sumAlloc float64
	for _, a := range pay.Allocations {
		sumAlloc += a.Amount
	}
	if math.Abs(sumAlloc-pay.Amount) > 0.03 {
		return nil, nil, errors.New("las imputaciones no coinciden con el monto del pago")
	}

	var co models.Company
	if err := database.DB.First(&co, pay.CompanyID).Error; err != nil {
		return nil, nil, err
	}

	method := strings.TrimSpace(in.PaymentMethodTypeID)
	if method == "" {
		method = "01"
	}
	dest := strings.TrimSpace(in.PaymentDestinationID)
	if dest == "" {
		dest = "cash"
	}
	ref := strings.TrimSpace(in.PaymentReference)
	if ref == "" {
		ref = "Caja"
	}

	issueDate := pay.Date
	if issueDate.IsZero() {
		issueDate = time.Now()
	}
	lima := tukifacPeruTZ()
	dateStr := issueDate.In(lima).Format("2006-01-02")
	timeStr := issueDate.In(lima).Format("15:04:05")

	if kind == "sale_note" {
		if in.SaleNoteSeriesID == 0 {
			return nil, nil, errors.New("indique sale_note_series_id (serie numérica en Tukifac)")
		}
		estID := int(in.EstablishmentID)
		if estID <= 0 && config.AppConfig != nil {
			estID = config.AppConfig.TukifacEstablishmentID
		}
		if estID <= 0 {
			estID = 1
		}

		items := make([]interface{}, 0, len(pay.Allocations))
		var totalVenta, totalTaxed, totalIGV, totalTaxes, totalValue float64
		for _, a := range pay.Allocations {
			desc := documentLineDescription(a.Document)
			um := tukifacUnidadMedidaFromDocument(a.Document)
			cod := fmt.Sprintf("DEU-%d", a.DocumentID)
			t := roundMoney2(a.Amount)
			b := roundMoney2(t / 1.18)
			g := roundMoney2(t - b)
			items = append(items, buildSaleNoteItemForceCreate(cod, desc, a.Amount, um, tukifacCodigoTipoItemForDocumentDebt(a.Document)))
			totalVenta += t
			totalTaxed += b
			totalIGV += g
			totalTaxes += g
			totalValue += b
		}
		totalVenta = roundMoney2(totalVenta)
		totalTaxed = roundMoney2(totalTaxed)
		totalIGV = roundMoney2(totalIGV)
		totalTaxes = roundMoney2(totalTaxes)
		totalValue = roundMoney2(totalValue)
		if math.Abs(totalVenta-pay.Amount) > 0.03 {
			return nil, nil, errors.New("inconsistencia en montos del comprobante")
		}

		recMap := map[string]interface{}{
			"codigo_tipo_documento_identidad":    peruDocIdentidadTipo(co.RUC),
			"numero_documento":                   strings.TrimSpace(co.RUC),
			"apellidos_y_nombres_o_razon_social": strings.TrimSpace(co.BusinessName),
			"codigo_pais":                        "PE",
			"ubigeo":                             "150101",
			"direccion":                          strings.TrimSpace(co.Address),
			"correo_electronico":                 strings.TrimSpace(co.Email),
			"telefono":                           strings.TrimSpace(co.Phone),
		}
		if strings.TrimSpace(co.Address) == "" {
			recMap["direccion"] = "-"
		}

		// Formato PAYLOADS_API_DOCUMENTS_Y_SALE_NOTE.md §2.2 / §2.3 (currency_type_id, totales, customer_id 0 + receptor).
		payload := map[string]interface{}{
			"id":                           nil,
			"number":                       nil,
			"prefix":                       tukifacSaleNotePrefix,
			"series_id":                    in.SaleNoteSeriesID,
			"establishment_id":             estID,
			"customer_id":                  0,
			"date_of_issue":                dateStr,
			"time_of_issue":                timeStr,
			"currency_type_id":             "PEN",
			"exchange_rate_sale":           1,
			"force_create_if_not_exist":    true,
			"datos_del_cliente_o_receptor": recMap,
			"type_period":                  nil,
			"quantity_period":              0,
			"total_prepayment":             0,
			"total_discount":               0,
			"total_charge":                 0,
			"total_exportation":            0,
			"total_free":                   0,
			"total_taxed":                  totalTaxed,
			"total_unaffected":             0,
			"total_exonerated":             0,
			"total_igv":                    totalIGV,
			"total_base_isc":               0,
			"total_isc":                    0,
			"total_base_other_taxes":       0,
			"total_other_taxes":            0,
			"total_plastic_bag_taxes":      0,
			"total_taxes":                  totalTaxes,
			"total_value":                  totalValue,
			"total":                        totalVenta,
			"items":                        items,
			"payments": []interface{}{
				map[string]interface{}{
					"date_of_payment":        dateStr,
					"payment_method_type_id": method,
					"payment_destination_id": dest,
					"reference":              ref,
					"payment":                totalVenta,
					"payment_received":       totalVenta,
				},
			},
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, nil, err
		}
		rec, respBody, err := s.issueToTukifac(pay.CompanyID, raw, true)
		if err != nil {
			return nil, respBody, err
		}
		if err := s.LinkIssuedReceiptToPayment(rec, &pay); err != nil {
			return rec, respBody, err
		}
		return rec, respBody, nil
	}

	// factura / boleta (JSON documentos SUNAT)
	tipoDoc := "03"
	if kind == "factura" {
		tipoDoc = "01"
	}
	serie := strings.TrimSpace(in.SerieDocumento)
	if serie == "" {
		if tipoDoc == "01" {
			serie = "F001"
		} else {
			serie = "B001"
		}
	}

	items := make([]interface{}, 0, len(pay.Allocations))
	var totGrav float64
	var totIGV float64
	var totVenta float64
	for _, a := range pay.Allocations {
		desc := documentLineDescription(a.Document)
		cod := fmt.Sprintf("DEU-%d", a.DocumentID)
		um := tukifacUnidadMedidaFromDocument(a.Document)
		it := buildSUNATDocumentItem(cod, desc, 1, a.Amount, um, tukifacCodigoTipoItemForDocumentDebt(a.Document))
		items = append(items, it)
		t := roundMoney2(a.Amount)
		b := roundMoney2(t / 1.18)
		g := roundMoney2(t - b)
		totGrav += b
		totIGV += g
		totVenta += t
	}
	totGrav = roundMoney2(totGrav)
	totIGV = roundMoney2(totIGV)
	totVenta = roundMoney2(totVenta)
	if math.Abs(totVenta-pay.Amount) > 0.03 {
		return nil, nil, errors.New("inconsistencia en totales del comprobante")
	}

	terminos := fmt.Sprintf("Cobro aplicado a deuda(s). Ref.: %s.", settleRef)
	if fromSettlement {
		terminos = fmt.Sprintf("Honorarios según liquidación %s.", settleRef)
	}

	totales := map[string]interface{}{
		"total_anticipos":                 0,
		"total_descuentos":                0,
		"total_cargos":                    0,
		"total_exportacion":               0,
		"total_operaciones_gratuitas":     0,
		"total_operaciones_gravadas":      totGrav,
		"total_operaciones_inafectas":     0,
		"total_operaciones_exoneradas":    0,
		"total_igv":                       totIGV,
		"total_igv_operaciones_gratuitas": 0,
		"total_base_isc":                  0,
		"total_isc":                       0,
		"total_base_otros_impuestos":      0,
		"total_otros_impuestos":           0,
		"total_impuestos_bolsa_plastica":  0,
		"total_impuestos":                 totIGV,
		"total_valor":                     totGrav,
		"subtotal_venta":                  totVenta,
		"total_venta":                     totVenta,
		"total_pendiente_pago":            0,
	}

	doc := map[string]interface{}{
		"serie_documento":              serie,
		"numero_documento":             "#",
		"fecha_de_emision":             dateStr,
		"hora_de_emision":              timeStr,
		"codigo_tipo_documento":        tipoDoc,
		"codigo_tipo_moneda":           "PEN",
		"factor_tipo_de_cambio":        1,
		"codigo_tipo_operacion":        "0101",
		"fecha_de_vencimiento":         dateStr,
		"numero_orden_de_compra":       fmt.Sprintf("Pago %d · %s", pay.ID, settleRef),
		"datos_del_cliente_o_receptor": receptorMapFromCompany(&co),
		"codigo_condicion_de_pago":     "01",
		"totales":                      totales,
		"items":                        items,
		"pagos": []interface{}{
			map[string]interface{}{
				"codigo_metodo_pago":  method,
				"codigo_destino_pago": dest,
				"referencia":          ref,
				"monto":               totVenta,
				"pago_recibido":       totVenta,
			},
		},
		"leyendas": []interface{}{
			map[string]interface{}{"codigo": "1000", "valor": leyendaMontoSoles(totVenta)},
		},
		"acciones": map[string]interface{}{
			"enviar_email":       false,
			"enviar_xml_firmado": true,
			"formato_pdf":        "a4",
		},
		"terminos_condiciones": terminos,
	}

	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, nil, err
	}
	rec, respBody, err := s.issueToTukifac(pay.CompanyID, raw, false)
	if err != nil {
		return nil, respBody, err
	}
	if err := s.LinkIssuedReceiptToPayment(rec, &pay); err != nil {
		return rec, respBody, err
	}
	return rec, respBody, nil
}
