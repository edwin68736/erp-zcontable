package controllers

import (
	"crypto/rand"
	"encoding/hex"
	"miappfiber/config"
	"miappfiber/models"
	"miappfiber/services"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v3"
)

type ConfigController struct {
	configService *services.ConfigService
}

func NewConfigController() *ConfigController {
	return &ConfigController{
		configService: services.NewConfigService(),
	}
}

// API

func (ctrl *ConfigController) FirmConfigAPI(c fiber.Ctx) error {
	cfg, err := ctrl.configService.GetFirmConfig()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(cfg)
}

// FirmBrandingAPI datos del estudio para PDFs e informes (sin credenciales Tukifac).
func (ctrl *ConfigController) FirmBrandingAPI(c fiber.Ctx) error {
	cfg, err := ctrl.configService.GetFirmConfig()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	cfg.TukifacAPIToken = ""
	cfg.TukifacAPIURL = ""
	cfg.ApiPeruToken = ""
	cfg.ApiPeruBaseURL = ""
	return c.JSON(cfg)
}

func (ctrl *ConfigController) UpdateFirmConfigAPI(c fiber.Ctx) error {
	var input models.FirmConfig
	if err := c.Bind().Body(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Datos inválidos"})
	}
	cfg, err := ctrl.configService.UpdateFirmConfig(&input)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(cfg)
}

func (ctrl *ConfigController) UploadFirmLogoAPI(c fiber.Ctx) error {
	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Archivo inválido"})
	}
	if fh.Size <= 0 || fh.Size > 10*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "El archivo excede el tamaño permitido"})
	}

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Formato de archivo no permitido"})
	}

	token, err := randomHex(12)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo procesar el archivo"})
	}

	fileName := "logo_" + token + ext
	storagePath := filepath.Join(config.AppConfig.StoragePath, "firm", fileName)
	if err := os.MkdirAll(filepath.Dir(storagePath), 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo crear el almacenamiento"})
	}
	if err := c.SaveFile(fh, storagePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo guardar el archivo"})
	}

	url := "/" + path.Join("storage", "firm", fileName)
	cfg, err := ctrl.configService.UpdateFirmConfig(&models.FirmConfig{LogoURL: url})
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"logo_url": url,
			"config":   cfg,
		},
		"message": "",
	})
}

// UploadStatementBankLogoAPI sube el logo del banco para el pie del estado de cuenta.
func (ctrl *ConfigController) UploadStatementBankLogoAPI(c fiber.Ctx) error {
	return ctrl.uploadStatementFirmImage(c, "stmt_bank_", func(url string) (*models.FirmConfig, error) {
		return ctrl.configService.SetStatementBankLogoURL(url)
	}, "statement_bank_logo_url")
}

// UploadStatementPaymentQrAPI sube la imagen del QR de pagos (Yape, Plin, etc.).
func (ctrl *ConfigController) UploadStatementPaymentQrAPI(c fiber.Ctx) error {
	return ctrl.uploadStatementFirmImage(c, "stmt_qr_", func(url string) (*models.FirmConfig, error) {
		return ctrl.configService.SetStatementPaymentQrURL(url)
	}, "statement_payment_qr_url")
}

func (ctrl *ConfigController) uploadStatementFirmImage(
	c fiber.Ctx,
	filePrefix string,
	save func(url string) (*models.FirmConfig, error),
	responseKey string,
) error {
	fh, err := c.FormFile("file")
	if err != nil || fh == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Archivo inválido"})
	}
	if fh.Size <= 0 || fh.Size > 10*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "El archivo excede el tamaño permitido"})
	}

	ext := strings.ToLower(filepath.Ext(fh.Filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Formato de archivo no permitido"})
	}

	token, err := randomHex(12)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo procesar el archivo"})
	}

	fileName := filePrefix + token + ext
	storagePath := filepath.Join(config.AppConfig.StoragePath, "firm", fileName)
	if err := os.MkdirAll(filepath.Dir(storagePath), 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo crear el almacenamiento"})
	}
	if err := c.SaveFile(fh, storagePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "No se pudo guardar el archivo"})
	}

	url := "/" + path.Join("storage", "firm", fileName)
	cfg, err := save(url)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			responseKey: url,
			"config":    cfg,
		},
		"message": "",
	})
}

func randomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
