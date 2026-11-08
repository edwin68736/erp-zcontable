package config

import "testing"

func TestCORSOrigins(t *testing.T) {
	base := corsOriginsFrom("")
	has := func(list []string, o string) bool {
		for _, x := range list {
			if x == o {
				return true
			}
		}
		return false
	}
	for _, o := range []string{"https://zcontables.net", "https://zcontables.gestionweb.cloud", "http://localhost:5173"} {
		if !has(base, o) {
			t.Errorf("falta el origen de siempre %s", o)
		}
	}
	if has(base, "*") || has(base, "https://otro-sitio.com") {
		t.Error("por defecto no se permite cualquier origen")
	}
	extra := corsOriginsFrom(" https://nuevo.ejemplo.com/ , ,https://otro.ejemplo.com")
	if !has(extra, "https://nuevo.ejemplo.com") || !has(extra, "https://otro.ejemplo.com") || !has(extra, "https://zcontables.net") {
		t.Errorf("los extra se suman a los de siempre y sin barra final: %v", extra)
	}
	if all := corsOriginsFrom("https://x.com, *"); len(all) != 1 || all[0] != "*" {
		t.Errorf("«*» vuelve a permitir todos: %v", all)
	}
}

func TestCORSAllowHeaders_incluyeLaCabeceraDeActividad(t *testing.T) {
	found := false
	for _, h := range CORSAllowHeaders {
		if h == "X-Client-Active" {
			found = true
		}
	}
	if !found {
		t.Fatal("sin X-Client-Active el navegador bloquea las peticiones de quien está usando la pantalla")
	}
}
