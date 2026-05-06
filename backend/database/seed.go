package database

import (
	"miappfiber/models"
)

func Seed() error {
	// Solo insertar si no hay usuarios
	var count int64
	DB.Model(&models.User{}).Count(&count)
	if count == 0 {
		email := "admin@admin.com"
		admin := models.User{
			Name:     "Admin",
			Username: "admin",
			Email:    &email,
			Role:     "Administrador",
		}
		if err := admin.SetPassword("123456"); err != nil {
			return err
		}
		if err := DB.Create(&admin).Error; err != nil {
			return err
		}
	}

	// Configuración del estudio por defecto
	var cfgCount int64
	DB.Model(&models.FirmConfig{}).Count(&cfgCount)
	if cfgCount == 0 {
		cfg := models.FirmConfig{
			Name:    "Estudio Contable Demo",
			RUC:     "20123456789",
			Address: "Av. Principal 123, Lima",
			Phone:   "+51 123 456 789",
			Email:   "contacto@estudiodemo.com",
		}
		if err := DB.Create(&cfg).Error; err != nil {
			return err
		}
	}

	var pcCount int64
	DB.Model(&models.ProductCategory{}).Count(&pcCount)
	if pcCount == 0 {
		if err := DB.Create(&models.ProductCategory{Name: "Servicios", SortOrder: 0, Active: true}).Error; err != nil {
			return err
		}
		if err := DB.Create(&models.ProductCategory{Name: "Productos", SortOrder: 1, Active: true}).Error; err != nil {
			return err
		}
	}

	return nil
}
