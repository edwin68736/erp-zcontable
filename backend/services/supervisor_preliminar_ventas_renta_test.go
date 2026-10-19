package services

import "testing"

func TestResolvePreliminarVentasRenta(t *testing.T) {
	cases := []struct {
		name                       string
		own                        string
		ownCoef                    float64
		inherited                  string
		inheritedCoef              float64
		company                    string
		wantRegimen, wantOrigen    string
		wantCoef                   float64
	}{
		{"elegido en la entrega manda sobre todo", "rer", 0, "mype", 0, "general", "rer", "entrega", 0},
		{"alias rmt se normaliza", "RMT", 0, "", 0, "", "mype", "entrega", 0},
		{"hereda de la entrega 1", "", 0, "general", 0, "mype", "general", "entrega_1", 0},
		{"hereda coeficiente de la entrega 1", "", 0, "coeficiente", 1.8, "mype", "coeficiente", "entrega_1", 1.8},
		{"toma el de la empresa", "", 0, "", 0, "rer", "rer", "empresa", 0},
		{"empresa sin régimen cargado → MYPE por defecto", "", 0, "", 0, "", "mype", "por_defecto", 0},
		{"valor desconocido en la empresa → MYPE por defecto", "", 0, "", 0, "otro", "mype", "por_defecto", 0},
		{"coeficiente fuera de 'coeficiente' se ignora", "mype", 2.5, "", 0, "", "mype", "entrega", 0},
	}
	for _, c := range cases {
		reg, coef, origen := resolvePreliminarVentasRenta(c.own, c.ownCoef, c.inherited, c.inheritedCoef, c.company)
		if reg != c.wantRegimen || origen != c.wantOrigen || coef != c.wantCoef {
			t.Errorf("%s: got (%q, %v, %q), want (%q, %v, %q)", c.name, reg, coef, origen, c.wantRegimen, c.wantCoef, c.wantOrigen)
		}
	}
}

func TestPreliminarVentasRentaRatePct(t *testing.T) {
	cases := []struct {
		regimen string
		coef    float64
		want    float64
	}{
		{"mype", 0, 1},
		{"rer", 0, 1.5},
		{"general", 0, 1.5},
		{"coeficiente", 2.35, 2.35},
		{"coeficiente", 0, 0},
		{"", 0, 1},
	}
	for _, c := range cases {
		if got := preliminarVentasRentaRatePct(c.regimen, c.coef); got != c.want {
			t.Errorf("tasa(%q, %v) = %v, quiero %v", c.regimen, c.coef, got, c.want)
		}
	}
}
