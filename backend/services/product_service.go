package services

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

type ProductListParams struct {
	Query  string
	Kind   string
	Active string
}

func buildProductListQuery(params ProductListParams) *gorm.DB {
	q := database.DB.Model(&models.Product{})
	if s := strings.TrimSpace(params.Query); s != "" {
		like := "%" + s + "%"
		q = q.Where(
			"(description LIKE ? OR barcode LIKE ? OR internal_id LIKE ? OR IFNULL(name, '') LIKE ?)",
			like, like, like, like,
		)
	}
	if k := strings.TrimSpace(strings.ToLower(params.Kind)); k == "product" || k == "service" {
		q = q.Where("product_kind = ?", k)
	}
	if params.Active == "1" || strings.EqualFold(params.Active, "true") {
		q = q.Where("active = ?", true)
	}
	if params.Active == "0" || strings.EqualFold(params.Active, "false") {
		q = q.Where("active = ?", false)
	}
	return q
}

func parseTukifacProductDateTime(raw string) (time.Time, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return time.Time{}, false
	}
	layouts := []string{
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05Z07:00",
		time.RFC3339,
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t, true
		}
	}
	if len(s) >= 10 {
		if t, err := time.ParseInLocation("2006-01-02", s[:10], time.Local); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func formatSaleUnitPriceString(price float64, symbol string) string {
	sym := strings.TrimSpace(symbol)
	if sym == "" {
		sym = "S/"
	}
	return fmt.Sprintf("%s %.2f", sym, price)
}

func validateProductCategoryFK(id *uint) error {
	if id == nil || *id == 0 {
		return nil
	}
	var n int64
	database.DB.Model(&models.ProductCategory{}).Where("id = ?", *id).Count(&n)
	if n == 0 {
		return errors.New("categoría no válida")
	}
	return nil
}

func applyIGVFromAffectation(p *models.Product) {
	a := strings.TrimSpace(p.SaleAffectationIGVTypeID)
	switch a {
	case "20", "30":
		p.HasIGV = false
		p.PriceIncludesIGV = false
	case "10":
		p.HasIGV = true
	default:
		if a == "" {
			p.SaleAffectationIGVTypeID = "10"
			p.HasIGV = true
		}
	}
}

func applyProductCreateDefaults(p *models.Product) {
	if p.ProductKind == "product" {
		p.UnitTypeID = "NIU"
	} else {
		u := strings.ToUpper(strings.TrimSpace(p.UnitTypeID))
		if u != "ZZ" && u != "NIU" {
			p.UnitTypeID = "ZZ"
		} else {
			p.UnitTypeID = u
		}
	}
	if strings.TrimSpace(p.CurrencyTypeID) == "" {
		p.CurrencyTypeID = "PEN"
	}
	if strings.TrimSpace(p.CurrencyTypeSymbol) == "" {
		p.CurrencyTypeSymbol = "S/"
	}
	applyIGVFromAffectation(p)
	if !p.TrackInventory {
		p.Stock = "0"
		p.StockMin = "0"
		p.PurchaseUnitPrice = ""
	}
	if strings.TrimSpace(p.SaleUnitPrice) == "" {
		p.SaleUnitPrice = formatSaleUnitPriceString(p.Price, p.CurrencyTypeSymbol)
	}
}

// DefaultProductCategoryIDForSync prioriza categoría "Servicios", si no existe la primera por orden.
func DefaultProductCategoryIDForSync() *uint {
	var cat models.ProductCategory
	if err := database.DB.Where("LOWER(TRIM(name)) = ?", "servicios").First(&cat).Error; err == nil && cat.ID > 0 {
		id := cat.ID
		return &id
	}
	if err := database.DB.Order("sort_order ASC, id ASC").First(&cat).Error; err == nil && cat.ID > 0 {
		id := cat.ID
		return &id
	}
	return nil
}

type ProductService struct{}

func NewProductService() *ProductService {
	return &ProductService{}
}

func (s *ProductService) ListPaged(params ProductListParams, page, perPage int) ([]models.Product, int64, error) {
	if page <= 0 {
		page = 1
	}
	if perPage <= 0 {
		perPage = 20
	}
	if perPage > 200 {
		perPage = 200
	}

	var total int64
	if err := buildProductListQuery(params).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var list []models.Product
	err := buildProductListQuery(params).
		Preload("ProductCategory").
		Order("updated_at DESC, id DESC").
		Limit(perPage).
		Offset((page - 1) * perPage).
		Find(&list).Error
	if err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

func (s *ProductService) GetByID(id uint) (*models.Product, error) {
	var p models.Product
	if err := database.DB.Preload("ProductCategory").First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func normalizeProductKind(k string) string {
	switch strings.ToLower(strings.TrimSpace(k)) {
	case "service":
		return "service"
	default:
		return "product"
	}
}

func (s *ProductService) Create(input *models.Product) error {
	input.TukifacItemID = nil
	input.ProductKind = normalizeProductKind(input.ProductKind)
	input.Description = strings.TrimSpace(input.Description)
	if input.Description == "" {
		return errors.New("la descripción es requerida")
	}
	input.ImageURL = ""
	if err := validateProductCategoryFK(input.ProductCategoryID); err != nil {
		return err
	}
	applyProductCreateDefaults(input)
	return database.DB.Create(input).Error
}

func (s *ProductService) Update(id uint, input *models.Product) error {
	var p models.Product
	if err := database.DB.First(&p, id).Error; err != nil {
		return err
	}
	origImage := strings.TrimSpace(p.ImageURL)
	if strings.TrimSpace(input.Description) == "" {
		return errors.New("la descripción es requerida")
	}
	if err := validateProductCategoryFK(input.ProductCategoryID); err != nil {
		return err
	}

	p.ProductKind = normalizeProductKind(input.ProductKind)
	if p.ProductKind == "product" {
		p.UnitTypeID = "NIU"
	} else {
		u := strings.TrimSpace(strings.ToUpper(input.UnitTypeID))
		if u == "ZZ" || u == "NIU" {
			p.UnitTypeID = u
		} else if p.TukifacItemID != nil && u != "" {
			p.UnitTypeID = u
		} else {
			p.UnitTypeID = "ZZ"
		}
	}
	p.ProductCategoryID = input.ProductCategoryID
	p.CategoryID = input.CategoryID
	p.Description = strings.TrimSpace(input.Description)
	p.Name = input.Name
	p.SecondName = input.SecondName
	p.WarehouseID = input.WarehouseID
	p.InternalID = strings.TrimSpace(input.InternalID)
	p.Barcode = strings.TrimSpace(input.Barcode)
	p.ItemCode = input.ItemCode
	p.ItemCodeGS1 = input.ItemCodeGS1
	p.CurrencyTypeID = strings.TrimSpace(input.CurrencyTypeID)
	p.CurrencyTypeSymbol = strings.TrimSpace(input.CurrencyTypeSymbol)
	p.SaleAffectationIGVTypeID = strings.TrimSpace(input.SaleAffectationIGVTypeID)
	p.Price = input.Price
	p.CalculateQuantity = input.CalculateQuantity
	p.Active = input.Active
	p.ApplyStore = input.ApplyStore
	p.PriceIncludesIGV = input.PriceIncludesIGV
	p.TrackInventory = input.TrackInventory
	applyIGVFromAffectation(&p)
	if strings.TrimSpace(p.SaleAffectationIGVTypeID) == "10" {
		p.PriceIncludesIGV = input.PriceIncludesIGV
	}
	if !p.TrackInventory {
		p.Stock = "0"
		p.StockMin = "0"
		p.PurchaseUnitPrice = ""
	} else {
		p.Stock = strings.TrimSpace(input.Stock)
		p.StockMin = strings.TrimSpace(input.StockMin)
		p.PurchaseUnitPrice = strings.TrimSpace(input.PurchaseUnitPrice)
	}
	p.SaleUnitPrice = strings.TrimSpace(input.SaleUnitPrice)
	if p.SaleUnitPrice == "" {
		p.SaleUnitPrice = formatSaleUnitPriceString(p.Price, p.CurrencyTypeSymbol)
	}
	if p.TukifacItemID != nil {
		p.ImageURL = origImage
	} else {
		p.ImageURL = ""
	}
	return database.DB.Save(&p).Error
}

func (s *ProductService) Delete(id uint) error {
	res := database.DB.Delete(&models.Product{}, id)
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return res.Error
}

func mapSellnowItemOntoProduct(item TukifacSellnowItem, target *models.Product) {
	rid := uint(item.ID.Int())
	target.TukifacItemID = &rid
	if item.ItemTypeID != nil {
		if v := item.ItemTypeID.Int(); v > 0 {
			u := uint(v)
			target.TukifacItemTypeID = &u
		}
	}
	target.UnitTypeID = strings.TrimSpace(item.UnitTypeID)
	target.CategoryID = int64(item.CategoryID.Int())
	target.Description = strings.TrimSpace(item.Description)
	if target.Description == "" {
		target.Description = "(sin descripción)"
	}
	target.Name = item.Name
	target.SecondName = item.SecondName
	target.WarehouseID = item.WarehouseID.Int()
	target.InternalID = strings.TrimSpace(item.InternalID.String())
	target.Barcode = strings.TrimSpace(item.Barcode.String())
	target.ItemCode = item.ItemCode
	target.ItemCodeGS1 = item.ItemCodeGS1
	target.Stock = strings.TrimSpace(item.Stock.String())
	target.StockMin = strings.TrimSpace(item.StockMin.String())
	target.CurrencyTypeID = strings.TrimSpace(item.CurrencyTypeID)
	target.CurrencyTypeSymbol = strings.TrimSpace(item.CurrencyTypeSymbol)
	target.SaleAffectationIGVTypeID = strings.TrimSpace(item.SaleAffectationIGVTypeID)
	target.Price = item.Price.Float64()
	target.CalculateQuantity = item.CalculateQuantity
	target.HasIGV = item.HasIGV
	target.Active = item.Active
	target.SaleUnitPrice = strings.TrimSpace(item.SaleUnitPrice.String())
	target.PurchaseUnitPrice = strings.TrimSpace(item.PurchaseUnitPrice.String())
	target.ApplyStore = item.ApplyStore
	target.ImageURL = strings.TrimSpace(item.ImageURL)
	target.TrackInventory = true
	target.PriceIncludesIGV = target.HasIGV && strings.TrimSpace(target.SaleAffectationIGVTypeID) == "10"
	if t, ok := parseTukifacProductDateTime(item.CreatedAt); ok {
		target.TukifacCreatedAt = &t
	} else {
		target.TukifacCreatedAt = nil
	}
	if t, ok := parseTukifacProductDateTime(item.UpdatedAt); ok {
		target.TukifacUpdatedAt = &t
	} else {
		target.TukifacUpdatedAt = nil
	}
}

// SyncFromTukifac crea o actualiza por tukifac_item_id; asigna categoría local por defecto si falta.
func (s *ProductService) SyncFromTukifac(tukifac *TukifacService) (created int, updated int, err error) {
	items, err := tukifac.FetchSellnowItems()
	if err != nil {
		return 0, 0, err
	}
	defCat := DefaultProductCategoryIDForSync()
	for _, item := range items {
		if item.ID.Int() <= 0 {
			continue
		}
		remote := uint(item.ID.Int())
		var existing models.Product
		q := database.DB.Unscoped().Where("tukifac_item_id = ?", remote).First(&existing)
		if q.Error == nil {
			kind := existing.ProductKind
			if kind == "" {
				kind = "product"
			}
			mapSellnowItemOntoProduct(item, &existing)
			existing.ProductKind = kind
			if existing.ProductCategoryID == nil && defCat != nil {
				existing.ProductCategoryID = defCat
			}
			if existing.DeletedAt.Valid {
				existing.DeletedAt = gorm.DeletedAt{}
			}
			if err := database.DB.Unscoped().Save(&existing).Error; err != nil {
				continue
			}
			updated++
			continue
		}
		if !errors.Is(q.Error, gorm.ErrRecordNotFound) {
			continue
		}
		var p models.Product
		p.ProductKind = "product"
		mapSellnowItemOntoProduct(item, &p)
		if defCat != nil {
			p.ProductCategoryID = defCat
		}
		if err := database.DB.Create(&p).Error; err != nil {
			continue
		}
		created++
	}
	return created, updated, nil
}
