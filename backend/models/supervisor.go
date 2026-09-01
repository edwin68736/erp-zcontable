package models

import (
	"time"

	"gorm.io/gorm"
)

// Estados período contable supervisor.
const (
	SupervisorPeriodOpen   = "abierto"
	SupervisorPeriodClosed = "cerrado"
)

// Control mensual por empresa.
const (
	SupervisorControlAlDia     = "al_dia"
	SupervisorControlPendiente = "pendiente"
	SupervisorControlObservado = "observado"
	SupervisorControlVencido   = "vencido"
	SupervisorControlCerrado   = "cerrado"
)

const (
	SupervisorRiskBajo    = "bajo"
	SupervisorRiskMedio   = "medio"
	SupervisorRiskAlto    = "alto"
	SupervisorRiskCritico = "critico"
)

// Prioridad de tarea/declaración (equivalente tareas_contables).
const (
	SupervisorPriorityBaja    = "baja"
	SupervisorPriorityMedia   = "media"
	SupervisorPriorityAlta    = "alta"
	SupervisorPriorityCritica = "critica"
)

// Declaraciones tributarias y módulos de actividad (lazy create por módulo).
const (
	SupervisorDeclPDT601             = "pdt_601"
	SupervisorDeclPDT621             = "pdt_621"
	SupervisorDeclSIRE               = "sire"
	SupervisorDeclRentaAnual         = "renta_anual"
	SupervisorDeclSunatInbox         = "sunat_inbox"
	SupervisorDeclDetracciones       = "detracciones"
	SupervisorDeclDistractionsLegacy = "distractions" // legacy F4; lectura/migración únicamente
)

// Estados operativos Buzón SOL (declaration_type sunat_inbox).
const (
	SupervisorSunatSinRegistro   = "sin_registro"
	SupervisorSunatComunicado    = "comunicado"
	SupervisorSunatSinCulpa      = "sin_culpa"
	SupervisorSunatNoVisualizado = "no_visualizado"
	SupervisorSunatValidado      = "validado"
)

// Estados operativos Control de Detracciones SUNAT (declaration_type detracciones).
const (
	SupervisorDetraccionDepositoPendiente  = "deposito_pendiente"
	SupervisorDetraccionDepositoRegistrado = "deposito_registrado"
	SupervisorDetraccionSinOperaciones     = "sin_operaciones"
	// Flujo operativo simplificado (Control de Detracciones).
	SupervisorDetraccionCargado       = "cargado"
	SupervisorDetraccionVerificado    = "verificado"
	SupervisorDetraccionSinClave      = "sin_clave"
	SupervisorDetraccionNoCorresponde = "no_corresponde"
	// Legacy F4 pre-F4.1a (solo migración / lectura histórica).
	SupervisorDistractionAbierto   = "abierto"
	SupervisorDistractionEnProceso = "en_proceso"
	SupervisorDistractionResuelto  = "resuelto"
	SupervisorDistractionEscalado  = "escalado"
)

const (
	SupervisorDeclPendiente     = "pendiente"
	SupervisorDeclEnElaboracion = "en_elaboracion"
	SupervisorDeclEnRevision    = "en_revision"
	SupervisorDeclObservado     = "observado"
	SupervisorDeclAprobado      = "aprobado"
	SupervisorDeclPresentado    = "presentado"
	SupervisorDeclCerrado       = "cerrado"
)

const (
	SupervisorLiqPendiente = "pendiente"
	SupervisorLiqAprobada  = "aprobada"
	SupervisorLiqObservada = "observada"
)

const (
	SupervisorNPSPendienteGenerar = "pendiente_generar"
	SupervisorNPSGenerado         = "generado"
	SupervisorNPSEnviadoCliente   = "enviado_cliente"
	SupervisorNPSPendientePago    = "pendiente_pago"
	SupervisorNPSPagado           = "pagado"
	SupervisorNPSVencido          = "vencido"
)

// SupervisorPeriod período mensual del módulo supervisores (YYYY-MM).
type SupervisorPeriod struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	PeriodYM       string         `gorm:"size:7;not null;uniqueIndex" json:"period_ym"`
	Status         string         `gorm:"size:20;not null;default:'abierto'" json:"status"`
	Notes          string         `gorm:"type:text" json:"notes,omitempty"`
	ClosedAt       *time.Time     `json:"closed_at,omitempty"`
	ClosedByUserID *uint          `gorm:"index" json:"closed_by_user_id,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`

	ClosedBy *User `gorm:"foreignKey:ClosedByUserID" json:"closed_by,omitempty"`
}

func (SupervisorPeriod) TableName() string { return "supervisor_periods" }

// SupervisorMonthlyControl control mensual por empresa y período.
type SupervisorMonthlyControl struct {
	ID                uint           `gorm:"primaryKey" json:"id"`
	CompanyID         uint           `gorm:"not null;index:idx_sup_ctrl_co_period,unique" json:"company_id"`
	PeriodYM          string         `gorm:"size:7;not null;index:idx_sup_ctrl_co_period,unique" json:"period_ym"`
	TaxRegime         string         `gorm:"size:80" json:"tax_regime,omitempty"`
	ResponsibleUserID *uint          `gorm:"index" json:"responsible_user_id,omitempty"`
	SupervisorUserID  *uint          `gorm:"index" json:"supervisor_user_id,omitempty"`
	DueDate           *time.Time     `gorm:"type:date" json:"due_date,omitempty"`
	GeneralStatus     string         `gorm:"size:30;not null;default:'pendiente'" json:"general_status"`
	RiskLevel         string         `gorm:"size:20;not null;default:'bajo'" json:"risk_level"`
	Observations      string         `gorm:"type:text" json:"observations,omitempty"`
	InfoReceivedAt    *time.Time     `json:"info_received_at,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	DeletedAt         gorm.DeletedAt `gorm:"index" json:"-"`

	Company     *Company `gorm:"foreignKey:CompanyID" json:"company,omitempty"`
	Responsible *User    `gorm:"foreignKey:ResponsibleUserID" json:"responsible,omitempty"`
	Supervisor  *User    `gorm:"foreignKey:SupervisorUserID" json:"supervisor,omitempty"`
}

func (SupervisorMonthlyControl) TableName() string { return "supervisor_monthly_controls" }

// SupervisorDeclaration declaración tributaria ligada a un control mensual.
type SupervisorDeclaration struct {
	ID                uint           `gorm:"primaryKey" json:"id"`
	MonthlyControlID  uint           `gorm:"not null;index:idx_sup_decl_ctrl_type,unique" json:"monthly_control_id"`
	DeclarationType   string         `gorm:"size:30;not null;index:idx_sup_decl_ctrl_type,unique" json:"declaration_type"`
	Status            string         `gorm:"size:30;not null;default:'pendiente'" json:"status"`
	ProgressPct       int            `gorm:"not null;default:0" json:"progress_pct"`
	Priority          string         `gorm:"size:20;not null;default:'media'" json:"priority"`
	DueDate           *time.Time     `gorm:"type:date" json:"due_date,omitempty"`
	ResponsibleUserID *uint          `gorm:"index" json:"responsible_user_id,omitempty"`
	ApproverUserID    *uint          `gorm:"index" json:"approver_user_id,omitempty"`
	Notes             string         `gorm:"type:text" json:"notes,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	DeletedAt         gorm.DeletedAt `gorm:"index" json:"-"`

	MonthlyControl *SupervisorMonthlyControl `gorm:"foreignKey:MonthlyControlID" json:"monthly_control,omitempty"`
	Responsible    *User                     `gorm:"foreignKey:ResponsibleUserID" json:"responsible,omitempty"`
	Approver       *User                     `gorm:"foreignKey:ApproverUserID" json:"approver,omitempty"`
}

func (SupervisorDeclaration) TableName() string { return "supervisor_declarations" }

// SupervisorTaxLiquidation liquidación de impuestos del control (módulo supervisor).
type SupervisorTaxLiquidation struct {
	ID                uint           `gorm:"primaryKey" json:"id"`
	MonthlyControlID  uint           `gorm:"not null;uniqueIndex" json:"monthly_control_id"`
	IGV               float64        `gorm:"type:decimal(15,2);not null;default:0" json:"igv"`
	RentaMensual      float64        `gorm:"type:decimal(15,2);not null;default:0" json:"renta_mensual"`
	OtrosTributos     float64        `gorm:"type:decimal(15,2);not null;default:0" json:"otros_tributos"`
	TotalPagar        float64        `gorm:"type:decimal(15,2);not null;default:0" json:"total_pagar"`
	CalculatedAt      *time.Time     `json:"calculated_at,omitempty"`
	ResponsibleUserID *uint          `gorm:"index" json:"responsible_user_id,omitempty"`
	ApproverUserID    *uint          `gorm:"index" json:"approver_user_id,omitempty"`
	ValidationStatus  string         `gorm:"size:30;not null;default:'pendiente'" json:"validation_status"`
	Notes             string         `gorm:"type:text" json:"notes,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
	DeletedAt         gorm.DeletedAt `gorm:"index" json:"-"`

	MonthlyControl *SupervisorMonthlyControl `gorm:"foreignKey:MonthlyControlID" json:"monthly_control,omitempty"`
	Responsible    *User                     `gorm:"foreignKey:ResponsibleUserID" json:"responsible,omitempty"`
	Approver       *User                     `gorm:"foreignKey:ApproverUserID" json:"approver,omitempty"`
}

func (SupervisorTaxLiquidation) TableName() string { return "supervisor_tax_liquidations" }

// SupervisorPdt601Planilla planilla electrónica PDT 601 del control (una por empresa+período).
// Datos ingresados manualmente por el supervisor; se cuelga del control mensual como
// SupervisorTaxLiquidation, así queda naturalmente scopeada por (company_id, period_ym).
type SupervisorPdt601Planilla struct {
	ID               uint `gorm:"primaryKey" json:"id"`
	MonthlyControlID uint `gorm:"not null;uniqueIndex" json:"monthly_control_id"`
	// La empresa no tiene planilla en este período: no se exige registrar nada más.
	SinPlanilla bool `gorm:"not null;default:false" json:"sin_planilla"`
	// Nro. de trabajadores (el TOTAL se deriva: ONP + AFP).
	TrabajadoresONP int `gorm:"not null;default:0" json:"trabajadores_onp"`
	TrabajadoresAFP int `gorm:"not null;default:0" json:"trabajadores_afp"`
	// Importes PDT 601.
	Essalud float64 `gorm:"type:decimal(15,2);not null;default:0" json:"essalud"`
	Onp     float64 `gorm:"type:decimal(15,2);not null;default:0" json:"onp"`
	Afp     float64 `gorm:"type:decimal(15,2);not null;default:0" json:"afp"`
	Sis     float64 `gorm:"type:decimal(15,2);not null;default:0" json:"sis"`
	Rta4ta  float64 `gorm:"type:decimal(15,2);not null;default:0" json:"rta_4ta"`
	Rta5ta  float64 `gorm:"type:decimal(15,2);not null;default:0" json:"rta_5ta"`
	// Sctr: monto fijo (no se calcula), se sincroniza con la sección 601 de la liquidación —
	// mismo patrón de auto-completar/sincronizar que essalud/onp/afp/sis/rta_4ta/rta_5ta.
	Sctr float64 `gorm:"type:decimal(15,2);not null;default:0" json:"sctr"`
	Rh   float64 `gorm:"type:decimal(15,2);not null;default:0" json:"rh"`
	// Seguimiento.
	FechaEntrega *time.Time `gorm:"type:date" json:"fecha_entrega,omitempty"`
	// HoraEntrega hora de entrega (HH:MM), texto libre igual que NPS/TicketAFP — la registra
	// el asistente junto con FechaEntrega; el resto de "Seguimiento" lo completa el supervisor.
	HoraEntrega                 string         `gorm:"size:5" json:"hora_entrega,omitempty"`
	Observaciones               string         `gorm:"type:text" json:"observaciones,omitempty"`
	FechaDeclaracionPdt         *time.Time     `gorm:"type:date" json:"fecha_declaracion_pdt,omitempty"`
	NPS                         string         `gorm:"size:120" json:"nps,omitempty"`
	TicketAFP                   string         `gorm:"size:120" json:"ticket_afp,omitempty"`
	EstadoEnvioBoletas          string         `gorm:"size:60" json:"estado_envio_boletas,omitempty"`
	FechaEnvioNpsTicketsBoletas *time.Time     `gorm:"type:date" json:"fecha_envio_nps_tickets_boletas,omitempty"`
	CreatedAt                   time.Time      `json:"created_at"`
	UpdatedAt                   time.Time      `json:"updated_at"`
	DeletedAt                   gorm.DeletedAt `gorm:"index" json:"-"`

	MonthlyControl *SupervisorMonthlyControl `gorm:"foreignKey:MonthlyControlID" json:"monthly_control,omitempty"`
}

func (SupervisorPdt601Planilla) TableName() string { return "supervisor_pdt601_planillas" }

// SupervisorPdt621Record seguimiento manual de PDT 621 del control (una por empresa+período).
// No está ligado a ninguna liquidación (tax_settlements): es solo control interno del supervisor.
type SupervisorPdt621Record struct {
	ID               uint `gorm:"primaryKey" json:"id"`
	MonthlyControlID uint `gorm:"not null;uniqueIndex" json:"monthly_control_id"`
	// Revisión de archivadores.
	PrimeraEntregaFecha *time.Time `gorm:"type:date" json:"primera_entrega_fecha,omitempty"`
	PrimeraEntregaHora  string     `gorm:"size:5" json:"primera_entrega_hora,omitempty"`
	Observacion         string     `gorm:"type:text" json:"observacion,omitempty"`
	SegundaEntregaFecha *time.Time `gorm:"type:date" json:"segunda_entrega_fecha,omitempty"`
	SegundaEntregaHora  string     `gorm:"size:5" json:"segunda_entrega_hora,omitempty"`
	// Fecha real en que se declaró el PDT 621 (se compara contra el cronograma SUNAT por dígito).
	FechaDeclaracion *time.Time `gorm:"type:date" json:"fecha_declaracion,omitempty"`
	// Importes declarados PDT 621.
	TotalVentas  float64 `gorm:"type:decimal(15,2);not null;default:0" json:"total_ventas"`
	TotalCompras float64 `gorm:"type:decimal(15,2);not null;default:0" json:"total_compras"`
	Igv          float64 `gorm:"type:decimal(15,2);not null;default:0" json:"igv"`
	Rta          float64 `gorm:"type:decimal(15,2);not null;default:0" json:"rta"`
	// Cantidad de comprobantes (NO montos) — solo registro manual del supervisor, nunca se
	// sincroniza desde la liquidación.
	CantidadComprobantesVenta  int `gorm:"not null;default:0" json:"cantidad_comprobantes_venta"`
	CantidadComprobantesCompra int `gorm:"not null;default:0" json:"cantidad_comprobantes_compra"`
	// SIRE.
	EnvioSire      string         `gorm:"size:10" json:"envio_sire,omitempty"` // '' | 'si' | 'no'
	FechaEnvioSire *time.Time     `gorm:"type:date" json:"fecha_envio_sire,omitempty"`
	MotivoNoEnvio  string         `gorm:"type:text" json:"motivo_no_envio,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`

	MonthlyControl *SupervisorMonthlyControl `gorm:"foreignKey:MonthlyControlID" json:"monthly_control,omitempty"`
}

func (SupervisorPdt621Record) TableName() string { return "supervisor_pdt621_records" }

// SupervisorNPS registro de NPS por control.
type SupervisorNPS struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	MonthlyControlID uint           `gorm:"not null;index" json:"monthly_control_id"`
	Tributo          string         `gorm:"size:80;not null" json:"tributo"`
	Importe          float64        `gorm:"type:decimal(15,2);not null;default:0" json:"importe"`
	CodigoNPS        string         `gorm:"size:120" json:"codigo_nps,omitempty"`
	GeneratedAt      *time.Time     `json:"generated_at,omitempty"`
	PaymentDueDate   *time.Time     `gorm:"type:date" json:"payment_due_date,omitempty"`
	PaymentStatus    string         `gorm:"size:30;not null;default:'pendiente_generar'" json:"payment_status"`
	Notes            string         `gorm:"type:text" json:"notes,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`

	MonthlyControl *SupervisorMonthlyControl `gorm:"foreignKey:MonthlyControlID" json:"monthly_control,omitempty"`
}

func (SupervisorNPS) TableName() string { return "supervisor_nps" }
