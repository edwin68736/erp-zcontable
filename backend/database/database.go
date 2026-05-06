package database

import (
	"fmt"

	"miappfiber/config"
	"miappfiber/models"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func Connect() error {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		config.AppConfig.DBUser,
		config.AppConfig.DBPassword,
		config.AppConfig.DBHost,
		config.AppConfig.DBPort,
		config.AppConfig.DBName,
	)

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
		PrepareStmt: true,
	})
	if err != nil {
		return fmt.Errorf("error conectando a la base de datos: %w", err)
	}

	DB = db
	return nil
}

func AutoMigrate() error {
	return DB.AutoMigrate(
		&models.User{},
		&models.Company{},
		&models.CompanyAssignment{},
		&models.Contact{},
		&models.Document{},
		&models.DocumentItem{},
		&models.Payment{},
		&models.PaymentAllocation{},
		&models.FirmConfig{},
		&models.PlanCategory{},
		&models.SubscriptionPlan{},
		&models.PlanTier{},
		&models.TukifacFiscalReceipt{},
		&models.ProductCategory{},
		&models.Product{},
		&models.TaxSettlement{},
		&models.TaxSettlementLine{},
	)
}
