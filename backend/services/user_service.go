package services

import (
	"crypto/rand"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"miappfiber/database"
	"miappfiber/models"
	"miappfiber/rbac"

	"gorm.io/gorm"
)

type UserService struct{}

func NewUserService() *UserService {
	return &UserService{}
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{3,32}$`)

func randomPassword(length int) string {
	const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, length)
	for i := range b {
		var x [1]byte
		_, _ = rand.Read(x[:])
		b[i] = chars[int(x[0])%len(chars)]
	}
	return string(b)
}

func (s *UserService) List() ([]models.User, error) {
	var users []models.User
	if err := database.DB.Preload("Roles").Order("id ASC").Find(&users).Error; err != nil {
		return nil, err
	}
	if err := AttachEffectivePermissionCodes(users); err != nil {
		return nil, err
	}
	return users, nil
}

func (s *UserService) GetByID(id uint) (*models.User, error) {
	var u models.User
	if err := database.DB.Preload("Roles").First(&u, id).Error; err != nil {
		return nil, err
	}
	arr := []models.User{u}
	if err := AttachEffectivePermissionCodes(arr); err != nil {
		return nil, err
	}
	return &arr[0], nil
}

func roleByID(db *gorm.DB, id uint) (*models.Role, error) {
	var r models.Role
	if err := db.First(&r, id).Error; err != nil {
		return nil, err
	}
	return &r, nil
}

// Create devuelve el usuario y, si se generó contraseña aleatoria, su texto en claro (solo para mostrar una vez).
// roleID: rol RBAC (tabla roles). Obligatorio (>0).
func (s *UserService) Create(username, name, emailStr, password string, roleID uint, dni, phone, address string, active bool) (*models.User, string, error) {
	username = strings.TrimSpace(username)
	name = strings.TrimSpace(name)
	emailStr = strings.TrimSpace(emailStr)
	password = strings.TrimSpace(password)
	dni = strings.TrimSpace(dni)
	phone = strings.TrimSpace(phone)
	address = strings.TrimSpace(address)

	if name == "" || username == "" {
		return nil, "", errors.New("nombre y usuario son requeridos")
	}
	if !usernamePattern.MatchString(username) {
		return nil, "", errors.New("usuario inválido: 3-32 caracteres (letras, números, . _ -)")
	}

	var emailPtr *string
	if emailStr != "" {
		emailPtr = &emailStr
	}

	generatedPlain := ""
	if password == "" {
		password = randomPassword(12)
		generatedPlain = password
	} else if utf8.RuneCountInString(password) < 6 {
		return nil, "", errors.New("la contraseña debe tener al menos 6 caracteres")
	}

	var exists int64
	if err := database.DB.Model(&models.User{}).Where("username = ?", username).Count(&exists).Error; err != nil {
		return nil, "", err
	}
	if exists > 0 {
		return nil, "", errors.New("ese nombre de usuario ya está en uso")
	}
	if emailPtr != nil {
		if err := database.DB.Model(&models.User{}).Where("email = ?", *emailPtr).Count(&exists).Error; err != nil {
			return nil, "", err
		}
		if exists > 0 {
			return nil, "", errors.New("ese correo ya está registrado")
		}
	}

	if roleID == 0 {
		def, err := NewRoleService().GetDefaultRole()
		if err != nil {
			return nil, "", err
		}
		roleID = def.ID
	}
	role, err := roleByID(database.DB, roleID)
	if err != nil {
		return nil, "", errors.New("rol inválido")
	}

	u := &models.User{
		Name:     name,
		Username: username,
		Email:    emailPtr,
		Active:   active,
		DNI:      dni,
		Phone:    phone,
		Address:  address,
	}
	if err := u.SetPassword(password); err != nil {
		return nil, "", err
	}
	if err := database.DB.Create(u).Error; err != nil {
		return nil, "", err
	}
	if err := database.DB.Model(u).Association("Roles").Replace([]models.Role{*role}); err != nil {
		return nil, "", err
	}
	Authz().InvalidateUser(u.ID)
	if err := database.DB.Preload("Roles").First(u, u.ID).Error; err != nil {
		return nil, "", err
	}
	return u, generatedPlain, nil
}

// Update actualiza datos del usuario. Si roleID > 0, reemplaza los roles RBAC por ese único rol.
func (s *UserService) Update(id uint, username, name, emailStr, password string, roleID *uint, active *bool, dni, phone, address *string) (*models.User, error) {
	u, err := s.GetByID(id)
	if err != nil {
		return nil, err
	}

	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("el usuario es requerido")
	}
	if !usernamePattern.MatchString(username) {
		return nil, errors.New("usuario inválido: 3-32 caracteres (letras, números, . _ -)")
	}
	if username != u.Username {
		var cnt int64
		if err := database.DB.Model(&models.User{}).Where("username = ? AND id <> ?", username, id).Count(&cnt).Error; err != nil {
			return nil, err
		}
		if cnt > 0 {
			return nil, errors.New("ese nombre de usuario ya está en uso")
		}
	}
	u.Username = username

	if name = strings.TrimSpace(name); name != "" {
		u.Name = name
	}

	emailStr = strings.TrimSpace(emailStr)
	if emailStr == "" {
		u.Email = nil
	} else {
		var cnt int64
		if err := database.DB.Model(&models.User{}).Where("email = ? AND id <> ?", emailStr, id).Count(&cnt).Error; err != nil {
			return nil, err
		}
		if cnt > 0 {
			return nil, errors.New("ese correo ya está registrado")
		}
		u.Email = &emailStr
	}

	if active != nil {
		u.Active = *active
	}
	if dni != nil {
		u.DNI = strings.TrimSpace(*dni)
	}
	if phone != nil {
		u.Phone = strings.TrimSpace(*phone)
	}
	if address != nil {
		u.Address = strings.TrimSpace(*address)
	}
	if password = strings.TrimSpace(password); password != "" {
		if utf8.RuneCountInString(password) < 6 {
			return nil, errors.New("la contraseña debe tener al menos 6 caracteres")
		}
		if err := u.SetPassword(password); err != nil {
			return nil, err
		}
	}

	if err := database.DB.Save(u).Error; err != nil {
		return nil, err
	}

	if roleID != nil && *roleID > 0 {
		role, err := roleByID(database.DB, *roleID)
		if err != nil {
			return nil, errors.New("rol inválido")
		}
		if err := database.DB.Model(u).Association("Roles").Replace([]models.Role{*role}); err != nil {
			return nil, err
		}
		Authz().InvalidateUser(u.ID)
	}

	if err := database.DB.Preload("Roles").First(u, u.ID).Error; err != nil {
		return nil, err
	}
	return u, nil
}

func (s *UserService) Delete(id uint) error {
	var user models.User
	if err := database.DB.Preload("Roles").First(&user, id).Error; err != nil {
		return err
	}
	if Authz().HasPermission(id, rbac.AccessStudio) {
		n, err := CountOtherUsersWithPermission(database.DB, rbac.AccessStudio, id)
		if err != nil {
			return err
		}
		if n == 0 {
			return errors.New("no se puede eliminar el último usuario con alcance global del estudio")
		}
	}
	Authz().InvalidateUser(id)
	return database.DB.Delete(&models.User{}, id).Error
}
