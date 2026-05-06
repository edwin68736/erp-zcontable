package models

import (
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type User struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Name      string         `gorm:"size:255;not null" json:"name"`
	Username  string         `gorm:"size:100;uniqueIndex" json:"username"`
	Email     *string        `gorm:"size:255;uniqueIndex" json:"email,omitempty"`
	DNI       string         `gorm:"size:20" json:"dni"`
	Phone     string         `gorm:"size:50" json:"phone"`
	Address   string         `gorm:"size:255" json:"address"`
	Password  string         `gorm:"size:255;not null" json:"-"`
	Role      string         `gorm:"size:50;not null;default:'Administrador'" json:"role"`
	Active    bool           `gorm:"not null;default:true" json:"active"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (u *User) SetPassword(password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	u.Password = string(hash)
	return nil
}

func (u *User) CheckPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(password))
	return err == nil
}

func (User) TableName() string {
	return "users"
}

// EmailString devuelve el correo o cadena vacía si no hay.
func (u *User) EmailString() string {
	if u == nil || u.Email == nil {
		return ""
	}
	return *u.Email
}
