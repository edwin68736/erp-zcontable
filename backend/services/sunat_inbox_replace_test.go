package services

import (
	"testing"

	"miappfiber/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Regresión: reemplazar el archivo de un slot con el adjunto viejo precargado debe guardar el id nuevo.
func TestMailboxSlotReplaceKeepsNewAttachment(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.SupervisorAttachment{}, &models.SupervisorMailboxCaptureSlot{}); err != nil {
		t.Fatal(err)
	}
	viejo := models.SupervisorAttachment{FileName: "viejo.pdf", FileURL: "/storage/viejo.pdf"}
	nuevo := models.SupervisorAttachment{FileName: "nuevo.pdf", FileURL: "/storage/nuevo.pdf"}
	db.Create(&viejo)
	db.Create(&nuevo)
	seed := models.SupervisorMailboxCaptureSlot{MonthlyControlID: 1, SlotIndex: 1, SlotsPerWeek: 1, SunatAttachmentID: &viejo.ID}
	db.Create(&seed)

	var slot models.SupervisorMailboxCaptureSlot
	db.Preload("SunatAttachment").First(&slot, seed.ID)
	if err := db.Model(&slot).Omit(clause.Associations).Updates(map[string]interface{}{"sunat_attachment_id": nuevo.ID}).Error; err != nil {
		t.Fatal(err)
	}
	var got models.SupervisorMailboxCaptureSlot
	db.Preload("SunatAttachment").First(&got, seed.ID)
	if got.SunatAttachment == nil || got.SunatAttachment.FileName != "nuevo.pdf" {
		t.Fatalf("el slot sigue con el adjunto anterior: %+v", got.SunatAttachment)
	}
}
