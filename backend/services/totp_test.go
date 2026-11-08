package services

import (
	"strings"
	"testing"
	"time"

	"miappfiber/config"
)

// Secreto y valores de prueba del RFC 6238 (SHA-1; los códigos de 8 dígitos publicados, recortados a 6).
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" // «12345678901234567890» en base32

func TestTOTP_vectoresDelRFC6238(t *testing.T) {
	cases := []struct {
		unix int64
		want string
	}{{59, "287082"}, {1111111109, "081804"}, {1111111111, "050471"}, {1234567890, "005924"}, {2000000000, "279037"}}
	secret, err := decodeTOTPSecret(rfcSecret)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if got := totpCodeAt(secret, c.unix/totpPeriod); got != c.want {
			t.Errorf("t=%d: %s, quería %s", c.unix, got, c.want)
		}
	}
}

func TestTOTPVerify_ventanaYReutilizacion(t *testing.T) {
	now := time.Unix(1234567890, 0)
	// Código del paso actual, del anterior y del siguiente: se aceptan (el reloj del celular puede ir algo desfasado).
	secret, _ := decodeTOTPSecret(rfcSecret)
	cur := now.Unix() / totpPeriod
	for _, d := range []int64{-1, 0, 1} {
		code := totpCodeAt(secret, cur+d)
		step, ok := TOTPVerify(rfcSecret, code, now, 0)
		if !ok || step != cur+d {
			t.Errorf("el paso %+d debía aceptarse: %v %d", d, ok, step)
		}
	}
	// Dos pasos de diferencia ya no.
	if _, ok := TOTPVerify(rfcSecret, totpCodeAt(secret, cur+2), now, 0); ok {
		t.Error("+2 pasos no debía aceptarse")
	}
	if _, ok := TOTPVerify(rfcSecret, totpCodeAt(secret, cur-2), now, 0); ok {
		t.Error("-2 pasos no debía aceptarse")
	}
	// Un código ya usado no sirve otra vez (aunque siga dentro de la ventana).
	code := totpCodeAt(secret, cur)
	step, _ := TOTPVerify(rfcSecret, code, now, 0)
	if _, ok := TOTPVerify(rfcSecret, code, now, step); ok {
		t.Error("el mismo código no puede usarse dos veces")
	}
	// Formato.
	for _, bad := range []string{"", "12345", "1234567", "abcdef", "000000"} {
		if _, ok := TOTPVerify(rfcSecret, bad, now, 0); ok {
			t.Errorf("%q no debía aceptarse", bad)
		}
	}
	if _, ok := TOTPVerify("no es base32 !!!", "123456", now, 0); ok {
		t.Error("un secreto inválido no valida nada")
	}
	// Espacios en el código (las apps lo muestran «123 456»).
	if _, ok := TOTPVerify(rfcSecret, code[:3]+" "+code[3:], now, 0); !ok {
		t.Error("el código con espacio debía aceptarse")
	}
}

func TestTOTP_secretoYDireccionParaElQR(t *testing.T) {
	a, b := NewTOTPSecret(), NewTOTPSecret()
	if len(a) != 32 || a == b || strings.ContainsAny(a, "=0189") {
		t.Errorf("secreto base32 de 160 bits y distinto cada vez: %q %q", a, b)
	}
	uri := TOTPURI("ZContable", "maria@estudio.pe", a)
	if !strings.HasPrefix(uri, "otpauth://totp/ZContable:maria@estudio.pe?") && !strings.HasPrefix(uri, "otpauth://totp/ZContable%3Amaria@estudio.pe?") {
		t.Errorf("dirección: %s", uri)
	}
	for _, want := range []string{"secret=" + a, "issuer=ZContable", "digits=6", "period=30", "algorithm=SHA1"} {
		if !strings.Contains(uri, want) {
			t.Errorf("falta %s en %s", want, uri)
		}
	}
}

func TestSecretBox_cifraYDescifra(t *testing.T) {
	config.AppConfig = &config.Config{JWTSecret: "secreto-de-prueba-largo-largo-largo-123"}
	t.Setenv("APP_ENCRYPTION_KEY", "")
	sealed, err := sealSecret(rfcSecret)
	if err != nil || strings.Contains(sealed, rfcSecret) {
		t.Fatalf("debía cifrar sin dejar el secreto a la vista: %v", err)
	}
	if again, _ := sealSecret(rfcSecret); again == sealed {
		t.Error("cada cifrado usa un valor aleatorio distinto")
	}
	if plain, err := openSecret(sealed); err != nil || plain != rfcSecret {
		t.Errorf("descifrar: %q %v", plain, err)
	}
	// Con otra clave no se puede abrir (por ejemplo, si cambian el secreto de las sesiones).
	t.Setenv("APP_ENCRYPTION_KEY", "otra-clave-distinta")
	if _, err := openSecret(sealed); err == nil {
		t.Error("con otra clave no debía descifrarse")
	}
	t.Setenv("APP_ENCRYPTION_KEY", "")
	if _, err := openSecret("basura"); err == nil {
		t.Error("un valor dañado debía fallar")
	}
	if _, err := openSecret(sealed[:len(sealed)-6]); err == nil {
		t.Error("un valor recortado debía fallar")
	}
}

func TestRecoveryCodes(t *testing.T) {
	plain, hashes := NewRecoveryCodes()
	if len(plain) != 8 || len(hashes) != 8 {
		t.Fatalf("8 códigos: %d %d", len(plain), len(hashes))
	}
	seen := map[string]bool{}
	for i, p := range plain {
		if len(p) != 11 || p[5] != '-' || strings.ContainsAny(p, "ilo01") || seen[p] {
			t.Errorf("formato o repetido: %q", p)
		}
		seen[p] = true
		if hashes[i] != hashRecoveryCode(p) || strings.Contains(hashes[i], p) {
			t.Errorf("la huella debe corresponder y no contener el código: %q", p)
		}
	}
	// Mayúsculas, espacios y sin guion: es el mismo código.
	if hashRecoveryCode(strings.ToUpper(plain[0])) != hashes[0] || hashRecoveryCode(" "+strings.ReplaceAll(plain[0], "-", "")+" ") != hashes[0] {
		t.Error("el código se escribe de varias formas")
	}
}
