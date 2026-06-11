package services

import (
	"errors"
	"strings"

	"miappfiber/models"

	"golang.org/x/crypto/bcrypt"
)

// VerifyOperationsKey valida la clave configurada en Perfil del estudio.
func VerifyOperationsKey(plain string) error {
	cfg, err := NewConfigService().GetFirmConfig()
	if err != nil {
		return err
	}
	hash := strings.TrimSpace(cfg.OperationsKeyHash)
	if hash == "" {
		return errors.New("no hay clave de operaciones configurada en Ajustes → Perfil del estudio")
	}
	key := strings.TrimSpace(plain)
	if key == "" {
		return errors.New("indique la clave de operaciones")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(key)); err != nil {
		return errors.New("clave de operaciones incorrecta")
	}
	return nil
}

// ApplyOperationsKeyPlain actualiza el hash si se envía una clave nueva (texto no vacío).
func ApplyOperationsKeyPlain(cfg *models.FirmConfig, plain string) error {
	if cfg == nil {
		return nil
	}
	key := strings.TrimSpace(plain)
	if key == "" {
		return nil
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(key), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	cfg.OperationsKeyHash = string(hash)
	return nil
}

func FirmConfigOperationsKeyConfigured(cfg *models.FirmConfig) bool {
	if cfg == nil {
		return false
	}
	return strings.TrimSpace(cfg.OperationsKeyHash) != ""
}
