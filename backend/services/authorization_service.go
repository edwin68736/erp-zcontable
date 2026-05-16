package services

import (
	"sync"

	"miappfiber/database"
)

// AuthorizationService resuelve permisos con caché en memoria por usuario.
type AuthorizationService struct {
	mu    sync.RWMutex
	cache map[uint]map[string]struct{} // userID -> set de códigos permission
}

func NewAuthorizationService() *AuthorizationService {
	return &AuthorizationService{
		cache: make(map[uint]map[string]struct{}),
	}
}

var globalAuthz = NewAuthorizationService()

// Authz instancia global (inyección simple; invalidar tras cambios RBAC).
func Authz() *AuthorizationService {
	return globalAuthz
}

// InvalidateUser borra la caché de un usuario.
func (s *AuthorizationService) InvalidateUser(userID uint) {
	s.mu.Lock()
	delete(s.cache, userID)
	s.mu.Unlock()
}

// InvalidateAll vacía toda la caché (p. ej. cambio masivo de permisos).
func (s *AuthorizationService) InvalidateAll() {
	s.mu.Lock()
	s.cache = make(map[uint]map[string]struct{})
	s.mu.Unlock()
}

// HasPermission true si el usuario tiene el permiso vía user_roles → role_permissions.
func (s *AuthorizationService) HasPermission(userID uint, permissionCode string) bool {
	set, err := s.permissionSetForUser(userID)
	if err != nil || set == nil {
		return false
	}
	_, ok := set[permissionCode]
	return ok
}

// HasAnyPermission true si tiene al menos uno de los permisos (códigos vacíos se ignoran).
func (s *AuthorizationService) HasAnyPermission(userID uint, permissionCodes ...string) bool {
	if len(permissionCodes) == 0 {
		return true
	}
	set, err := s.permissionSetForUser(userID)
	if err != nil || set == nil {
		return false
	}
	for _, c := range permissionCodes {
		if c == "" {
			continue
		}
		if _, ok := set[c]; ok {
			return true
		}
	}
	return false
}

// HasAllPermissions true si tiene todos los permisos indicados (códigos vacíos se ignoran).
func (s *AuthorizationService) HasAllPermissions(userID uint, permissionCodes ...string) bool {
	set, err := s.permissionSetForUser(userID)
	if err != nil || set == nil {
		return false
	}
	for _, c := range permissionCodes {
		if c == "" {
			continue
		}
		if _, ok := set[c]; !ok {
			return false
		}
	}
	return true
}

func (s *AuthorizationService) PermissionCodesForUser(userID uint) ([]string, error) {
	set, err := s.permissionSetForUser(userID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(set))
	for c := range set {
		out = append(out, c)
	}
	return out, nil
}

func (s *AuthorizationService) permissionSetForUser(userID uint) (map[string]struct{}, error) {
	s.mu.RLock()
	if set, ok := s.cache[userID]; ok {
		s.mu.RUnlock()
		return set, nil
	}
	s.mu.RUnlock()

	set, err := s.loadPermissionSet(userID)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.cache[userID] = set
	s.mu.Unlock()
	return set, nil
}

func (s *AuthorizationService) loadPermissionSet(userID uint) (map[string]struct{}, error) {
	var codes []string
	err := database.DB.
		Table("permissions").
		Select("permissions.code").
		Joins("JOIN role_permissions rp ON rp.permission_id = permissions.id").
		Joins("JOIN user_roles ur ON ur.role_id = rp.role_id").
		Where("ur.user_id = ?", userID).
		Group("permissions.code").
		Pluck("permissions.code", &codes).Error
	if err != nil {
		return nil, err
	}

	out := make(map[string]struct{}, len(codes))
	for _, c := range codes {
		out[c] = struct{}{}
	}
	return out, nil
}
