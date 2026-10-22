package database

import (
	"errors"
	"sort"
	"strings"
	"time"

	"miappfiber/models"

	"gorm.io/gorm"
)

// migratePdt621ObservacionesANotas pasa las notas libres que los supervisores escribieron en la
// tarjeta "Observaciones" del detalle PDT 621 (botón "Agregar", que se retira) a las "Notas
// adicionales" del registro (supervisor_pdt621_records.observacion), con su fecha, para no perderlas.
// Se agregan debajo de lo que ya hubiera. Se omiten los motivos de "Observar" (mismo texto que
// supervisor_declarations.notes): esos siguen siendo la observación de la declaración. Las filas
// originales no se borran. Una sola vez (applyMigrationOnce) y en una transacción.
func migratePdt621ObservacionesANotas(db *gorm.DB) error {
	type obsRow struct {
		Body      string
		CreatedAt time.Time
		ControlID uint
		Notes     string
	}
	var rows []obsRow
	if err := db.Table("supervisor_observations AS o").
		Select("o.body, o.created_at, d.monthly_control_id AS control_id, d.notes").
		Joins("INNER JOIN supervisor_declarations d ON d.id = o.declaration_id AND d.declaration_type = ? AND d.deleted_at IS NULL", models.SupervisorDeclPDT621).
		Where("o.deleted_at IS NULL").
		Order("o.created_at ASC, o.id ASC").
		Scan(&rows).Error; err != nil {
		return err
	}
	porControl := map[uint][]string{}
	for _, r := range rows {
		body := strings.TrimSpace(r.Body)
		if body == "" || body == strings.TrimSpace(r.Notes) {
			continue
		}
		porControl[r.ControlID] = append(porControl[r.ControlID], r.CreatedAt.Format("02/01/2006")+": "+body)
	}
	if len(porControl) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(porControl))
	for id := range porControl {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	return db.Transaction(func(tx *gorm.DB) error {
		for _, ctrlID := range ids {
			lineas := strings.Join(porControl[ctrlID], "\n")
			var rec models.SupervisorPdt621Record
			err := tx.Where("monthly_control_id = ?", ctrlID).First(&rec).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(&models.SupervisorPdt621Record{MonthlyControlID: ctrlID, Observacion: lineas}).Error; err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			nota := strings.TrimSpace(rec.Observacion)
			if nota != "" {
				nota += "\n"
			}
			if err := tx.Model(&rec).Update("observacion", nota+lineas).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
