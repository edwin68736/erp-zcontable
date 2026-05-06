package models

import (
	"time"

	"gorm.io/gorm"
)

// Product almacena ítems SUNAT (bienes o servicios), locales o sincronizados desde Tukifac.
// La coincidencia en sincronización es por tukifac_item_id (ID remoto); los registros solo locales no se tocan.
type Product struct {
	ID uint `gorm:"primaryKey" json:"id"`

	TukifacItemID *uint `gorm:"column:tukifac_item_id;uniqueIndex" json:"tukifac_item_id,omitempty"`
	// TukifacItemTypeID: metadato remoto si sellnow devuelve item_type_id (referencia en Tukifac).
	TukifacItemTypeID *uint `gorm:"column:tukifac_item_type_id;index" json:"tukifac_item_type_id,omitempty"`
	ProductKind       string `gorm:"size:20;not null;default:product;index" json:"product_kind"` // product | service

	ProductCategoryID *uint            `gorm:"column:product_category_id;index" json:"product_category_id,omitempty"`
	ProductCategory   *ProductCategory `gorm:"foreignKey:ProductCategoryID" json:"product_category,omitempty"`

	UnitTypeID               string  `gorm:"size:16" json:"unit_type_id"`
	CategoryID               int64   `json:"category_id"` // ID categoría remota Tukifac (referencia)
	Description              string  `gorm:"type:text;not null" json:"description"`
	Name                     *string `gorm:"size:255" json:"name,omitempty"`
	SecondName               *string `gorm:"size:255" json:"second_name,omitempty"`
	WarehouseID              int     `json:"warehouse_id"`
	InternalID               string  `gorm:"size:64" json:"internal_id"`
	Barcode                  string  `gorm:"size:64;index" json:"barcode"`
	ItemCode                 *string `gorm:"size:64" json:"item_code,omitempty"`
	ItemCodeGS1              *string `gorm:"size:64" json:"item_code_gs1,omitempty"`
	Stock                    string  `gorm:"size:32" json:"stock"`
	StockMin                 string  `gorm:"size:32" json:"stock_min"`
	CurrencyTypeID           string  `gorm:"size:8" json:"currency_type_id"`
	CurrencyTypeSymbol       string  `gorm:"size:8" json:"currency_type_symbol"`
	SaleAffectationIGVTypeID string  `gorm:"size:8" json:"sale_affectation_igv_type_id"`
	Price                    float64 `json:"price"`
	CalculateQuantity        bool    `gorm:"not null;default:false" json:"calculate_quantity"`
	HasIGV                   bool    `gorm:"column:has_igv;not null;default:true" json:"has_igv"`
	PriceIncludesIGV         bool    `gorm:"not null;default:true" json:"price_includes_igv"`
	TrackInventory           bool    `gorm:"not null;default:false" json:"track_inventory"`
	Active                   bool    `gorm:"not null;default:true" json:"active"`
	SaleUnitPrice            string  `gorm:"size:64" json:"sale_unit_price"`
	PurchaseUnitPrice        string  `gorm:"size:64" json:"purchase_unit_price"`
	ApplyStore               bool    `gorm:"not null;default:true" json:"apply_store"`
	ImageURL                 string  `gorm:"type:text" json:"image_url,omitempty"`

	TukifacCreatedAt *time.Time `json:"tukifac_created_at,omitempty"`
	TukifacUpdatedAt *time.Time `json:"tukifac_updated_at,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Product) TableName() string {
	return "products"
}
