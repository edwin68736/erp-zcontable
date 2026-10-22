package services

import (
	"time"

	"miappfiber/models"
)

// Disponibilidad por fecha del calendario: la pantalla oculta la carga de una actividad (entrega de
// Preliminar de ventas, recepción del archivador PDT 621) hasta el día programado. Solo se informa
// (campo `disponible`); el backend no rechaza entregas anticipadas. "Hoy" es la fecha del SERVIDOR en
// Lima (pdt621Now, que los tests pueden fijar), no la de la PC del usuario.

// serverTodayLima fecha de hoy en Lima, AAAA-MM-DD.
func serverTodayLima() string { return pdt621Now().In(limaLoc).Format("2006-01-02") }

// activityDateReached true si ya llegó (o pasó) la fecha programada. Sin fecha configurada en el
// calendario no hay contra qué bloquear: siempre disponible.
func activityDateReached(due *time.Time) bool {
	if due == nil {
		return true
	}
	return serverTodayLima() >= due.Format("2006-01-02")
}

// preliminarRegistradoAt cuándo se registraron por primera vez los datos de la entrega = cuándo se
// entregó. El registro solo se crea al guardar, así que es su CreatedAt. Nil si aún no hay registro.
func preliminarRegistradoAt(r *models.SupervisorPreliminarVentasRecord) *time.Time {
	if r == nil || r.ID == 0 || r.CreatedAt.IsZero() {
		return nil
	}
	at := r.CreatedAt
	return &at
}
