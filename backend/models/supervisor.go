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

// Declaraciones tributarias.
const (
	SupervisorDeclPDT601    = "pdt_601"
	SupervisorDeclPDT621    = "pdt_621"
	SupervisorDeclSIRE      = "sire"
	SupervisorDeclRentaAnual = "renta_anual"
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
	ID            uint           `gorm:"primaryKey" json:"id"`
	PeriodYM      string         `gorm:"size:7;not null;uniqueIndex" json:"period_ym"`
	Status        string         `gorm:"size:20;not null;default:'abierto'" json:"status"`
	Notes         string         `gorm:"type:text" json:"notes,omitempty"`
	ClosedAt      *time.Time     `json:"closed_at,omitempty"`
	ClosedByUserID *uint         `gorm:"index" json:"closed_by_user_id,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index" json:"-"`

	ClosedBy *User `gorm:"foreignKey:ClosedByUserID" json:"closed_by,omitempty"`
}

func (SupervisorPeriod) TableName() string { return "supervisor_periods" }

// SupervisorMonthlyControl control mensual por empresa y período.
type SupervisorMonthlyControl struct {
	ID                 uint           `gorm:"primaryKey" json:"id"`
	CompanyID          uint           `gorm:"not null;index:idx_sup_ctrl_co_period,unique" json:"company_id"`
	PeriodYM           string         `gorm:"size:7;not null;index:idx_sup_ctrl_co_period,unique" json:"period_ym"`
	TaxRegime          string         `gorm:"size:80" json:"tax_regime,omitempty"`
	ResponsibleUserID  *uint          `gorm:"index" json:"responsible_user_id,omitempty"`
	SupervisorUserID   *uint          `gorm:"index" json:"supervisor_user_id,omitempty"`
	DueDate            *time.Time     `gorm:"type:date" json:"due_date,omitempty"`
	GeneralStatus      string         `gorm:"size:30;not null;default:'pendiente'" json:"general_status"`
	RiskLevel          string         `gorm:"size:20;not null;default:'bajo'" json:"risk_level"`
	Observations       string         `gorm:"type:text" json:"observations,omitempty"`
	InfoReceivedAt     *time.Time     `json:"info_received_at,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	DeletedAt          gorm.DeletedAt `gorm:"index" json:"-"`

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
