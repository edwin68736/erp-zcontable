package services

import (
	"sync"
	"time"

	"miappfiber/database"
	"miappfiber/models"

	"gorm.io/gorm"
)

// Caché corta de datos de consulta que casi nunca cambian y que las pantallas del supervisor piden una vez POR EMPRESA y por
// módulo (la regla de la actividad del calendario y la fecha del cronograma SUNAT): sin ella, un solo panel hacía decenas
// de miles de consultas idénticas. Vive en memoria del proceso, caduca sola a los pocos segundos y se vacía al editar
// reglas o el cronograma. Las entradas llevan la conexión a la BD como parte de la clave, así que dos bases (por ejemplo las de
// las pruebas) nunca se mezclan.

// lookupCacheTTL cuánto dura una entrada. 0 = sin caché (los tests lo dejan así para no arrastrar datos entre casos).
var lookupCacheTTL = 30 * time.Second

type lookupKey struct {
	db   *gorm.DB
	kind string
	id   uint
}

type lookupEntry struct {
	value any
	at    time.Time
}

var lookupCache = struct {
	sync.RWMutex
	m map[lookupKey]lookupEntry
}{m: map[lookupKey]lookupEntry{}}

func lookupGet(kind string, id uint) (any, bool) {
	if lookupCacheTTL <= 0 {
		return nil, false
	}
	lookupCache.RLock()
	e, ok := lookupCache.m[lookupKey{database.DB, kind, id}]
	lookupCache.RUnlock()
	if !ok || time.Since(e.at) > lookupCacheTTL {
		return nil, false
	}
	return e.value, true
}

func lookupSet(kind string, id uint, v any) {
	if lookupCacheTTL <= 0 {
		return
	}
	lookupCache.Lock()
	if len(lookupCache.m) > 5000 { // tope de seguridad: nunca crece sin límite
		lookupCache.m = map[lookupKey]lookupEntry{}
	}
	lookupCache.m[lookupKey{database.DB, kind, id}] = lookupEntry{value: v, at: time.Now()}
	lookupCache.Unlock()
}

// ClearLookupCaches vacía la caché (se llama al editar reglas de actividad o el cronograma SUNAT).
func ClearLookupCaches() {
	lookupCache.Lock()
	lookupCache.m = map[lookupKey]lookupEntry{}
	lookupCache.Unlock()
}

const (
	lookupKindRule     = "activity_rule"
	lookupKindSchedule = "sunat_schedule_month"
)

// cachedActivityRule la regla por ID. active=false: existe pero está inactiva. err: no se pudo leer (no se guarda en caché).
func cachedActivityRule(id uint) (rule *models.ActivityRule, active bool, err error) {
	if v, ok := lookupGet(lookupKindRule, id); ok {
		r, _ := v.(*models.ActivityRule)
		if r == nil {
			return nil, false, nil
		}
		cp := *r // copia: quien la reciba no puede alterar la que está en caché
		return &cp, true, nil
	}
	var r models.ActivityRule
	if err := database.DB.First(&r, id).Error; err != nil {
		return nil, false, err
	}
	if !r.Active {
		lookupSet(lookupKindRule, id, (*models.ActivityRule)(nil))
		return nil, false, nil
	}
	lookupSet(lookupKindRule, id, &r)
	cp := r
	return &cp, true, nil
}

// cachedScheduleRow la fila del cronograma SUNAT de un mes (1 al 12).
func cachedScheduleRow(month int) (*models.SunatDueDateCalendarRow, error) {
	if v, ok := lookupGet(lookupKindSchedule, uint(month)); ok {
		if r, _ := v.(*models.SunatDueDateCalendarRow); r != nil {
			cp := *r
			return &cp, nil
		}
	}
	var row models.SunatDueDateCalendarRow
	if err := database.DB.Where("month = ?", month).First(&row).Error; err != nil {
		return nil, err
	}
	lookupSet(lookupKindSchedule, uint(month), &row)
	cp := row
	return &cp, nil
}
