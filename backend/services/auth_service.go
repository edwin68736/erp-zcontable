package services

import (
	"errors"
	"strings"
	"sync"
	"time"

	"miappfiber/authclaims"
	"miappfiber/config"
	"miappfiber/database"
	"miappfiber/models"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthService struct{}

func NewAuthService() *AuthService {
	return &AuthService{}
}

// ErrInvalidCredentials respuesta única para cualquier fallo de inicio de sesión (usuario que no existe, contraseña
// incorrecta o usuario inactivo): el sistema no revela cuál fue.
var ErrInvalidCredentials = errors.New("credenciales inválidas")

// Motivos internos de un fallo (solo van a la bitácora de seguridad, nunca a la respuesta).
const (
	LoginFailUnknownUser = "usuario inexistente"
	LoginFailBadPassword = "contraseña incorrecta"
	LoginFailInactive    = "usuario inactivo"
)

var (
	dummyHashOnce sync.Once
	dummyHash     []byte
)

// dummyPasswordHash hash de relleno: cuando el usuario no existe se compara igual contra algo, para que la
// respuesta tarde lo mismo y no se pueda averiguar qué usuarios existen por el tiempo de respuesta.
func dummyPasswordHash() []byte {
	dummyHashOnce.Do(func() {
		dummyHash, _ = bcrypt.GenerateFromPassword([]byte("relleno-sin-usuario"), bcrypt.DefaultCost)
	})
	return dummyHash
}

// Login valida usuario y contraseña. Ante cualquier fallo devuelve ErrInvalidCredentials.
func (s *AuthService) Login(username, password string) (*models.User, error) {
	u, _, err := s.LoginDetailed(username, password)
	return u, err
}

// LoginDetailed igual que Login, pero además devuelve el motivo real del fallo (para la bitácora de seguridad).
// El usuario, si existe, se devuelve aun cuando falle (para registrar a quién se intentó entrar).
func (s *AuthService) LoginDetailed(username, password string) (*models.User, string, error) {
	username = strings.TrimSpace(username)
	var user models.User
	found := false
	if username != "" {
		err := database.DB.Where("LOWER(TRIM(username)) = ?", strings.ToLower(username)).First(&user).Error
		switch {
		case err == nil:
			found = true
		case errors.Is(err, gorm.ErrRecordNotFound):
		default:
			return nil, "", err
		}
	}
	if !found {
		_ = bcrypt.CompareHashAndPassword(dummyPasswordHash(), []byte(password))
		return nil, LoginFailUnknownUser, ErrInvalidCredentials
	}
	if !user.CheckPassword(password) {
		return &user, LoginFailBadPassword, ErrInvalidCredentials
	}
	if !user.Active {
		return &user, LoginFailInactive, ErrInvalidCredentials
	}
	return &user, "", nil
}

// ChangeOwnPassword cambia la contraseña del propio usuario: exige la actual y cumplir la política.
func (s *AuthService) ChangeOwnPassword(userID uint, current, next string) error {
	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		return ErrInvalidCredentials
	}
	if !user.CheckPassword(current) {
		return errors.New("la contraseña actual no es correcta")
	}
	if current == next {
		return errors.New("la contraseña nueva debe ser distinta de la actual")
	}
	if err := ValidatePasswordPolicy(next, user.Username); err != nil {
		return err
	}
	if err := user.SetPassword(next); err != nil {
		return err
	}
	return database.DB.Model(&user).Updates(map[string]any{"password": user.Password, "must_change_password": false}).Error
}

// IssueSession abre una sesión del servidor para el usuario y devuelve el token que la identifica (vale lo que dure
// la sesión: máximo 12 horas, y se cierra antes por inactividad o desde el servidor).
func (s *AuthService) IssueSession(user *models.User, deviceID uint, ip, userAgent string) (string, *models.UserSession, error) {
	sess, err := Sessions().Create(user.ID, deviceID, ip, userAgent)
	if err != nil {
		return "", nil, err
	}
	claims := &authclaims.Claims{
		UserID: user.ID, Username: user.Username, Email: user.EmailString(), Name: user.Name, SessionID: sess.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(sess.ExpiresAt),
			IssuedAt:  jwt.NewNumericDate(sess.CreatedAt),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.AppConfig.JWTSecret))
	if err != nil {
		return "", nil, err
	}
	return token, sess, nil
}

func (s *AuthService) GenerateToken(user *models.User) (string, error) {
	claims := &authclaims.Claims{
		UserID:   user.ID,
		Username: user.Username,
		Email:    user.EmailString(),
		Name:     user.Name,
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
