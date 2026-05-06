package services

import (
	"encoding/json"
	"strings"
)

// tukifacSaleNoteListItem refleja solo los campos que usa Tukifac en sale-note/lists; el resto del JSON se ignora.
type tukifacSaleNoteListItem struct {
	ID                   TukifacFlexInt    `json:"id"`
	ExternalID           string            `json:"external_id"`
	DateOfIssue          string            `json:"date_of_issue"`
	DueDate              *string           `json:"due_date"`
	FullNumber           TukifacFlexString `json:"full_number"`
	NumberFull           TukifacFlexString `json:"number_full"`
	Identifier           TukifacFlexString `json:"identifier"`
	CustomerName         string            `json:"customer_name"`
	CustomerNumber       string            `json:"customer_number"`
	CurrencyTypeID       string            `json:"currency_type_id"`
	Total                TukifacFlexFloat  `json:"total"`
	StateTypeID          string            `json:"state_type_id"`
	StateTypeDescription string            `json:"state_type_description"`
	PrintA4              string            `json:"print_a4"`
	PdfA4Filename        string            `json:"pdf_a4_filename"`
	CreatedAt            string            `json:"created_at"`
	UpdatedAt            string            `json:"updated_at"`
}

type tukifacSaleNoteListEnvelope struct {
	Data []tukifacSaleNoteListItem `json:"data"`
}

func mapSaleNoteListItemToUnified(s tukifacSaleNoteListItem) TukifacDocumentsListItem {
	num := strings.TrimSpace(s.FullNumber.String())
	if num == "" {
		num = strings.TrimSpace(s.NumberFull.String())
	}
	if num == "" {
		num = strings.TrimSpace(s.Identifier.String())
	}
	due := ""
	if s.DueDate != nil {
		due = strings.TrimSpace(*s.DueDate)
	}
	pdfURL := strings.TrimSpace(s.PdfA4Filename)
	if pdfURL == "" {
		pdfURL = strings.TrimSpace(s.PrintA4)
	}
	return TukifacDocumentsListItem{
		ID:                   s.ID,
		DateOfIssue:          strings.TrimSpace(s.DateOfIssue),
		DateOfDue:            due,
		Number:               TukifacFlexString(num),
		CustomerName:         s.CustomerName,
		CustomerNumber:       s.CustomerNumber,
		CurrencyTypeID:       s.CurrencyTypeID,
		Total:                s.Total,
		StateTypeID:          s.StateTypeID,
		StateTypeDescription: s.StateTypeDescription,
		DocumentTypeID:       "NV",
		DocumentTypeDesc:     "Nota de venta",
		HasXML:               false,
		HasPDF:               pdfURL != "",
		HasCDR:               false,
		DownloadPDF:          pdfURL,
		ExternalID:           strings.TrimSpace(s.ExternalID),
		CreatedAt:            s.CreatedAt,
		UpdatedAt:            s.UpdatedAt,
	}
}

func decodeTukifacSaleNoteListResponse(body []byte) (*TukifacDocumentsListResponse, error) {
	var env tukifacSaleNoteListEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	out := make([]TukifacDocumentsListItem, 0, len(env.Data))
	for _, row := range env.Data {
		out = append(out, mapSaleNoteListItemToUnified(row))
	}
	return &TukifacDocumentsListResponse{Data: out}, nil
}
