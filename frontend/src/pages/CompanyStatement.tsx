import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { saveAs } from 'file-saver';
import { resolveBackendUrl } from '../api/client';
import { companiesService } from '../services/companies';
import { configService } from '../services/config';
import type { CompanyStatement as CompanyStatementData, FirmConfig } from '../types/dashboard';
import { formatLedgerDateDisplay } from '../utils/ledgerDates';
import { truncateDocumentNumberDisplay } from '../utils/statementDisplay';
import {
  companyAccountStatementPdfFilename,
  generateCompanyAccountStatementPdfBlob,
  getLogoPngBlobForAccountPdf,
} from '../pdf/companyAccountStatementPdf';

const DEFAULT_STATEMENT_WHATSAPP =
  'Puedes solicitar tu estado de cuenta a través del grupo de WhatsApp de tu empresa o comunicándote a los números oficiales de ZContable.';

function defaultPeriodLima(): string {
  return formatInTimeZone(new Date(), 'America/Lima', 'yyyy-MM');
}

/** Rango por defecto: todo el año calendario actual en Lima (01-01 … 31-12). */
function defaultYearRangeLima(): { dateFrom: string; dateTo: string } {
  const y = formatInTimeZone(new Date(), 'America/Lima', 'yyyy');
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
}

function formatDate(value?: string): string {
  if (!value) return '';
  if (value.length >= 10) return value.slice(0, 10);
  return value;
}

function formatPEN(amount?: number): string {
  const n = typeof amount === 'number' ? amount : 0;
  return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getDocumentLabel(status: string, dueDate?: string): { label: string; cls: string } {
  const due = dueDate ? new Date(dueDate) : null;
  const isOverdue = Boolean(
    due && Number.isFinite(due.getTime()) && due.getTime() < Date.now() && status !== 'pagado' && status !== 'anulado',
  );
  const label = isOverdue ? 'vencido' : status;
  const cls =
    label === 'pendiente'
      ? 'bg-amber-50 text-amber-700 border border-amber-200'
      : label === 'parcial'
        ? 'bg-sky-50 text-sky-700 border border-sky-200'
        : label === 'pagado'
          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          : label === 'anulado'
            ? 'bg-slate-50 text-slate-700 border border-slate-200'
            : 'bg-red-50 text-red-700 border border-red-200';
  return { label, cls };
}

function getPaymentTypeLabel(type?: string, documentId?: number): { label: string; cls: string } {
  const normalized = (type ?? '').toLowerCase().trim();
  const isOnAccount = normalized === 'on_account' || !documentId;
  const label = isOnAccount ? 'a cuenta' : 'aplicado';
  const cls = isOnAccount
    ? 'bg-slate-50 text-slate-700 border border-slate-200'
    : 'bg-primary-50 text-primary-700 border border-primary-200';
  return { label, cls };
}

// type TabId = 'account' | 'profile'; // reactivar junto a la pestaña «Perfil de empresa»

/** Pestaña «Perfil de empresa» (desactivada en UI de momento; se mantiene el componente). */
export function StatementProfileTab({ data }: { data: CompanyStatementData }) {
  const balanceClass = (data.Balance ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700';
  const appliedPayments = (data.Payments ?? []).filter((p) => (p.type ?? '') !== 'on_account' && Boolean(p.document_id));
  const onAccountPayments = (data.Payments ?? []).filter((p) => (p.type ?? '') === 'on_account' || !p.document_id);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase">Total deudas</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{formatPEN(data.TotalDocuments)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase">Total pagos</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{formatPEN(data.TotalPayments)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase">Saldo por cobrar</p>
          <p className={`mt-1 text-2xl font-bold ${balanceClass}`}>{formatPEN(data.Balance)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Deudas</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Emisión</th>
                  <th className="px-4 py-3">Vencimiento</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Número</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3 text-right">Pagado</th>
                  <th className="px-4 py-3 text-right">Saldo</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.Documents?.length ? (
                  data.Documents.map((row) => (
                    <tr key={row.Document.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{formatDate(row.Document.issue_date)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatDate(row.Document.due_date)}</td>
                      <td className="px-4 py-3 text-slate-700">{row.Document.type}</td>
                      <td className="px-4 py-3 text-slate-700 font-mono text-xs">{row.Document.number}</td>
                      <td className="px-4 py-3 text-right text-slate-800">{formatPEN(row.Document.total_amount)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatPEN(row.Paid)}</td>
                      <td className="px-4 py-3 text-right text-slate-800">{formatPEN(row.Balance)}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const { label, cls } = getDocumentLabel(row.Document.status, row.Document.due_date);
                          return (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-500 text-sm">
                      No hay deudas registradas para esta empresa.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Pagos aplicados</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Deuda</th>
                  <th className="px-4 py-3">Método</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appliedPayments.length ? (
                  appliedPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{formatDate(p.date)}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const { label, cls } = getPaymentTypeLabel(p.type, p.document_id);
                          return (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{p.document ? p.document.number : '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{p.method}</td>
                      <td className="px-4 py-3 text-right text-slate-800">{formatPEN(p.amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500 text-sm">
                      No hay pagos aplicados registrados para esta empresa.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Pagos a cuenta</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Método</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {onAccountPayments.length ? (
                  onAccountPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{formatDate(p.date)}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const { label, cls } = getPaymentTypeLabel(p.type, p.document_id);
                          return (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{p.method}</td>
                      <td className="px-4 py-3 text-right text-slate-800">{formatPEN(p.amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500 text-sm">
                      No hay pagos a cuenta registrados para esta empresa.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

type StatementFilterMode = 'range' | 'period';

function BankStatementView({
  data,
  firmBranding,
  filterMode,
  onFilterModeChange,
  period,
  onPeriodChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  pdfLoading,
  onDownloadPdf,
}: {
  data: CompanyStatementData;
  firmBranding: FirmConfig | null;
  filterMode: StatementFilterMode;
  onFilterModeChange: (m: StatementFilterMode) => void;
  period: string;
  onPeriodChange: (v: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  pdfLoading: boolean;
  onDownloadPdf: () => void;
}) {
  const ledger = data.ledger;
  const c = data.Company;

  const rows = useMemo(() => ledger?.movements ?? [], [ledger]);

  if (!ledger) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        No se pudo armar el libro del periodo. Actualice la página o contacte al administrador.
      </div>
    );
  }

  const isRangeLedger = data.ledger?.ledger_kind === 'date_range';
  const summaryTitle = isRangeLedger ? 'Resumen del periodo' : 'Resumen del mes';
  const periodLineLabel = isRangeLedger ? 'PERÍODO' : 'MES';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label htmlFor="stmt-filter-mode" className="block text-xs font-medium text-slate-600 mb-1">
              Filtrar por
            </label>
            <select
              id="stmt-filter-mode"
              value={filterMode}
              onChange={(e) => onFilterModeChange(e.target.value as StatementFilterMode)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none min-w-[11rem] bg-white"
            >
              <option value="range">Rango de fechas</option>
              <option value="period">Periodo (mes)</option>
            </select>
          </div>
          {filterMode === 'period' ? (
            <div>
              <label htmlFor="stmt-period" className="block text-xs font-medium text-slate-600 mb-1">
                Periodo (mes)
              </label>
              <input
                id="stmt-period"
                type="month"
                value={period}
                onChange={(e) => onPeriodChange(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="stmt-date-from" className="block text-xs font-medium text-slate-600 mb-1">
                  Desde
                </label>
                <input
                  id="stmt-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => onDateFromChange(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
                />
              </div>
              <div>
                <label htmlFor="stmt-date-to" className="block text-xs font-medium text-slate-600 mb-1">
                  Hasta
                </label>
                <input
                  id="stmt-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => onDateToChange(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
                />
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={pdfLoading}
          onClick={onDownloadPdf}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 disabled:opacity-60 shadow-sm"
        >
          {pdfLoading ? <i className="fas fa-spinner fa-spin text-xs" /> : <i className="fas fa-file-pdf text-xs" />}
          Vista previa PDF
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Cabecera alineada al PDF: solo logo; título y periodo centrados */}
        <div className="px-4 sm:px-6 py-5 border-b border-slate-200 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {firmBranding?.logo_url ? (
              <img
                src={resolveBackendUrl(firmBranding.logo_url)}
                alt=""
                className="h-14 w-auto max-w-[160px] object-contain shrink-0"
              />
            ) : (
              <div className="h-14 w-28 shrink-0 rounded-lg border border-dashed border-slate-200 bg-slate-50" aria-hidden />
            )}
            <div className="flex-1 text-center min-w-0 sm:pt-0.5">
              <h3 className="text-base sm:text-lg font-bold text-emerald-800 tracking-tight">ESTADO DE CUENTA CLIENTES</h3>
              <p className="text-sm text-sky-900 font-semibold mt-1">
                {periodLineLabel}: {ledger.period_label}
              </p>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-white">
          <div className="rounded-lg border border-slate-200/90 bg-white px-4 py-3 space-y-2 text-sm">
            <p>
              <span className="font-bold text-slate-600 text-xs uppercase tracking-wide">Código cliente: </span>
              <span className="text-slate-900">{c.code?.trim() || '—'}</span>
            </p>
            <p>
              <span className="font-bold text-slate-600 text-xs uppercase tracking-wide">Razón social: </span>
              <span className="text-slate-900 font-semibold">{c.business_name}</span>
            </p>
            <p>
              <span className="font-bold text-slate-600 text-xs uppercase tracking-wide">RUC: </span>
              <span className="text-slate-900 font-mono text-xs">{c.ruc}</span>
            </p>
            <p>
              <span className="font-bold text-slate-600 text-xs uppercase tracking-wide">Dirección: </span>
              <span className="text-slate-800">{c.address?.trim() || '—'}</span>
            </p>
          </div>
        </div>

        <div className="border-b border-slate-200">
          <div className="bg-slate-100/90 px-4 py-2.5 text-center border-b border-slate-200/80">
            <p className="text-xs font-bold text-slate-800 uppercase tracking-wide">{summaryTitle}</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-200/90 border-t-0 bg-slate-50/30">
            <div className="p-3.5 bg-slate-50/80 border-b border-r border-slate-200/80 lg:border-b-0 text-center flex flex-col justify-center gap-1.5">
              <p className="text-[10px] font-bold text-slate-700 uppercase leading-tight">Saldo anterior</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">{formatPEN(ledger.saldo_anterior)}</p>
            </div>
            <div className="p-3.5 bg-slate-50/80 border-b border-slate-200/80 lg:border-b-0 lg:border-r text-center flex flex-col justify-center gap-0.5">
              <p className="text-[10px] font-bold text-slate-800 uppercase">Abonos</p>
              <p className="text-[9px] text-slate-500 leading-tight">Pagos por el cliente</p>
              <p className="text-lg font-bold text-emerald-700 tabular-nums pt-0.5">{formatPEN(ledger.total_abonos)}</p>
            </div>
            <div className="p-3.5 bg-slate-50/80 border-b border-r border-slate-200/80 lg:border-b-0 text-center flex flex-col justify-center gap-0.5">
              <p className="text-[10px] font-bold text-slate-800 uppercase">Cargos</p>
              <p className="text-[9px] text-slate-500 leading-tight">Deudas al estudio</p>
              <p className="text-lg font-bold text-red-700 tabular-nums pt-0.5">{formatPEN(ledger.total_cargos)}</p>
            </div>
            <div className="p-3.5 bg-slate-50/80 border-b border-slate-200/80 lg:border-b-0 text-center flex flex-col justify-center gap-1.5">
              <p className="text-[10px] font-bold text-slate-700 uppercase leading-tight">Saldo final</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">{formatPEN(ledger.saldo_final)}</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-fixed min-w-[920px] w-full text-left text-[11px] leading-snug">
            <colgroup>
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-600 text-white">
                <th className="px-1.5 py-2.5 font-bold uppercase tracking-wide align-middle text-center leading-tight text-[10px]">
                  <span className="block">Fecha de</span>
                  <span className="block">operación</span>
                </th>
                <th className="px-1.5 py-2.5 font-bold uppercase tracking-wide align-middle text-center leading-tight text-[10px]">
                  <span className="block">Fecha de</span>
                  <span className="block">proceso</span>
                </th>
                <th className="px-1 py-2.5 font-bold uppercase tracking-wide align-middle text-center">Tipo</th>
                <th className="px-1 py-2.5 font-bold uppercase tracking-wide align-middle text-center leading-tight text-[10px]">
                  <span className="block">Nro.</span>
                  <span className="block">doc.</span>
                </th>
                <th className="px-2 py-2.5 font-bold uppercase tracking-wide align-middle text-center">Detalle</th>
                <th className="px-1 py-2.5 font-bold uppercase tracking-wide align-middle text-center leading-tight text-[10px] whitespace-normal">
                  <span className="block">Método</span>
                  <span className="block">de pago</span>
                </th>
                <th className="px-1 py-2.5 font-bold uppercase tracking-wide align-middle text-center leading-tight text-[10px]">
                  <span className="block">Código</span>
                  <span className="block">oper.</span>
                </th>
                <th className="px-1 py-2.5 font-bold uppercase tracking-wide align-middle text-center">Cargo</th>
                <th className="px-1 py-2.5 font-bold uppercase tracking-wide align-middle text-center">Abono</th>
                <th className="px-1 py-2.5 font-bold uppercase tracking-wide align-middle text-center">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                    No hay movimientos registrados en este periodo.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={`${row.operation_date}-${row.type_code}-${row.document_number}-${idx}`} className={idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                    <td className="px-2 py-2 text-slate-700 whitespace-nowrap tabular-nums align-top">
                      {formatLedgerDateDisplay(row.operation_date)}
                    </td>
                    <td className="px-2 py-2 text-slate-700 whitespace-nowrap tabular-nums align-top">
                      {formatLedgerDateDisplay(row.process_date)}
                    </td>
                    <td className="px-2 py-2 text-slate-800 font-mono text-[10px] align-top">{row.type_code}</td>
                    <td
                      className="px-1.5 py-2 text-slate-700 font-mono text-[10px] align-top whitespace-nowrap min-w-0"
                      title={(row.document_number ?? '').trim() || undefined}
                    >
                      {truncateDocumentNumberDisplay(row.document_number, 24)}
                    </td>
                    <td className="px-2 py-2 text-slate-700 align-top whitespace-normal break-words min-w-0 hyphens-auto">
                      {row.detail || '—'}
                    </td>
                    <td className="px-1 py-2 text-slate-600 align-top whitespace-normal break-words text-[10px] leading-tight min-w-0">
                      {row.payment_method || '—'}
                    </td>
                    <td
                      className="px-1 py-2 text-slate-600 font-mono text-[10px] align-top whitespace-normal break-all min-w-0"
                      title={(row.operation_code ?? '').trim() || undefined}
                    >
                      {row.operation_code || '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-red-800 font-semibold tabular-nums align-top">
                      {row.cargo > 0 ? formatPEN(row.cargo) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-emerald-800 font-semibold tabular-nums align-top">
                      {row.abono > 0 ? formatPEN(row.abono) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-slate-900 font-bold tabular-nums align-top">{formatPEN(row.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {firmBranding ? (
          <div className="border-t border-slate-200 bg-slate-50/90 px-4 sm:px-6 py-5 text-sm">
            <div className="flex items-start gap-3 mb-4">
              <span
                className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white text-base leading-none"
                aria-hidden
              >
                <i className="fab fa-whatsapp" />
              </span>
              <p className="text-slate-700 leading-relaxed">
                {(firmBranding.statement_whatsapp_notice ?? '').trim() || DEFAULT_STATEMENT_WHATSAPP}
              </p>
            </div>
            <div className="flex flex-col md:flex-row gap-6 md:items-start">
              <div className="shrink-0 w-40 flex justify-center md:justify-start">
                {firmBranding.statement_bank_logo_url ? (
                  <img
                    src={resolveBackendUrl(firmBranding.statement_bank_logo_url)}
                    alt="Banco"
                    className="max-h-14 w-auto max-w-full object-contain"
                  />
                ) : (
                  <div className="h-14 w-32 rounded border border-dashed border-slate-200 bg-white" aria-hidden />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-3 text-slate-800">
                {firmBranding.statement_bank_info?.trim() ? (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
                    {firmBranding.statement_bank_info.trim()}
                  </pre>
                ) : null}
                {firmBranding.statement_payment_observations?.trim() ? (
                  <p className="text-sm leading-relaxed">
                    <span className="font-bold text-slate-900">OBS: </span>
                    {firmBranding.statement_payment_observations.trim()}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 flex flex-col items-center mx-auto md:mx-0">
                {firmBranding.statement_payment_qr_url ? (
                  <>
                    <img
                      src={resolveBackendUrl(firmBranding.statement_payment_qr_url)}
                      alt="QR de pago"
                      className="h-32 w-32 object-contain bg-white border border-slate-200 rounded-lg p-1"
                    />
                    <p className="mt-2 text-xs font-semibold text-violet-800 text-center max-w-[10rem] leading-snug">
                      {(firmBranding.statement_payment_qr_caption ?? '').trim() || 'Paga aquí con Yape'}
                    </p>
                  </>
                ) : (
                  <div className="h-32 w-32 rounded-lg border border-dashed border-slate-200 bg-white flex items-center justify-center text-xs text-slate-400 text-center px-2">
                    Sin QR
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const CompanyStatement = () => {
  const params = useParams();
  const navigate = useNavigate();
  const companyId = params.id ? Number(params.id) : NaN;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<CompanyStatementData | null>(null);
  // const [tab, setTab] = useState<TabId>('account'); // reactivar con pestaña Perfil de empresa
  const [filterMode, setFilterMode] = useState<StatementFilterMode>('range');
  const [period, setPeriod] = useState(defaultPeriodLima);
  const [dateFrom, setDateFrom] = useState(() => defaultYearRangeLima().dateFrom);
  const [dateTo, setDateTo] = useState(() => defaultYearRangeLima().dateTo);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string; blob: Blob } | null>(null);
  const [firmBranding, setFirmBranding] = useState<FirmConfig | null>(null);

  useEffect(() => {
    void configService
      .getFirmBranding()
      .then(setFirmBranding)
      .catch(() => setFirmBranding(null));
  }, []);

  const load = useCallback(async () => {
    if (!companyId || Number.isNaN(companyId)) return;
    try {
      setLoading(true);
      setError('');
      if (filterMode === 'range' && dateFrom && dateTo && dateFrom > dateTo) {
        setError('La fecha desde no puede ser mayor que la fecha hasta.');
        return;
      }
      const statement =
        filterMode === 'range'
          ? await companiesService.getStatement(companyId, { dateFrom, dateTo })
          : await companiesService.getStatement(companyId, { period });
      setData(statement);
    } catch (e) {
      console.error(e);
      setError('Error al cargar estado de cuenta');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, filterMode, period, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  const closePdfPreview = () => {
    setPdfPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  useEffect(() => {
    if (!pdfPreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pdfPreview]);

  const ledgerMatchesFilters = useMemo(() => {
    const L = data?.ledger;
    if (!L) return true;
    if (filterMode === 'range') {
      return (
        L.ledger_kind === 'date_range' && L.range_date_from === dateFrom && L.range_date_to === dateTo
      );
    }
    if (!period || period.length < 7) return true;
    const y = Number(period.slice(0, 4));
    const m = Number(period.slice(5, 7));
    const kind = L.ledger_kind ?? 'month';
    return kind === 'month' && L.period_year === y && L.period_month === m;
  }, [data?.ledger, filterMode, period, dateFrom, dateTo]);

  const handleDownloadPdf = async () => {
    if (!data?.ledger || !companyId) return;
    if (filterMode === 'range' && dateFrom && dateTo && dateFrom > dateTo) {
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'error', message: 'Corrija el rango de fechas antes de descargar el PDF.' },
        }),
      );
      return;
    }
    try {
      setPdfLoading(true);
      const statementPromise =
        filterMode === 'range'
          ? companiesService.getStatement(companyId, { dateFrom, dateTo })
          : companiesService.getStatement(companyId, { period });
      const [firm, fresh] = await Promise.all([
        (async () =>
          (await configService.getFirmConfig().catch(() => null)) ??
          (await configService.getFirmBranding().catch(() => null)))(),
        statementPromise,
      ]);
      if (!fresh.ledger) {
        window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Sin datos de libro para PDF.' } }));
        return;
      }
      const firmForPdf: FirmConfig | null = firm
        ? {
            ...firm,
            statement_bank_logo_url:
              firm.statement_bank_logo_url?.trim() || firmBranding?.statement_bank_logo_url?.trim() || '',
            statement_payment_qr_url:
              firm.statement_payment_qr_url?.trim() || firmBranding?.statement_payment_qr_url?.trim() || '',
          }
        : firmBranding;
      const studioLogoUrl = (firmForPdf?.logo_url ?? '').trim();
      const bankLogoUrl = (firmForPdf?.statement_bank_logo_url ?? '').trim();
      const payQrUrl = (firmForPdf?.statement_payment_qr_url ?? '').trim();
      const [studioLogoPng, bankLogoPng, payQrPng] = await Promise.all([
        studioLogoUrl ? getLogoPngBlobForAccountPdf(studioLogoUrl) : Promise.resolve(null),
        bankLogoUrl ? getLogoPngBlobForAccountPdf(bankLogoUrl) : Promise.resolve(null),
        payQrUrl ? getLogoPngBlobForAccountPdf(payQrUrl) : Promise.resolve(null),
      ]);
      const blob = await generateCompanyAccountStatementPdfBlob(fresh.Company, fresh.ledger, firmForPdf, studioLogoPng, {
        bankLogoPng,
        paymentQrPng: payQrPng,
      });
      const filename = companyAccountStatementPdfFilename(fresh.Company, fresh.ledger);
      setPdfPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { url: URL.createObjectURL(blob), filename, blob };
      });
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'success', message: 'Vista previa del PDF. Revise el documento y descárguelo si está correcto.' },
        }),
      );
    } catch (e) {
      console.error(e);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'No se pudo generar el PDF.' } }),
      );
    } finally {
      setPdfLoading(false);
    }
  };

  const handleFilterModeChange = (m: StatementFilterMode) => {
    setFilterMode(m);
    if (m === 'period') {
      setPeriod((prev) => (prev && prev.length >= 7 ? prev : defaultPeriodLima()));
    } else {
      const d = defaultYearRangeLima();
      setDateFrom(d.dateFrom);
      setDateTo(d.dateTo);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || 'Empresa no encontrada'}
        </div>
        <button
          type="button"
          onClick={() => navigate('/companies')}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver a empresas
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Empresa</p>
          <h2 className="text-xl font-semibold text-slate-800">{data.Company.business_name}</h2>
          <p className="text-sm text-slate-500 mt-1">
            Estado de cuenta tipo extracto bancario por periodo o mes (cargos, abonos y saldo corrido).
            {/* Perfil operativo (pestaña oculta): deudas, pagos aplicados y pagos a cuenta. */}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/documents/new?company_id=${data.Company.id}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-700 text-white text-xs font-medium shadow-sm hover:bg-emerald-800"
          >
            <i className="fas fa-file-invoice-dollar text-xs"></i> Registrar cargo
          </Link>
          <Link
            to="/companies"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <i className="fas fa-arrow-left text-xs"></i> Volver a empresas
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-0">
        <div className="px-4 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 bg-white border-slate-200 text-primary-800 -mb-px">
          <i className="fas fa-file-invoice mr-2 text-xs opacity-80" />
          Estado de cuenta
        </div>
        {/*
        <button type="button" onClick={() => setTab('account')} className={...}>
          <i className="fas fa-file-invoice mr-2 text-xs opacity-80" /> Estado de cuenta
        </button>
        <button type="button" onClick={() => setTab('profile')} className={...}>
          <i className="fas fa-building mr-2 text-xs opacity-80" /> Perfil de empresa
        </button>
        */}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {!ledgerMatchesFilters && loading ? (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-500 text-sm">
          <i className="fas fa-spinner fa-spin mr-2" />
          Cargando periodo…
        </div>
      ) : (
          <BankStatementView
            data={data}
            firmBranding={firmBranding}
            filterMode={filterMode}
            onFilterModeChange={handleFilterModeChange}
          period={period}
          onPeriodChange={setPeriod}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          pdfLoading={pdfLoading}
          onDownloadPdf={() => void handleDownloadPdf()}
        />
      )}
      {/*
        Perfil de empresa (oculto de momento). Para reactivar:
        - descomentar type TabId y useState(tab/setTab)
        - sustituir el <div> fijo «Estado de cuenta» por los dos <button> comentados arriba
        - envolver el extracto en tab === 'account' y mostrar <StatementProfileTab data={data} /> cuando tab === 'profile'
        - descomentar el pie de carga al cambiar de pestaña:
      {tab === 'profile' && loading && data ? (
        <p className="text-xs text-slate-400 text-center">
          <i className="fas fa-spinner fa-spin mr-1" /> Actualizando datos…
        </p>
      ) : null}
      */}

      {pdfPreview
        ? createPortal(
            <div
              className="fixed inset-0 z-[10050] flex items-center justify-center p-3 sm:p-6 bg-slate-900/50 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pdf-preview-title"
            >
              <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <h3 id="pdf-preview-title" className="text-sm font-semibold text-slate-800 pr-2">
                    Vista previa del PDF
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        saveAs(pdfPreview.blob, pdfPreview.filename);
                        window.dispatchEvent(
                          new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Descarga iniciada.' } }),
                        );
                      }}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-medium hover:bg-slate-900"
                    >
                      <i className="fas fa-download text-[10px]" />
                      Descargar
                    </button>
                    <button
                      type="button"
                      onClick={closePdfPreview}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-100"
                    >
                      Cerrar
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-[50vh] bg-slate-100">
                  <iframe
                    title="Vista previa del estado de cuenta en PDF"
                    src={pdfPreview.url}
                    className="w-full h-[min(75vh,720px)] border-0"
                  />
                </div>
                <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100 bg-white">
                  El visor usa el mismo archivo que se descarga: si el logo o el QR no aparecen aquí, tampoco irán en el PDF
                  guardado. Compruebe en Ajustes que las imágenes carguen en la página (misma URL que para el PDF).
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default CompanyStatement;
