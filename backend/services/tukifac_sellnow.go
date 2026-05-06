package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// TukifacSellnowItem refleja un ítem de GET /api/sellnow/items (campos SUNAT; sin restaurante/modificadores).
type TukifacSellnowItem struct {
	ID                       TukifacFlexInt    `json:"id"`
	ItemTypeID               *TukifacFlexInt   `json:"item_type_id,omitempty"`
	UnitTypeID               string            `json:"unit_type_id"`
	CategoryID               TukifacFlexInt    `json:"category_id"`
	Description              string            `json:"description"`
	Name                     *string           `json:"name"`
	SecondName               *string           `json:"second_name"`
	WarehouseID              TukifacFlexInt    `json:"warehouse_id"`
	InternalID               TukifacFlexString `json:"internal_id"`
	Barcode                  TukifacFlexString `json:"barcode"`
	ItemCode                 *string           `json:"item_code"`
	ItemCodeGS1              *string           `json:"item_code_gs1"`
	Stock                    TukifacFlexString `json:"stock"`
	StockMin                 TukifacFlexString `json:"stock_min"`
	CurrencyTypeID           string            `json:"currency_type_id"`
	CurrencyTypeSymbol       string            `json:"currency_type_symbol"`
	SaleAffectationIGVTypeID string            `json:"sale_affectation_igv_type_id"`
	Price                    TukifacFlexFloat  `json:"price"`
	CalculateQuantity        bool              `json:"calculate_quantity"`
	HasIGV                   bool              `json:"has_igv"`
	Active                   bool              `json:"active"`
	SaleUnitPrice            TukifacFlexString `json:"sale_unit_price"`
	PurchaseUnitPrice        TukifacFlexString `json:"purchase_unit_price"`
	CreatedAt                string            `json:"created_at"`
	UpdatedAt                string            `json:"updated_at"`
	ApplyStore               bool              `json:"apply_store"`
	ImageURL                 string            `json:"image_url"`
}

type tukifacSellnowEnvelope struct {
	Success bool                 `json:"success"`
	Data    []TukifacSellnowItem `json:"data"`
}

// FetchSellnowItems obtiene el catálogo de ítems desde Tukifac (sin paginación en origen).
func (s *TukifacService) FetchSellnowItems() ([]TukifacSellnowItem, error) {
	baseURL, token, err := s.getAPIConfig()
	if err != nil {
		return nil, err
	}
	u := buildTukifacURL(baseURL, "/api/sellnow/items")
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", normalizeBearerToken(token))
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("respuesta no exitosa de Tukifac: %s", resp.Status)
	}

	var env tukifacSellnowEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		var raw []TukifacSellnowItem
		if err2 := json.Unmarshal(body, &raw); err2 != nil {
			return nil, fmt.Errorf("respuesta JSON inválida de sellnow/items: %w", err)
		}
		return raw, nil
	}
	if !env.Success && len(env.Data) == 0 {
		return nil, fmt.Errorf("Tukifac no devolvió ítems (success=false)")
	}
	return env.Data, nil
}
