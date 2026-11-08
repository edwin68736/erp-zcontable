package config

import "testing"

func TestWeakJWTSecret(t *testing.T) {
	weak := []string{"", "   ", DefaultJWTSecret, "corto", "12345678901234567890123456789"}
	for _, s := range weak {
		if !WeakJWTSecret(s) {
			t.Errorf("%q debía considerarse débil", s)
		}
	}
	if WeakJWTSecret("k3Jx9vQ2mZpL7wRt5YbN8cHd4FgS6aUe0XoIq1TyVz3W") {
		t.Error("un secreto largo y propio no es débil")
	}
}

func TestEnforceStrongSecrets(t *testing.T) {
	t.Setenv("ENFORCE_STRONG_SECRETS", "")
	if EnforceStrongSecrets() {
		t.Error("por defecto no se exige (para no tumbar un servidor existente)")
	}
	for _, v := range []string{"true", "1", "TRUE", " si "} {
		t.Setenv("ENFORCE_STRONG_SECRETS", v)
		if !EnforceStrongSecrets() {
			t.Errorf("%q debía exigir", v)
		}
	}
}
