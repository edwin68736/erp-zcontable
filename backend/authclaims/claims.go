package authclaims

import "github.com/golang-jwt/jwt/v5"

// Claims payload JWT compartido entre middleware y servicios (evita ciclo de imports).
type Claims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	jwt.RegisteredClaims
}
