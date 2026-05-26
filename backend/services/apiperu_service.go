package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const defaultApiPeruBase = "https://apiperu.dev"

var nonDigitRUC = regexp.MustCompile(`\D`)

// DniLookupResult datos para autocompletar cliente persona natural.
type DniLookupResult struct {
	DNI      string `json:"dni"`
	FullName string `json:"full_name"`
}

type apiPeruDniEnvelope struct {
	Success bool `json:"success"`
	Data    *struct {
		Numero              string `json:"numero"`
		NombreCompleto      string `json:"nombre_completo"`
		Nombres             string `json:"nombres"`
		ApellidoPaterno      string `json:"apellido_paterno"`
		ApellidoMaterno      string `json:"apellido_materno"`
	} `json:"data"`
	Message string `json:"message"`
}

// RucLookupResult datos listos para rellenar el formulario de empresa.
type RucLookupResult struct {
	RUC          string `json:"ruc"`
	BusinessName string `json:"business_name"`
	Address      string `json:"address,omitempty"`
	Estado       string `json:"estado,omitempty"`
	Condicion    string `json:"condicion,omitempty"`
	Departamento string `json:"departamento,omitempty"`
	Provincia    string `json:"provincia,omitempty"`
	Distrito     string `json:"distrito,omitempty"`
}

type apiPeruRucEnvelope struct {
	Success bool `json:"success"`
	Data    *struct {
		RUC                 string   `json:"ruc"`
		NombreORazonSocial  string   `json:"nombre_o_razon_social"`
		Direccion           string   `json:"direccion"`
		DireccionCompleta   string   `json:"direccion_completa"`
		Estado              string   `json:"estado"`
		Condicion           string   `json:"condicion"`
		Departamento        string   `json:"departamento"`
		Provincia           string   `json:"provincia"`
		Distrito            string   `json:"distrito"`
	} `json:"data"`
	Message string `json:"message"`
}

type ApiPeruService struct {
	configService *ConfigService
	httpClient    *http.Client
}

func NewApiPeruService() *ApiPeruService {
	return &ApiPeruService{
		configService: NewConfigService(),
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func NormalizePeruRUC(raw string) string {
	return nonDigitRUC.ReplaceAllString(strings.TrimSpace(raw), "")
}

func NormalizePeruDNI(raw string) string {
	d := nonDigitRUC.ReplaceAllString(strings.TrimSpace(raw), "")
	if len(d) > 8 {
		d = d[:8]
	}
	return d
}

func bearerToken(raw string) string {
	t := strings.TrimSpace(raw)
	t = strings.TrimPrefix(t, "Bearer ")
	t = strings.TrimPrefix(t, "bearer ")
	return strings.TrimSpace(t)
}

func (s *ApiPeruService) LookupRUC(rawRUC string) (*RucLookupResult, error) {
	ruc := NormalizePeruRUC(rawRUC)
	if len(ruc) != 11 {
		return nil, errors.New("el RUC debe tener 11 dígitos")
	}

	cfg, err := s.configService.GetFirmConfig()
	if err != nil {
		return nil, err
	}
	token := bearerToken(cfg.ApiPeruToken)
	if token == "" {
		return nil, errors.New("configura el token de ApiPeru.dev en Ajustes del estudio")
	}

	base := strings.TrimSpace(cfg.ApiPeruBaseURL)
	if base == "" {
		base = defaultApiPeruBase
	}
	base = strings.TrimRight(base, "/")
	endpoint := base + "/api/ruc"

	body, err := json.Marshal(map[string]string{"ruc": ruc})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("no se pudo contactar ApiPeru.dev: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	var env apiPeruRucEnvelope
	if err := json.Unmarshal(respBody, &env); err != nil {
		return nil, fmt.Errorf("respuesta inválida del servicio de RUC")
	}

	if !env.Success || env.Data == nil {
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = "SUNAT no devolvió datos para este RUC"
		}
		return nil, errors.New(msg)
	}

	d := env.Data
	addr := strings.TrimSpace(d.DireccionCompleta)
	if addr == "" {
		addr = strings.TrimSpace(d.Direccion)
	}

	outRUC := strings.TrimSpace(d.RUC)
	if outRUC == "" {
		outRUC = ruc
	}
	return &RucLookupResult{
		RUC:          outRUC,
		BusinessName: strings.TrimSpace(d.NombreORazonSocial),
		Address:      addr,
		Estado:       strings.TrimSpace(d.Estado),
		Condicion:    strings.TrimSpace(d.Condicion),
		Departamento: strings.TrimSpace(d.Departamento),
		Provincia:    strings.TrimSpace(d.Provincia),
		Distrito:     strings.TrimSpace(d.Distrito),
	}, nil
}

func (s *ApiPeruService) LookupDNI(rawDNI string) (*DniLookupResult, error) {
	dni := NormalizePeruDNI(rawDNI)
	if len(dni) != 8 {
		return nil, errors.New("el DNI debe tener 8 dígitos")
	}

	cfg, err := s.configService.GetFirmConfig()
	if err != nil {
		return nil, err
	}
	token := bearerToken(cfg.ApiPeruToken)
	if token == "" {
		return nil, errors.New("configura el token de ApiPeru.dev en Ajustes del estudio")
	}

	base := strings.TrimSpace(cfg.ApiPeruBaseURL)
	if base == "" {
		base = defaultApiPeruBase
	}
	base = strings.TrimRight(base, "/")
	endpoint := base + "/api/dni"

	body, err := json.Marshal(map[string]string{"dni": dni})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("no se pudo contactar ApiPeru.dev: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	var env apiPeruDniEnvelope
	if err := json.Unmarshal(respBody, &env); err != nil {
		return nil, fmt.Errorf("respuesta inválida del servicio de DNI")
	}

	if !env.Success || env.Data == nil {
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = "RENIEC no devolvió datos para este DNI"
		}
		return nil, errors.New(msg)
	}

	d := env.Data
	name := strings.TrimSpace(d.NombreCompleto)
	if name == "" {
		parts := []string{
			strings.TrimSpace(d.Nombres),
			strings.TrimSpace(d.ApellidoPaterno),
			strings.TrimSpace(d.ApellidoMaterno),
		}
		var nonEmpty []string
		for _, p := range parts {
			if p != "" {
				nonEmpty = append(nonEmpty, p)
			}
		}
		name = strings.Join(nonEmpty, " ")
	}
	outDNI := strings.TrimSpace(d.Numero)
	if outDNI == "" {
		outDNI = dni
	}
	if name == "" {
		return nil, errors.New("no se obtuvo nombre para el DNI")
	}
	return &DniLookupResult{DNI: outDNI, FullName: name}, nil
}
