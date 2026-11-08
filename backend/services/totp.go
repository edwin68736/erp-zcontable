package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // HMAC-SHA1 es lo que define TOTP (RFC 6238) y lo que usan Google Authenticator y Authy
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"miappfiber/config"
)

// Contraseña de un solo uso por tiempo (TOTP, RFC 6238): el código de 6 dígitos que muestran Google Authenticator,
// Authy o Microsoft Authenticator en el celular de la persona. Sin correo ni servicios externos.

const (
	totpPeriod = 30 // segundos que dura cada código
	totpDigits = 6
	totpSkew   = 1 // se aceptan el código anterior y el siguiente (reloj del celular algo desfasado)
)

// NewTOTPSecret secreto aleatorio de 160 bits en base32 (el formato que leen las apps).
func NewTOTPSecret() string {
	b := make([]byte, 20)
	_, _ = rand.Read(b)
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
}

func totpCodeAt(secret []byte, counter int64) string {
	msg := make([]byte, 8)
	binary.BigEndian.PutUint64(msg, uint64(counter))
	mac := hmac.New(sha1.New, secret) //nolint:gosec
	mac.Write(msg)
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	v := (binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff) % 1_000_000
	return fmt.Sprintf("%0*d", totpDigits, v)
}

// TOTPCodeAt el código que mostraría la app de autenticación en el instante `t` (se usa en las pruebas).
func TOTPCodeAt(secretB32 string, t time.Time) string {
	secret, err := decodeTOTPSecret(secretB32)
	if err != nil {
		return ""
	}
	return totpCodeAt(secret, t.Unix()/totpPeriod)
}

func decodeTOTPSecret(secretB32 string) ([]byte, error) {
	s := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secretB32), " ", ""))
	return base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(s)
}

// TOTPVerify valida un código. `lastStep` es el último paso ya usado: un mismo código no sirve dos veces (si alguien
// lo espía no puede reutilizarlo). Devuelve el paso aceptado.
func TOTPVerify(secretB32, code string, now time.Time, lastStep int64) (int64, bool) {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != totpDigits {
		return 0, false
	}
	secret, err := decodeTOTPSecret(secretB32)
	if err != nil || len(secret) == 0 {
		return 0, false
	}
	cur := now.Unix() / totpPeriod
	for d := int64(-totpSkew); d <= totpSkew; d++ {
		step := cur + d
		if step <= lastStep {
			continue
		}
		if hmac.Equal([]byte(totpCodeAt(secret, step)), []byte(code)) {
			return step, true
		}
	}
	return 0, false
}

// TOTPURI dirección otpauth:// que lee el código QR de la app.
func TOTPURI(issuer, account, secretB32 string) string {
	label := url.PathEscape(issuer + ":" + account)
	q := url.Values{"secret": {secretB32}, "issuer": {issuer}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// ───────────────────────────── Secretos cifrados ─────────────────────────────

// secretBoxKey clave con la que se cifran los secretos TOTP guardados en la base. Sale de APP_ENCRYPTION_KEY si está
// definida; si no, del secreto de las sesiones. (Si algún día se cambia esa clave, las personas deben volver a
// configurar su verificación en dos pasos.)
func secretBoxKey() [32]byte {
	base := strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY"))
	if base == "" && config.AppConfig != nil {
		base = config.AppConfig.JWTSecret
	}
	return sha256.Sum256([]byte("zcontable-secretbox-v1|" + base))
}

// sealSecret cifra con AES-256-GCM (y un valor aleatorio distinto cada vez).
func sealSecret(plain string) (string, error) {
	key := secretBoxKey()
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func openSecret(sealed string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	key := secretBoxKey()
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("secreto dañado")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("no se pudo descifrar el secreto")
	}
	return string(plain), nil
}

// ───────────────────────────── Códigos de recuperación ─────────────────────────────

// NewRecoveryCodes 8 códigos de un solo uso para quien pierda el celular. Devuelve los códigos en claro (se muestran
// una sola vez) y sus huellas (lo único que se guarda).
func NewRecoveryCodes() (plain []string, hashes []string) {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789" // sin letras que se confunden (i, l, o, 0, 1)
	for i := 0; i < 8; i++ {
		b := make([]byte, 10)
		_, _ = rand.Read(b)
		var sb strings.Builder
		for j, x := range b {
			if j == 5 {
				sb.WriteByte('-')
			}
			sb.WriteByte(alphabet[int(x)%len(alphabet)])
		}
		plain = append(plain, sb.String())
		hashes = append(hashes, hashRecoveryCode(sb.String()))
	}
	return plain, hashes
}

func hashRecoveryCode(code string) string {
	c := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	h := sha256.Sum256([]byte("zcontable-recovery-v1|" + c))
	return base64.RawStdEncoding.EncodeToString(h[:])
}
