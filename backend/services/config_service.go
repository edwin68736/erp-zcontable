package services

import (
	"miappfiber/database"
	"miappfiber/models"
)

type ConfigService struct{}

func NewConfigService() *ConfigService {
	return &ConfigService{}
}

func (s *ConfigService) GetFirmConfig() (*models.FirmConfig, error) {
	var cfg models.FirmConfig
	err := database.DB.First(&cfg).Error
	if err != nil {
		// Si no existe, crear una configuración básica
		cfg = models.FirmConfig{
			Name:    "Estudio Contable",
			RUC:     "",
			Address: "",
		}
		if err := database.DB.Create(&cfg).Error; err != nil {
			return nil, err
		}
	}
	return &cfg, nil
}

func (s *ConfigService) UpdateFirmConfig(input *models.FirmConfig) (*models.FirmConfig, error) {
	cfg, err := s.GetFirmConfig()
	if err != nil {
		return nil, err
	}
	if input.Name != "" {
		cfg.Name = input.Name
	}
	if input.RUC != "" {
		cfg.RUC = input.RUC
	}
	if input.Address != "" {
		cfg.Address = input.Address
	}
	if input.Phone != "" {
		cfg.Phone = input.Phone
	}
	if input.Email != "" {
		cfg.Email = input.Email
	}
	if input.LogoURL != "" {
		cfg.LogoURL = input.LogoURL
	}
	if input.TukifacAPIURL != "" {
		cfg.TukifacAPIURL = input.TukifacAPIURL
	}
	if input.TukifacAPIToken != "" {
		cfg.TukifacAPIToken = input.TukifacAPIToken
	}
	if input.ApiPeruBaseURL != "" {
		cfg.ApiPeruBaseURL = input.ApiPeruBaseURL
	}
	if input.ApiPeruToken != "" {
		cfg.ApiPeruToken = input.ApiPeruToken
	}
	// Pie de estado de cuenta (textos; el formulario de ajustes envía siempre estos campos)
	cfg.StatementWhatsappNotice = input.StatementWhatsappNotice
	cfg.StatementBankInfo = input.StatementBankInfo
	cfg.StatementPaymentObservations = input.StatementPaymentObservations
	cfg.StatementPaymentQrCaption = input.StatementPaymentQrCaption
	if err := database.DB.Save(cfg).Error; err != nil {
		return nil, err
	}
	return cfg, nil
}

// SetStatementBankLogoURL guarda la URL del logo del banco en el pie del estado de cuenta.
func (s *ConfigService) SetStatementBankLogoURL(url string) (*models.FirmConfig, error) {
	cfg, err := s.GetFirmConfig()
	if err != nil {
		return nil, err
	}
	cfg.StatementBankLogoURL = url
	if err := database.DB.Save(cfg).Error; err != nil {
		return nil, err
	}
	return cfg, nil
}

// SetStatementPaymentQrURL guarda la URL del QR de pagos (Yape, Plin, etc.).
func (s *ConfigService) SetStatementPaymentQrURL(url string) (*models.FirmConfig, error) {
	cfg, err := s.GetFirmConfig()
	if err != nil {
		return nil, err
	}
	cfg.StatementPaymentQrURL = url
	if err := database.DB.Save(cfg).Error; err != nil {
		return nil, err
	}
	return cfg, nil
}
