package models

import "time"

// CompanyAccessCredential credenciales y accesos extendidos por empresa (1:1 con Company).
type CompanyAccessCredential struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CompanyID uint      `gorm:"not null;uniqueIndex" json:"company_id"`
	Dig       string    `gorm:"size:20" json:"dig"`

	SolUsuario string `gorm:"size:120" json:"sol_usuario"`
	SolClave   string `gorm:"size:255" json:"sol_clave"`

	BnlCuenta            string `gorm:"size:80" json:"bnl_cuenta"`
	BnlDNI               string `gorm:"size:20" json:"bnl_dni"`
	BnlClaveDetracciones string `gorm:"size:255" json:"bnl_clave_detracciones"`

	AfpUsuario string `gorm:"size:120" json:"afp_usuario"`
	AfpClave   string `gorm:"size:255" json:"afp_clave"`

	RnpClave string `gorm:"size:255" json:"rnp_clave"`

	FacturadorLink       string `gorm:"size:500" json:"facturador_link"`
	FacturadorUsuario    string `gorm:"size:120" json:"facturador_usuario"`
	FacturadorContrasena string `gorm:"size:255" json:"facturador_contrasena"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (CompanyAccessCredential) TableName() string {
	return "company_access_credentials"
}
