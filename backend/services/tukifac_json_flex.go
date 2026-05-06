package services

import (
	"encoding/json"
	"strconv"
	"strings"
)

// TukifacFlexFloat decodifica total/montos que Tukifac puede enviar como número o como string.
type TukifacFlexFloat float64

func (f *TukifacFlexFloat) UnmarshalJSON(b []byte) error {
	s := strings.TrimSpace(string(b))
	if s == "null" || s == "" {
		*f = 0
		return nil
	}
	if len(s) > 0 && s[0] == '"' {
		var str string
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
		str = strings.TrimSpace(str)
		if str == "" {
			*f = 0
			return nil
		}
		v, err := strconv.ParseFloat(str, 64)
		if err != nil {
			return err
		}
		*f = TukifacFlexFloat(v)
		return nil
	}
	var v float64
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*f = TukifacFlexFloat(v)
	return nil
}

func (f TukifacFlexFloat) Float64() float64 { return float64(f) }

// TukifacFlexInt decodifica id que a veces viene como string en APIs distintas.
type TukifacFlexInt int

func (i *TukifacFlexInt) UnmarshalJSON(b []byte) error {
	s := strings.TrimSpace(string(b))
	if s == "null" || s == "" {
		*i = 0
		return nil
	}
	if len(s) > 0 && s[0] == '"' {
		var str string
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
		str = strings.TrimSpace(str)
		if str == "" {
			*i = 0
			return nil
		}
		v, err := strconv.ParseInt(str, 10, 64)
		if err != nil {
			return err
		}
		*i = TukifacFlexInt(v)
		return nil
	}
	var v float64
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*i = TukifacFlexInt(int64(v))
	return nil
}

func (i TukifacFlexInt) Int() int { return int(i) }

// TukifacFlexString decodifica campos como number que Tukifac puede enviar como número JSON o como string.
type TukifacFlexString string

func (s *TukifacFlexString) UnmarshalJSON(b []byte) error {
	raw := strings.TrimSpace(string(b))
	if raw == "" || raw == "null" {
		*s = ""
		return nil
	}
	if len(raw) > 0 && raw[0] == '"' {
		var str string
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
		*s = TukifacFlexString(str)
		return nil
	}
	var f float64
	if err := json.Unmarshal(b, &f); err == nil {
		if f == float64(int64(f)) {
			*s = TukifacFlexString(strconv.FormatInt(int64(f), 10))
		} else {
			*s = TukifacFlexString(strconv.FormatFloat(f, 'f', -1, 64))
		}
		return nil
	}
	var str string
	if err := json.Unmarshal(b, &str); err != nil {
		return err
	}
	*s = TukifacFlexString(str)
	return nil
}

func (s TukifacFlexString) String() string { return string(s) }
