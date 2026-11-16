package services

import "testing"

// SUNAT muestra los importes con punto de miles y coma decimal («78.000,00»); también aparecen en formato inglés.
func TestParseSunatAmount(t *testing.T) {
	cases := []struct {
		in   string
		want float64
	}{
		{"78.000,00", 78000},
		{"3,90", 3.9},
		{"0,10", 0.1},
		{"2.000,00", 2000},
		{"80.000,00", 80000},
		{"1.234.567,89", 1234567.89},
		{"78,000.00", 78000},
		{"1,000.00", 1000},
		{"0.05", 0.05},
		{"93.00", 93},
		{"1,234", 1234}, // grupos de tres: miles
		{"78.000", 78000},
		{"400", 400},
		{"-1.250,50", -1250.5},
		{" S/ 774.0 ", 774},
	}
	for _, c := range cases {
		got, ok := parseSunatAmount(c.in)
		if !ok || got != c.want {
			t.Errorf("%q = %v (%v), quería %v", c.in, got, ok, c.want)
		}
	}
	for _, bad := range []string{"", "abc", "1,2,x"} {
		if _, ok := parseSunatAmount(bad); ok {
			t.Errorf("%q no es un importe", bad)
		}
	}
}
