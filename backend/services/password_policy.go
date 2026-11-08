package services

import (
	"crypto/sha1" //nolint:gosec // SHA-1 es lo que exige la API de contraseñas filtradas (k-anonimato); no es para seguridad propia
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

// Política de contraseñas del sistema (al crearlas o cambiarlas; las ya guardadas no se tocan):
//   - de 6 a 72 caracteres (el mínimo es bajo a propósito: parte del personal usa su DNI de 8 dígitos o una clave de 6;
//     lo compensan el bloqueo por intentos fallidos y el rechazo de contraseñas comunes y filtradas) (bcrypt ignora lo que pase de 72 bytes, así que más largo engaña);
//   - no puede ser el usuario ni contenerlo, ni una contraseña muy común, ni una secuencia obvia;
//   - no puede figurar en filtraciones públicas (consulta por k-anonimato a Have I Been Pwned: solo se envían los
//     primeros 5 caracteres del hash, nunca la contraseña; si el servicio no responde, no se bloquea el cambio).

const (
	PasswordMinLen = 6
	passwordMaxLen = 72
)

var errPasswordPolicy = func(msg string) error { return errors.New(msg) }

var commonPasswords = map[string]bool{
	"123456": true, "1234567": true, "12345678": true, "123456789": true, "1234567890": true, "0123456789": true,
	"password": true, "password1": true, "password123": true, "contrasena": true, "contraseña": true, "contrasena1": true,
	"qwerty": true, "qwertyuiop": true, "qwerty123": true, "abc123": true, "abcd1234": true, "admin": true, "admin123": true,
	"administrador": true, "estudio": true, "estudiocontable": true, "contable": true, "contador": true, "sunat": true,
	"sunat123": true, "iloveyou": true, "welcome": true, "welcome1": true, "letmein": true, "changeme": true,
	"peru123": true, "peru2026": true, "lima123": true, "arequipa": true, "arequipa123": true, "zcontable": true, "zcontable123": true,
	"111111": true, "000000": true, "123123": true, "1q2w3e4r": true, "asdfghjkl": true, "1234qwer": true, "qazwsxedc": true,
}

// passwordBreachCheck indica si la contraseña figura en filtraciones públicas. Se reemplaza en las pruebas.
var passwordBreachCheck = pwnedPasswordCheck

// ValidatePasswordPolicy valida una contraseña nueva. `username` evita que la contraseña sea el propio usuario.
func ValidatePasswordPolicy(plain, username string) error {
	n := utf8.RuneCountInString(plain)
	if len(plain) > passwordMaxLen {
		return errPasswordPolicy("la contraseña no puede pasar de 72 caracteres")
	}
	if n < PasswordMinLen {
		return errPasswordPolicy("la contraseña debe tener al menos 6 caracteres")
	}
	if strings.TrimSpace(plain) == "" {
		return errPasswordPolicy("la contraseña no puede estar en blanco")
	}
	low := strings.ToLower(plain)
	if u := strings.ToLower(strings.TrimSpace(username)); len(u) >= 3 && strings.Contains(low, u) {
		return errPasswordPolicy("la contraseña no puede contener el nombre de usuario")
	}
	if commonPasswords[low] || onlyOneCharRepeated(low) || isSimpleSequence(low) {
		return errPasswordPolicy("esa contraseña es demasiado común: elija otra más difícil de adivinar")
	}
	if pwned, err := passwordBreachCheck(plain); err == nil && pwned {
		return errPasswordPolicy("esa contraseña aparece en filtraciones públicas: elija otra distinta")
	}
	return nil
}

func onlyOneCharRepeated(s string) bool {
	r := []rune(s)
	for _, c := range r {
		if c != r[0] {
			return false
		}
	}
	return len(r) > 0
}

// isSimpleSequence 1234567890, abcdefghij, 0987654321… (todos los caracteres consecutivos, subiendo o bajando).
func isSimpleSequence(s string) bool {
	r := []rune(s)
	if len(r) < 4 {
		return false
	}
	up, down := true, true
	for i := 1; i < len(r); i++ {
		if r[i] != r[i-1]+1 {
			up = false
		}
		if r[i] != r[i-1]-1 {
			down = false
		}
	}
	return up || down
}

// pwnedPasswordCheck consulta Have I Been Pwned (k-anonimato). Ante cualquier error devuelve (false, err).
func pwnedPasswordCheck(plain string) (bool, error) {
	sum := sha1.Sum([]byte(plain)) //nolint:gosec
	h := strings.ToUpper(hex.EncodeToString(sum[:]))
	req, err := http.NewRequest(http.MethodGet, "https://api.pwnedpasswords.com/range/"+h[:5], nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("Add-Padding", "true")
	req.Header.Set("User-Agent", "zcontable-password-check")
	resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, errors.New("servicio de contraseñas filtradas no disponible")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return false, err
	}
	for _, line := range strings.Split(string(body), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), ":", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], h[5:]) {
			// Con "Add-Padding" hay filas de relleno con cuenta 0: no cuentan.
			return strings.TrimSpace(parts[1]) != "0", nil
		}
	}
	return false, nil
}
