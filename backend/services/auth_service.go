package services

import (
	"errors"
	"strings"
	"time"

	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/middleware"
	"miappfiber/models"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

type AuthService struct{}

func NewAuthService() *AuthService {
	return &AuthService{}
}

func (s *AuthService) Login(username, password string) (*models.User, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("credenciales inválidas")
	}
	var user models.User
	if err := database.DB.Where("username = ?", username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("credenciales inválidas")
		}
		return nil, err
	}

	if !user.Active {
		return nil, errors.New("usuario inactivo")
	}

	if !user.CheckPassword(password) {
		return nil, errors.New("credenciales inválidas")
	}

	return &user, nil
}

func (s *AuthService) GenerateToken(user *models.User) (string, error) {
	claims := &middleware.JWTClaims{
		UserID:   user.ID,
		Username: user.Username,
		Email:    user.EmailString(),
		Name:     user.Name,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.AppConfig.JWTSecret))
}

func (s *AuthService) GetUserByID(id uint) (*models.User, error) {
	var user models.User
	if err := database.DB.First(&user, id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}
