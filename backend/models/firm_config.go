package models

import "time"

// FirmConfig almacena la configuración del estudio contable (asumimos solo un registro)
type FirmConfig struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"size:255;not null" json:"name"`     // Nombre del estudio
	RUC         string    `gorm:"size:20;not null" json:"ruc"`       // RUC del estudio
	Address     string    `gorm:"size:255;not null" json:"address"`  // Dirección
	Phone       string    `gorm:"size:50" json:"phone"`
	Email       string    `gorm:"size:255" json:"email"`
	LogoURL     string    `gorm:"size:255" json:"logo_url"`
	TukifacAPIURL   string    `gorm:"size:512" json:"tukifac_api_url"`
	TukifacAPIToken string    `gorm:"type:text" json:"tukifac_api_token"`
	// ApiPeru.dev — consulta RUC (SUNAT). Base típica: https://apiperu.dev → POST /api/ruc
	ApiPeruBaseURL string `gorm:"size:512" json:"apiperu_base_url"`
	ApiPeruToken   string `gorm:"type:text" json:"apiperu_token"`
	// Pie de página del estado de cuenta (PDF / pantalla)
	StatementWhatsappNotice        string `gorm:"type:text" json:"statement_whatsapp_notice"`
	StatementBankInfo              string `gorm:"type:text" json:"statement_bank_info"`
	StatementPaymentObservations   string `gorm:"type:text" json:"statement_payment_observations"`
	StatementBankLogoURL           string `gorm:"size:512" json:"statement_bank_logo_url"`
	StatementPaymentQrURL          string `gorm:"size:512" json:"statement_payment_qr_url"`
	StatementPaymentQrCaption      string `gorm:"size:120" json:"statement_payment_qr_caption"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (FirmConfig) TableName() string {
	return "firm_config"
}
