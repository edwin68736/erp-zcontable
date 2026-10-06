import type { ActivityModuleId } from '../../navigation/activityRoutes';
import type { PdfReportSlug } from '../../services/pdfReports';
import { PDT601_STATUSES, PDT601_TERMINAL_STATUSES, pdt601DisplayStatus } from './pdt601Config';

/** Metadatos de cada módulo de informe en PDF — títulos y textos que cambian entre uno y otro. */
export type PdfReportModuleConfig = {
  slug: PdfReportSlug;
  moduleId: ActivityModuleId;
  title: string;
  description: string;
  /** Nombre del documento que se carga (para botones y mensajes). */
  documentLabel: string;
  excelTitle: string;
  excelFilePrefix: string;
  sheetName: string;
};

export const PDF_REPORT_MODULES: Record<PdfReportSlug, PdfReportModuleConfig> = {
  'informe-detracciones': {
    slug: 'informe-detracciones',
    moduleId: 'informe-detracciones',
    title: 'Informe detracciones',
    description: 'Carga del informe de detracciones en PDF por empresa y período, con su fecha de cumplimiento.',
    documentLabel: 'informe de detracciones',
    excelTitle: 'INFORME DE DETRACCIONES',
    excelFilePrefix: 'reporte-informe-detracciones',
    sheetName: 'Informe detracciones',
  },
  'siscont-balances': {
    slug: 'siscont-balances',
    moduleId: 'siscont-balances',
    title: 'Siscont balances',
    description: 'Carga del balance de Siscont en PDF por empresa y período, con su fecha de cumplimiento.',
    documentLabel: 'balance de Siscont',
    excelTitle: 'SISCONT BALANCES',
    excelFilePrefix: 'reporte-siscont-balances',
    sheetName: 'Siscont balances',
  },
};

/** Mismos 4 estados que PDT 601/621 — "Entregado" es terminal salvo Reabrir. */
export const PDF_REPORT_STATUS_FILTER = [
  { value: '', label: 'Todos' },
  ...PDT601_STATUSES,
  { value: 'suspendida', label: 'Suspendida' },
];

export const PDF_REPORT_TERMINAL_STATUSES = PDT601_TERMINAL_STATUSES;

/** Estado a mostrar (Suspendida > Entregado±puntualidad > estado real), misma fuente que PDT 601. */
export function pdfReportDisplayStatus(opts: { status: string; suspendida?: boolean; timeliness?: string }) {
  return pdt601DisplayStatus(opts);
}

/** AAAA-MM-DD → DD/MM/AAAA ('—' si no hay). */
export function formatDateOnly(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Fecha de hoy en AAAA-MM-DD, horario local. */
export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
