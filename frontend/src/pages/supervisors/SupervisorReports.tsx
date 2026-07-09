import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import {
  supervisorsService,
  type SupervisorObservationReportRow,
  type SupervisorProductivityRow,
  type SupervisorReportKind,
  type SupervisorReportRow,
} from '../../services/supervisors';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import { controlStatusLabel, currentPeriodYM, riskLevelLabel } from '../../utils/supervisorLabels';
import Pagination from '../../components/Pagination';

const REPORT_TABS: { kind: SupervisorReportKind; label: string }[] = [
  { kind: 'monthly', label: 'Mensual' },
  { kind: 'overdue', label: 'Vencidas' },
  { kind: 'pending_declarations', label: 'Decl. pendientes' },
  { kind: 'nps_pending', label: 'NPS pendientes' },
  { kind: 'payments_pending', label: 'Pagos pendientes' },
  { kind: 'productivity', label: 'Productividad' },
  { kind: 'observations', label: 'Observaciones' },
];

const REPORT_KIND_HINTS: Record<SupervisorReportKind, string> = {
  monthly: 'Cuadro general del período: estado, riesgo y total a pagar por empresa.',
  overdue: 'Empresas con control en estado vencido.',
  pending_declarations: 'Empresas con declaraciones 601, 621 o SIRE aún sin cerrar.',
  nps_pending: 'Empresas con NPS por generar o enviar al cliente (aún no en cobro).',
  payments_pending: 'Empresas con NPS generados pendientes de pago o vencidos.',
  productivity: 'Cumplimiento por analista responsable en el período.',
  observations: 'Historial de observaciones registradas en controles del período.',
};

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i <= 0) return fallback;
  return i;
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const pdfStyles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica' },
  title: { fontSize: 14, marginBottom: 8, fontWeight: 'bold' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#e2e8f0', paddingVertical: 4 },
  cell: { flex: 1, paddingRight: 4 },
  header: { fontWeight: 'bold', backgroundColor: '#f1f5f9' },
});

const SupervisorReports = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsReportsView), []);
  const [searchParams, setSearchParams] = useSearchParams();

  const kind = (searchParams.get('kind') as SupervisorReportKind) || 'monthly';
  const periodYm = searchParams.get('period_ym') || currentPeriodYM();
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const perPage = parsePositiveInt(searchParams.get('per_page'), 20);
  const qApplied = searchParams.get('q') ?? '';

  const [query, setQuery] = useState(qApplied);
  const debouncedQuery = useDebouncedValue(query, 400);
  const lastPushedQ = useRef<string | null>(null);

  const [rows, setRows] = useState<
    SupervisorReportRow[] | SupervisorProductivityRow[] | SupervisorObservationReportRow[]
  >([]);
  const [pagination, setPagination] = useState({ page: 1, per_page: 20, total: 0, total_pages: 0 });
  const [loading, setLoading] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState('');

  const showSearch = kind !== 'productivity';
  const showNpsCountCol = kind === 'nps_pending' || kind === 'monthly';
  const showPaymentsCountCol = kind === 'payments_pending' || kind === 'monthly';
  const showComplianceCol = kind !== 'productivity' && kind !== 'observations';

  useEffect(() => {
    setQuery(qApplied);
  }, [qApplied]);

  useEffect(() => {
    if (!showSearch) return;
    const trimmed = debouncedQuery.trim();
    const nextQ = trimmed.length >= 2 ? trimmed : '';
    if (lastPushedQ.current === nextQ) return;
    lastPushedQ.current = nextQ;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextQ) next.set('q', nextQ);
        else next.delete('q');
        next.set('page', '1');
        if (!next.get('period_ym')) next.set('period_ym', currentPeriodYM());
        if (!next.get('per_page')) next.set('per_page', String(perPage));
        if (!next.get('kind')) next.set('kind', 'monthly');
        return next;
      },
      { replace: true },
    );
  }, [debouncedQuery, perPage, setSearchParams, showSearch]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await supervisorsService.reportMonthly({
        period_ym: periodYm,
        kind,
        q: qApplied || undefined,
        page: kind === 'productivity' ? undefined : page,
        per_page: kind === 'productivity' ? undefined : perPage,
      });
      const items = Array.isArray(res.items) ? res.items : [];
      setRows(items);
      setPagination(
        res.pagination ?? {
          page: 1,
          per_page: items.length || perPage,
          total: items.length,
          total_pages: items.length > 0 ? 1 : 0,
        },
      );
    } catch {
      setError('No se pudo generar el reporte');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [periodYm, kind, qApplied, page, perPage]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const setKind = (k: SupervisorReportKind) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('kind', k);
      next.set('page', '1');
      return next;
    });
  };

  const setPeriod = (ym: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('period_ym', ym);
      next.set('page', '1');
      return next;
    });
  };

  const handlePageChange = (p: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      return next;
    });
  };

  const handlePerPageChange = (n: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('per_page', String(n));
      next.set('page', '1');
      return next;
    });
  };

  const fetchExportData = async () => {
    const res = await supervisorsService.reportMonthly({
      period_ym: periodYm,
      kind,
      q: qApplied || undefined,
      page: 1,
      per_page: 500,
    });
    return res.items;
  };

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    try {
      setExportingExcel(true);
      const rawExport = await fetchExportData();
      const exportRows = Array.isArray(rawExport) ? rawExport : [];
      if (exportRows.length === 0) return;

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Supervisores');
      const tabLabel = REPORT_TABS.find((t) => t.kind === kind)?.label ?? kind;
      sheet.mergeCells('A1:F1');
      sheet.getCell('A1').value = `Reporte supervisores (${tabLabel}) — ${periodYm}`;
      sheet.getCell('A1').font = { size: 14, bold: true };

      if (kind === 'productivity') {
        const productivityRows = exportRows as SupervisorProductivityRow[];
        sheet.columns = [
          { header: 'Responsable', key: 'user', width: 28 },
          { header: 'Total', key: 'total', width: 10 },
          { header: 'Al día', key: 'al_dia', width: 10 },
          { header: 'Cumplimiento %', key: 'pct', width: 14 },
        ];
        sheet.getRow(3).font = { bold: true };
        productivityRows.forEach((r) => {
          sheet.addRow({ user: r.user_name, total: r.total, al_dia: r.al_dia, pct: r.compliance_pct });
        });
      } else if (kind === 'observations') {
        const observationRows = exportRows as SupervisorObservationReportRow[];
        sheet.columns = [
          { header: 'Empresa', key: 'empresa', width: 24 },
          { header: 'RUC', key: 'ruc', width: 14 },
          { header: 'Observación', key: 'body', width: 40 },
          { header: 'Autor', key: 'author', width: 18 },
          { header: 'Fecha', key: 'fecha', width: 18 },
        ];
        sheet.getRow(3).font = { bold: true };
        observationRows.forEach((r) => {
          sheet.addRow({
            empresa: r.company_name,
            ruc: r.company_ruc,
            body: r.body,
            author: r.author_name,
            fecha: new Date(r.created_at).toLocaleString(),
          });
        });
      } else {
        const reportRows = exportRows as SupervisorReportRow[];
        sheet.columns = [
          { header: 'Empresa', key: 'empresa', width: 28 },
          { header: 'RUC', key: 'ruc', width: 14 },
          { header: 'Estado', key: 'estado', width: 14 },
          { header: 'Riesgo', key: 'riesgo', width: 12 },
          { header: 'Cumplimiento %', key: 'cumplimiento', width: 14 },
          { header: 'NPS pend.', key: 'nps', width: 10 },
          { header: 'Pagos pend.', key: 'pagos', width: 10 },
          { header: 'Total a pagar', key: 'total', width: 14 },
        ];
        sheet.getRow(3).font = { bold: true };
        reportRows.forEach((r) => {
          const row = sheet.addRow({
            empresa: r.company_name,
            ruc: r.company_ruc,
            estado: controlStatusLabel(r.general_status),
            riesgo: riskLevelLabel(r.risk_level),
            cumplimiento: r.compliance_pct ?? 0,
            nps: r.nps_pending ?? 0,
            pagos: r.payments_pending ?? 0,
            total: r.total_pagar,
          });
          row.getCell('total').numFmt = '"S/" #,##0.00';
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `reporte-supervisores-${kind}-${periodYm}.xlsx`,
      );
    } catch {
      setError('No se pudo exportar a Excel');
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    try {
      setExportingPdf(true);
      const rawExport = await fetchExportData();
      const exportRows = Array.isArray(rawExport) ? rawExport : [];
      const tabLabel = REPORT_TABS.find((t) => t.kind === kind)?.label ?? kind;

      const PdfDoc = (
        <Document>
          <Page size="A4" style={pdfStyles.page}>
            <Text style={pdfStyles.title}>
              Reporte supervisores ({tabLabel}) — {periodYm}
            </Text>
            {kind === 'productivity' ? (
              <>
                <View style={[pdfStyles.row, pdfStyles.header]}>
                  <Text style={pdfStyles.cell}>Responsable</Text>
                  <Text style={pdfStyles.cell}>Total</Text>
                  <Text style={pdfStyles.cell}>Al día</Text>
                  <Text style={pdfStyles.cell}>%</Text>
                </View>
                {(exportRows as SupervisorProductivityRow[]).map((r) => (
                  <View key={r.user_id} style={pdfStyles.row}>
                    <Text style={pdfStyles.cell}>{r.user_name}</Text>
                    <Text style={pdfStyles.cell}>{r.total}</Text>
                    <Text style={pdfStyles.cell}>{r.al_dia}</Text>
                    <Text style={pdfStyles.cell}>{r.compliance_pct}%</Text>
                  </View>
                ))}
              </>
            ) : kind === 'observations' ? (
              (exportRows as SupervisorObservationReportRow[]).map((r) => (
                <View key={r.id} style={pdfStyles.row}>
                  <Text style={pdfStyles.cell}>
                    {r.company_name} — {r.body.slice(0, 120)}
                  </Text>
                </View>
              ))
            ) : exportRows.length > 0 ? (
              <>
                <View style={[pdfStyles.row, pdfStyles.header]}>
                  <Text style={pdfStyles.cell}>Empresa</Text>
                  <Text style={pdfStyles.cell}>RUC</Text>
                  <Text style={pdfStyles.cell}>Estado</Text>
                  <Text style={pdfStyles.cell}>Cumpl. %</Text>
                  <Text style={pdfStyles.cell}>Total</Text>
                </View>
                {(exportRows as SupervisorReportRow[]).map((r, i) => (
                  <View key={`${r.company_ruc}-${i}`} style={pdfStyles.row}>
                    <Text style={pdfStyles.cell}>{r.company_name}</Text>
                    <Text style={pdfStyles.cell}>{r.company_ruc}</Text>
                    <Text style={pdfStyles.cell}>{controlStatusLabel(r.general_status)}</Text>
                    <Text style={pdfStyles.cell}>{r.compliance_pct ?? 0}%</Text>
                    <Text style={pdfStyles.cell}>S/ {r.total_pagar.toFixed(2)}</Text>
                  </View>
                ))}
              </>
            ) : (
              <Text>Sin datos</Text>
            )}
          </Page>
        </Document>
      );

      const blob = await pdf(PdfDoc).toBlob();
      saveAs(blob, `reporte-supervisores-${kind}-${periodYm}.pdf`);
    } catch {
      setError('No se pudo exportar a PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  if (!allowed) {
    return <p className="p-6 text-center text-slate-600">Sin permiso para reportes de supervisores.</p>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Reportes supervisores</h2>
          <p className="text-sm text-slate-500">Vistas por tipo de cumplimiento y productividad.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600 flex items-center gap-2">
            Período
            <input
              type="month"
              value={periodYm}
              onChange={(e) => setPeriod(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={loading || exportingExcel || pagination.total === 0}
            onClick={() => void handleExportExcel()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <i className={`fas ${exportingExcel ? 'fa-spinner fa-spin' : 'fa-file-excel'} text-xs text-emerald-700`} />
            Excel
          </button>
          <button
            type="button"
            disabled={loading || exportingPdf || pagination.total === 0}
            onClick={() => void handleExportPdf()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <i className={`fas ${exportingPdf ? 'fa-spinner fa-spin' : 'fa-file-pdf'} text-xs text-red-600`} />
            PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-1">
        {REPORT_TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => setKind(t.kind)}
            className={`px-3 py-1.5 text-sm rounded-full ${
              kind === t.kind ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-500">{REPORT_KIND_HINTS[kind]}</p>

      {showSearch ? (
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por RUC, razón social u observación…"
              className="w-full border border-slate-200 rounded-full pl-9 pr-4 py-2 text-sm"
              autoComplete="off"
            />
          </div>
          {qApplied ? (
            <span className="text-xs text-slate-500">
              Filtro: «{qApplied}» — {pagination.total} resultado(s)
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">Cargando…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!loading && !error ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            {kind === 'productivity' ? (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-3">Responsable</th>
                    <th className="text-right px-4 py-3">Controles</th>
                    <th className="text-right px-4 py-3">Al día</th>
                    <th className="text-right px-4 py-3">Cumplimiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        Sin datos para este período.
                      </td>
                    </tr>
                  ) : (
                    (rows as SupervisorProductivityRow[]).map((r) => (
                      <tr key={r.user_id}>
                        <td className="px-4 py-3 font-medium">{r.user_name}</td>
                        <td className="px-4 py-3 text-right">{r.total}</td>
                        <td className="px-4 py-3 text-right">{r.al_dia}</td>
                        <td className="px-4 py-3 text-right">{r.compliance_pct}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : kind === 'observations' ? (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-3">Empresa</th>
                    <th className="text-left px-4 py-3">Observación</th>
                    <th className="text-left px-4 py-3">Autor</th>
                    <th className="text-left px-4 py-3">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        Sin observaciones en este período.
                      </td>
                    </tr>
                  ) : (
                    (rows as SupervisorObservationReportRow[]).map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{r.company_name}</p>
                          <p className="text-xs text-slate-400 font-mono">{r.company_ruc}</p>
                          {r.monthly_control_id ? (
                            <Link
                              to={`/supervisors/controls/${r.monthly_control_id}`}
                              className="text-xs text-primary-700"
                            >
                              Ver control
                            </Link>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 max-w-md">{r.body}</td>
                        <td className="px-4 py-3">{r.author_name}</td>
                        <td className="px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-4 py-3">Empresa</th>
                    <th className="text-left px-4 py-3">RUC</th>
                    <th className="text-left px-4 py-3">Estado</th>
                    <th className="text-left px-4 py-3">Riesgo</th>
                    {showComplianceCol ? (
                      <th className="text-right px-4 py-3">Cumplimiento %</th>
                    ) : null}
                    {showNpsCountCol ? (
                      <th className="text-right px-4 py-3">NPS pend.</th>
                    ) : null}
                    {showPaymentsCountCol ? (
                      <th className="text-right px-4 py-3">Pagos pend.</th>
                    ) : null}
                    <th className="text-right px-4 py-3">Total a pagar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={
                          5 +
                          (showComplianceCol ? 1 : 0) +
                          (showNpsCountCol ? 1 : 0) +
                          (showPaymentsCountCol ? 1 : 0)
                        }
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No hay registros para este período o búsqueda.
                      </td>
                    </tr>
                  ) : (
                    (rows as SupervisorReportRow[]).map((r, i) => (
                      <tr key={`${r.company_ruc}-${i}`}>
                        <td className="px-4 py-3 font-medium">{r.company_name}</td>
                        <td className="px-4 py-3 font-mono text-xs">{r.company_ruc}</td>
                        <td className="px-4 py-3">{controlStatusLabel(r.general_status)}</td>
                        <td className="px-4 py-3">{riskLevelLabel(r.risk_level)}</td>
                        {showComplianceCol ? (
                          <td className="px-4 py-3 text-right">{r.compliance_pct ?? 0}%</td>
                        ) : null}
                        {showNpsCountCol ? (
                          <td className="px-4 py-3 text-right text-amber-700">{r.nps_pending ?? 0}</td>
                        ) : null}
                        {showPaymentsCountCol ? (
                          <td className="px-4 py-3 text-right text-red-700">{r.payments_pending ?? 0}</td>
                        ) : null}
                        <td className="px-4 py-3 text-right">S/ {r.total_pagar.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
          {kind !== 'productivity' && pagination.total_pages > 0 ? (
            <Pagination
              page={pagination.page}
              perPage={pagination.per_page}
              total={pagination.total}
              onPageChange={handlePageChange}
              onPerPageChange={handlePerPageChange}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
};

export default SupervisorReports;
