export interface MonthlyPaymentStat {
  Label: string;
  Amount: number;
  Level: string;
  Height: number;
}

export interface Company {
  id: number;
  ruc: string;
  business_name: string;
  code: string; // Mapeado desde InternalCode con json:"code"
  trade_name: string;
  status: string;
  balance?: number;
  address?: string;
  phone?: string;
  email?: string;
  service_start_at?: string;
  accountant_user_id?: number | null;
  supervisor_user_id?: number | null;
  assistant_user_id?: number | null;
  accountant?: User;
  supervisor?: User;
  assistant?: User;
  contacts?: Contact[];
  subscription_plan_id?: number | null;
  billing_cycle?: string;
  subscription_started_at?: string;
  subscription_ended_at?: string;
  subscription_active?: boolean;
  declared_billing_amount?: number | null;
  subscription_plan?: SubscriptionPlan;
}

export interface PlanCategory {
  id: number;
  code: string;
  name: string;
  description?: string;
  sort_order: number;
  active: boolean;
}

export interface PlanTier {
  id?: number;
  subscription_plan_id?: number;
  min_billing: number;
  max_billing?: number | null;
  monthly_price: number;
  sort_order: number;
}

export interface SubscriptionPlan {
  id: number;
  plan_category_id: number;
  name: string;
  description?: string;
  billing_basis: string;
  active: boolean;
  plan_category?: PlanCategory;
  tiers?: PlanTier[];
}

export interface Contact {
  id: number;
  company_id: number;
  full_name: string;
  position: string;
  phone: string;
  email: string;
  notes: string;
  priority: string;
}

export interface CompanyDebtCard {
  Company: Company;
  TotalDocuments: number;
  TotalPayments: number;
  Balance: number;
  /** Meses de atraso respecto al periodo contable del cargo con saldo (misma regla que reporte financiero). */
  MaxOverdueMonths?: number;
  HasOverdue?: boolean;
  /** Periodo YYYY-MM más antiguo entre documentos pendiente/parcial con saldo. */
  OldestOpenDebtPeriod?: string;
}

export interface DocumentItem {
  id: number;
  document_id: number;
  product_id?: number | null;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  sort_order: number;
}

export interface Document {
  id: number;
  company_id: number;
  company?: Company;
  external_id?: string;
  type: string;
  number: string;
  /** Número legible (p. ej. DEU-LI-202603 para deudas de liquidación); si falta, usar `number`. */
  display_number?: string;
  issue_date: string;
  due_date?: string;
  total_amount: number;
  status: string;
  source?: string;
  description?: string;
  service_month?: string;
  /** Periodo contable YYYY-MM (independiente de issue_date). */
  accounting_period?: string;
  items?: DocumentItem[];
}

export interface PaymentAllocation {
  id: number;
  payment_id: number;
  document_id: number;
  amount: number;
  document?: Document;
}

export interface Payment {
  id: number;
  company_id: number;
  document_id?: number;
  tax_settlement_id?: number | null;
  type?: string;
  date: string;
  amount: number;
  method: string;
  reference: string;
  attachment: string;
  notes: string;
  fiscal_status?: string;
  company?: Company;
  document?: Document;
  allocations?: PaymentAllocation[];
  tax_settlement?: { id: number; number: string; status: string };
  /** Presente si el pago tiene comprobante Tukifac vinculado (`linked_payment_id`). */
  tukifac_fiscal_receipt?: {
    id: number;
    number: string;
    external_id: string;
    issue_date: string;
    print_ticket_url?: string;
    pdf_url?: string;
  };
}

export interface TukifacFiscalReceipt {
  id: number;
  external_id: string;
  company_id: number;
  document_type_id?: string;
  number: string;
  total: number;
  issue_date: string;
  customer_number?: string;
  customer_name?: string;
  reconciliation_status: string;
  linked_payment_id?: number | null;
  tax_settlement_id?: number | null;
  tax_settlement?: { id: number; number: string; status: string };
  state_type_description?: string;
  /** tukifac_sync | issued_local */
  origin?: string;
  /** URL impresión ticket (Tukifac) si se emitió desde este sistema. */
  print_ticket_url?: string;
  /** URL descarga PDF A4 (Tukifac). */
  pdf_url?: string;
  company?: Company;
  linked_payment?: {
    id: number;
    tax_settlement_id?: number | null;
    tax_settlement?: { id: number; number: string; status: string };
  };
  /** Listados enriquecidos (API) */
  document_kind_label?: string;
  origin_label?: string;
  reconciliation_label?: string;
  effective_tax_settlement_id?: number | null;
  settlement_number?: string;
  settlement_link_status?: string;
  settlement_link_message?: string;
}

export interface SettlementPreviewLine {
  document_id: number;
  concept: string;
  amount: number;
  issue_date: string;
  status: string;
  /** YYYY-MM sugerido para líneas de liquidación. */
  accounting_period?: string;
}

export interface TaxSettlementLine {
  id?: number;
  tax_settlement_id?: number;
  line_type: string;
  document_id?: number | null;
  product_id?: number | null;
  concept: string;
  amount: number;
  sort_order: number;
  /** Periodo contable YYYY-MM (preferido). */
  period_ym?: string | null;
  /** Primer día del mes de period_ym (API legado). */
  period_date?: string | null;
}

export interface TaxSettlement {
  id: number;
  company_id: number;
  number: string;
  issue_date: string;
  /** Periodo de la liquidación YYYY-MM (una por empresa y periodo). */
  liquidation_period?: string;
  period_label?: string;
  period_from?: string | null;
  period_to?: string | null;
  status: string;
  notes?: string;
  pdt621_json?: string;
  total_honorarios: number;
  total_impuestos: number;
  total_general: number;
  /** Indica si aún hay saldo pendiente en deudas vinculadas (API; misma lógica que payment-suggestions). */
  can_register_payment?: boolean;
  company?: Company;
  lines?: TaxSettlementLine[];
}

export interface FirmConfig {
  id: number;
  name: string;
  ruc: string;
  address: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  tukifac_api_url?: string;
  tukifac_api_token?: string;
  /** Base ApiPeru.dev, p. ej. https://apiperu.dev (POST /api/ruc) */
  apiperu_base_url?: string;
  apiperu_token?: string;
  /** Línea superior del pie (WhatsApp / contacto) en estado de cuenta */
  statement_whatsapp_notice?: string;
  /** Datos bancarios (cuenta, CCI, titular, Yape, etc.) */
  statement_bank_info?: string;
  /** Observaciones para constancias / recibo (pie de página) */
  statement_payment_observations?: string;
  statement_bank_logo_url?: string;
  statement_payment_qr_url?: string;
  /** Texto bajo el QR; por defecto en PDF «Paga aquí con Yape» */
  statement_payment_qr_caption?: string;
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id: number;
  name: string;
  username: string;
  email?: string;
  role: string;
  active?: boolean;
  dni?: string;
  phone?: string;
  address?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentStatement {
  Document: Document;
  Paid: number;
  Balance: number;
}

export interface AccountLedgerMovement {
  operation_date: string;
  process_date: string;
  type_code: string;
  document_number: string;
  detail: string;
  payment_method: string;
  operation_code: string;
  cargo: number;
  abono: number;
  balance: number;
}

export interface AccountLedger {
  period_year: number;
  period_month: number;
  period_label: string;
  /** "month" | "date_range"; ausente se trata como mes (compatibilidad). */
  ledger_kind?: 'month' | 'date_range';
  /** yyyy-MM-dd (Lima), solo rango. */
  range_date_from?: string;
  range_date_to?: string;
  saldo_anterior: number;
  total_abonos: number;
  total_cargos: number;
  saldo_final: number;
  movements: AccountLedgerMovement[];
}

export interface CompanyStatement {
  Company: Company;
  Documents: DocumentStatement[];
  Payments: Payment[];
  TotalDocuments: number;
  TotalPayments: number;
  Balance: number;
  ledger?: AccountLedger;
}

export interface DashboardData {
  UsersCount: number;
  CompaniesCount: number;
  DocumentsCount: number;
  PaymentsCount: number;
  TotalDocs: number;
  TotalPays: number;
  GlobalBalance: number;
  MonthlyPayments: MonthlyPaymentStat[];
  TopDebtors: CompanyDebtCard[];
  RecentDocuments: Document[];
  MonthlyPaymentsYear: number;
  YearCollectionPercent: number;
  YearCollectionPercentStr: string;
  YearCollectionDocs: number;
  YearCollectionPayments: number;
  YearCollectionDocsStr: string;
  YearCollectionPaysStr: string;
  DebtCompaniesCount: number;
  TotalDebtAmount: number;
  PendingDocsCount: number;
  OverdueDocsCount: number;
}
