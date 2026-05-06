import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { reportsService, type FinancialCompanyRow, type FinancialReportQuery } from '../services/reports';
import { companiesService } from '../services/companies';
import { auth } from '../services/auth';
import { configService } from '../services/config';
import type { Company, FirmConfig } from '../types/dashboard';
import { resolveBackendUrl } from '../api/client';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import SearchableSelect from '../components/SearchableSelect';
import Pagination from '../components/Pagination';
import {
  PeriodScoreMini,
  periodDebtMoraSemaforo,
  periodScoreExportLabel,
  periodScoreSolidColor,
} from '../utils/periodDebtScore';

const Reports = () => {
  const role = auth.getRole() ?? '';
  const isAdmin = role === 'Administrador';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [firmConfig, setFirmConfig] = useState<FirmConfig | null>(null);
  const [summary, setSummary] = useState({
    grandDocs: 0,
    grandPays: 0,
    grandBalance: 0,
  });
  const [rows, setRows] = useState<FinancialCompanyRow[]>([]);
  const [companyOptions, setCompanyOptions] = useState<Company[]>([]);

  const [filterCompanyId, setFilterCompanyId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMinOverdue, setFilterMinOverdue] = useState('');
  const [appliedQuery, setAppliedQuery] = useState<FinancialReportQuery>({});
  const financialInvalidDateRangeWarned = useRef(false);

  const [reportPage, setReportPage] = useState(1);
  const [reportPerPage, setReportPerPage] = useState(10);
  /** Orden de la tabla por código de empresa: ascendente = menor a mayor. */
  const [codeSortDir, setCodeSortDir] = useState<'asc' | 'desc'>('asc');

  const reportDateStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const sortedReportRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const ca = String(a.company?.code ?? '').trim();
      const cb = String(b.company?.code ?? '').trim();
      const cmp = ca.localeCompare(cb, 'es', { numeric: true, sensitivity: 'base' });
      return codeSortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, codeSortDir]);

  const pagedReportRows = useMemo(() => {
    const start = (reportPage - 1) * reportPerPage;
    return sortedReportRows.slice(start, start + reportPerPage);
  }, [sortedReportRows, reportPage, reportPerPage]);

  useEffect(() => {
    setReportPage(1);
  }, [appliedQuery]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(sortedReportRows.length / reportPerPage));
    if (reportPage > totalPages) setReportPage(totalPages);
  }, [sortedReportRows.length, reportPerPage, reportPage]);

  const companySelectOptions = useMemo(
    () =>
      companyOptions.map((c) => ({
        value: String(c.id),
        label: `${c.business_name} (${c.code})`,
        searchText: `${c.business_name} ${c.code}`,
      })),
    [companyOptions],
  );

  const buildQueryFromForm = useCallback((): FinancialReportQuery => {
    const q: FinancialReportQuery = {};
    if (filterDateFrom.trim()) q.date_from = filterDateFrom.trim();
    if (filterDateTo.trim()) q.date_to = filterDateTo.trim();
    if (filterCompanyId.trim()) q.company_id = filterCompanyId.trim();
    if (filterMinOverdue.trim()) q.min_overdue_months = filterMinOverdue.trim();
    return q;
  }, [filterCompanyId, filterDateFrom, filterDateTo, filterMinOverdue]);

  const fetchReport = useCallback(async (query: FinancialReportQuery) => {
    try {
      setError('');
      setLoading(true);
      const [res, firm] = await Promise.all([
        reportsService.getFinancialReport(query),
        configService.getFirmConfig().catch(() => null),
      ]);
      setSummary({
        grandDocs: res.total_documents_amount,
        grandPays: res.total_payments_amount,
        grandBalance: res.global_balance,
      });
      setRows(res.rows);
      setFirmConfig(firm);
    } catch (e) {
      console.error(e);
      setError('Error al cargar el reporte financiero');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void companiesService.list().then(setCompanyOptions).catch(() => setCompanyOptions([]));
  }, []);

  useEffect(() => {
    void fetchReport(appliedQuery);
  }, [appliedQuery, fetchReport]);

  useEffect(() => {
    if (filterDateFrom && filterDateTo && filterDateFrom > filterDateTo) {
      if (!financialInvalidDateRangeWarned.current) {
        financialInvalidDateRangeWarned.current = true;
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'error', message: 'La fecha desde no puede ser mayor que la fecha hasta.' },
          }),
        );
      }
      return;
    }
    financialInvalidDateRangeWarned.current = false;
    const next = buildQueryFromForm();
    setAppliedQuery((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [buildQueryFromForm]);

  const handleResetFilters = () => {
    setFilterCompanyId('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterMinOverdue('');
    setReportPage(1);
    setCodeSortDir('asc');
  };

  const handleReportPageChange = (next: number) => setReportPage(next);
  const handleReportPerPageChange = (next: number) => {
    setReportPerPage(next);
    setReportPage(1);
  };

  const toggleCodeSort = () => {
    setCodeSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    setReportPage(1);
  };

  const formatMoney = (value: number) => {
    const n = Number(value ?? 0);
    return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getLogoDataUrl = async (logoUrl: string): Promise<string | null> => {
    const url = (logoUrl ?? '').trim();
    if (!url) return null;
    const resolved = resolveBackendUrl(url);
    if (resolved.startsWith('data:')) return resolved;
    try {
      const res = await fetch(resolved);
      if (!res.ok) return null;
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return dataUrl || null;
    } catch {
      return null;
    }
  };

  const handleExportExcel = async () => {
    if (exportingExcel) return;
    try {
      setExportingExcel(true);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'MiWeb';
      workbook.created = new Date();

      const sheet = workbook.addWorksheet('Reporte financiero', {
        properties: { defaultRowHeight: 18 },
        views: [{ state: 'frozen', ySplit: 6 }],
      });

      sheet.columns = [
        { header: 'Empresa', key: 'empresa', width: 24 },
        { header: 'Código', key: 'codigo', width: 11 },
        { header: 'Total documentos', key: 'docs', width: 15 },
        { header: 'Total pagos', key: 'pays', width: 15 },
        { header: 'Saldo', key: 'balance', width: 13 },
        { header: 'Periodo', key: 'periodo', width: 11 },
        { header: 'Mora (periodo)', key: 'mora', width: 16 },
        { header: 'Score', key: 'score', width: 22 },
      ];

      const firmName = firmConfig?.name ? String(firmConfig.name) : 'Estudio';

      sheet.mergeCells('A1:H1');
      sheet.getCell('A1').value = firmName;
      sheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF0F172A' } };
      sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };

      sheet.mergeCells('A2:H2');
      sheet.getCell('A2').value = `Reporte financiero - ${reportDateStr}`;
      sheet.getCell('A2').font = { size: 11, color: { argb: 'FF475569' } };
      sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'left' };

      sheet.getCell('A4').value = 'Total documentos';
      sheet.getCell('B4').value = summary.grandDocs;
      sheet.getCell('C4').value = 'Total pagos';
      sheet.getCell('D4').value = summary.grandPays;
      sheet.getCell('E4').value = summary.grandBalance;
      sheet.getCell('F4').value = '';
      sheet.getCell('G4').value = '';
      sheet.getCell('H4').value = '';

      sheet.getCell('A5').value = '';
      sheet.getCell('B4').numFmt = '"S/" #,##0.00';
      sheet.getCell('D4').numFmt = '"S/" #,##0.00';
      sheet.getCell('E4').numFmt = '"S/" #,##0.00';

      const headerRowNumber = 6;
      const headerRow = sheet.getRow(headerRowNumber);
      headerRow.font = { bold: true, color: { argb: 'FF475569' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
      headerRow.commit();

      sortedReportRows.forEach((r) => {
        const mora = periodDebtMoraSemaforo(r.max_overdue_months, r.has_overdue).label;
        const row = sheet.addRow({
          empresa: r.company.business_name,
          codigo: r.company.code,
          docs: r.total_documents,
          pays: r.total_payments,
          balance: r.balance,
          periodo: r.oldest_open_debt_period || '—',
          mora,
          score: periodScoreExportLabel(r.max_overdue_months),
        });
        row.getCell('C').numFmt = '"S/" #,##0.00';
        row.getCell('D').numFmt = '"S/" #,##0.00';
        row.getCell('E').numFmt = '"S/" #,##0.00';
      });

      sheet.getColumn('C').alignment = { horizontal: 'right' };
      sheet.getColumn('D').alignment = { horizontal: 'right' };
      sheet.getColumn('E').alignment = { horizontal: 'right' };
      sheet.getColumn('F').alignment = { horizontal: 'center' };
      sheet.getColumn('G').alignment = { horizontal: 'center' };
      sheet.getColumn('H').alignment = { horizontal: 'left' };

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(
        new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `reporte-financiero-${reportDateStr}.xlsx`,
      );
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Excel generado correctamente.' } }),
      );
    } catch (e) {
      console.error(e);
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al generar Excel.' } }));
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    try {
      setExportingPdf(true);
      const logoDataUrl = firmConfig?.logo_url ? await getLogoDataUrl(firmConfig.logo_url) : null;
      const firmName = firmConfig?.name ? String(firmConfig.name) : 'Estudio';

      const styles = StyleSheet.create({
        page: { paddingTop: 28, paddingBottom: 32, paddingHorizontal: 28, fontSize: 10, color: '#0f172a' },
        header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
        headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        logo: { width: 42, height: 42, objectFit: 'contain' },
        firmName: { fontSize: 12, fontWeight: 700 },
        subtitle: { fontSize: 10, color: '#475569', marginTop: 2 },
        summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
        summaryCard: { flexGrow: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10 },
        summaryLabel: { fontSize: 9, color: '#64748b', marginBottom: 3 },
        summaryValue: { fontSize: 12, fontWeight: 700 },
        table: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, overflow: 'hidden' },
        rowHead: { flexDirection: 'row', backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
        row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
        cell: { paddingVertical: 8, paddingHorizontal: 8 },
        cellEmpresa: { width: '18%' },
        cellCodigo: { width: '10%' },
        cellMoney: { width: '11%', textAlign: 'right' },
        cellPeriodo: { width: '9%', textAlign: 'center' },
        cellMora: { width: '11%', textAlign: 'center' },
        cellScore: { width: '17%', textAlign: 'center' },
        headText: { fontSize: 9, fontWeight: 700, color: '#475569' },
        rowText: { fontSize: 9, color: '#0f172a' },
        moraBase: { fontSize: 9, fontWeight: 700 },
        footer: { position: 'absolute', bottom: 16, left: 28, right: 28, fontSize: 9, color: '#94a3b8' },
      });

      const PdfDoc = (
        <Document title={`Reporte financiero - ${reportDateStr}`}>
          <Page size="A4" style={styles.page}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                {logoDataUrl ? <Image style={styles.logo} src={logoDataUrl} /> : null}
                <View>
                  <Text style={styles.firmName}>{firmName}</Text>
                  <Text style={styles.subtitle}>{`Reporte financiero - ${reportDateStr}`}</Text>
                </View>
              </View>
            </View>

            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Total documentos</Text>
                <Text style={styles.summaryValue}>{formatMoney(summary.grandDocs)}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Total pagos</Text>
                <Text style={styles.summaryValue}>{formatMoney(summary.grandPays)}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Saldo global</Text>
                <Text style={styles.summaryValue}>{formatMoney(summary.grandBalance)}</Text>
              </View>
            </View>

            <View style={styles.table}>
              <View style={styles.rowHead}>
                <View style={[styles.cell, styles.cellEmpresa]}>
                  <Text style={styles.headText}>Empresa</Text>
                </View>
                <View style={[styles.cell, styles.cellCodigo]}>
                  <Text style={styles.headText}>Código</Text>
                </View>
                <View style={[styles.cell, styles.cellMoney]}>
                  <Text style={styles.headText}>Documentos</Text>
                </View>
                <View style={[styles.cell, styles.cellMoney]}>
                  <Text style={styles.headText}>Pagos</Text>
                </View>
                <View style={[styles.cell, styles.cellMoney]}>
                  <Text style={styles.headText}>Saldo</Text>
                </View>
                <View style={[styles.cell, styles.cellPeriodo]}>
                  <Text style={styles.headText}>Periodo</Text>
                </View>
                <View style={[styles.cell, styles.cellMora]}>
                  <Text style={styles.headText}>Mora</Text>
                </View>
                <View style={[styles.cell, styles.cellScore]}>
                  <Text style={styles.headText}>Score</Text>
                </View>
              </View>

              {sortedReportRows.length > 0 ? (
                sortedReportRows.map((r, idx) => {
                  const mora = periodDebtMoraSemaforo(r.max_overdue_months, r.has_overdue);
                  const scoreFill = periodScoreSolidColor(r.max_overdue_months);
                  return (
                    <View key={`${r.company.id}-${idx}`} style={styles.row} wrap>
                      <View style={[styles.cell, styles.cellEmpresa]}>
                        <Text style={styles.rowText}>{r.company.business_name}</Text>
                      </View>
                      <View style={[styles.cell, styles.cellCodigo]}>
                        <Text style={styles.rowText}>{r.company.code}</Text>
                      </View>
                      <View style={[styles.cell, styles.cellMoney]}>
                        <Text style={styles.rowText}>{formatMoney(r.total_documents)}</Text>
                      </View>
                      <View style={[styles.cell, styles.cellMoney]}>
                        <Text style={styles.rowText}>{formatMoney(r.total_payments)}</Text>
                      </View>
                      <View style={[styles.cell, styles.cellMoney]}>
                        <Text style={styles.rowText}>{formatMoney(r.balance)}</Text>
                      </View>
                      <View style={[styles.cell, styles.cellPeriodo]}>
                        <Text style={styles.rowText}>{r.oldest_open_debt_period || '—'}</Text>
                      </View>
                      <View style={[styles.cell, styles.cellMora]}>
                        <Text style={[styles.moraBase, { color: mora.pdfColor }]}>{mora.label}</Text>
                      </View>
                      <View style={[styles.cell, styles.cellScore]}>
                        <View
                          style={{
                            height: 6,
                            borderRadius: 3,
                            overflow: 'hidden',
                            backgroundColor: '#e2e8f0',
                          }}
                        >
                          <View
                            style={{
                              height: '100%',
                              width: '100%',
                              borderRadius: 3,
                              backgroundColor: scoreFill,
                            }}
                          />
                        </View>
                        <Text style={[styles.rowText, { fontSize: 7, marginTop: 2, color: '#64748b' }]}>
                          {periodScoreExportLabel(r.max_overdue_months)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.row}>
                  <View style={[styles.cell, { width: '100%' }]}>
                    <Text style={styles.rowText}>No hay empresas que coincidan con los filtros.</Text>
                  </View>
                </View>
              )}
            </View>

            <Text
              style={styles.footer}
              render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
              fixed
            />
          </Page>
        </Document>
      );

      const blob = await pdf(PdfDoc).toBlob();
      saveAs(blob, `reporte-financiero-${reportDateStr}.pdf`);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'PDF generado correctamente.' } }),
      );
    } catch (e) {
      console.error(e);
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al generar PDF.' } }));
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Reportes financieros</h2>
          <p className="text-sm text-slate-500">
            {isAdmin
              ? 'Resumen global de documentos, pagos y saldos por empresa. Las fechas filtran totales por emisión/pagos. La mora mínima y el score usan el periodo contable del cargo con saldo (periodo de servicio o mes de emisión).'
              : 'Resumen de documentos, pagos y saldos de tus empresas asignadas. Las mismas reglas de periodo y mora aplican según tus permisos.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={loading || exportingExcel}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <i className={`fas ${exportingExcel ? 'fa-spinner fa-spin' : 'fa-file-excel'} text-xs`}></i>
            Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={loading || exportingPdf}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 disabled:opacity-60"
          >
            <i className={`fas ${exportingPdf ? 'fa-spinner fa-spin' : 'fa-file-pdf'} text-xs`}></i>
            PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="fin-company" className="block text-xs font-medium text-slate-500 mb-1">
              Empresa
            </label>
            <SearchableSelect
              id="fin-company"
              value={filterCompanyId}
              onChange={setFilterCompanyId}
              options={companySelectOptions}
              placeholder="Todas las empresas"
              disabled={loading && companySelectOptions.length === 0}
              className="w-full"
            />
          </div>
          <div>
            <label htmlFor="fin-date-from" className="block text-xs font-medium text-slate-500 mb-1">
              Fecha desde (pagos)
            </label>
            <input
              id="fin-date-from"
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div>
            <label htmlFor="fin-date-to" className="block text-xs font-medium text-slate-500 mb-1">
              Fecha hasta (pagos)
            </label>
            <input
              id="fin-date-to"
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div>
            <label htmlFor="fin-mora" className="block text-xs font-medium text-slate-500 mb-1">
              Atraso en periodo (mín.)
            </label>
            <select
              id="fin-mora"
              value={filterMinOverdue}
              onChange={(e) => setFilterMinOverdue(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
            >
              <option value="">Sin filtro</option>
              <option value="1">≥ 1 mes (periodo)</option>
              <option value="2">≥ 2 meses (periodo)</option>
              <option value="3">≥ 3 meses (periodo)</option>
              <option value="4">≥ 4 meses (periodo)</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleResetFilters}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Limpiar
          </button>
        </div>
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase">Total documentos</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{formatMoney(summary.grandDocs)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase">Total pagos</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{formatMoney(summary.grandPays)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-medium text-slate-500 uppercase">Saldo global</p>
          <p
            className={`mt-1 text-2xl font-bold ${summary.grandBalance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}
          >
            {formatMoney(summary.grandBalance)}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Detalle por empresa</h3>
        </div>
        <div className="overflow-x-auto -mx-1 sm:mx-0 touch-pan-x">
          <table className="w-full min-w-[36rem] sm:min-w-0 text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 text-[10px] sm:text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3 w-[11rem] sm:w-[32rem] max-w-[32rem]">Empresa</th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 w-14 sm:w-24 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={toggleCodeSort}
                    className="inline-flex items-center gap-1 max-sm:gap-0.5 text-left font-semibold text-slate-500 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                    title={codeSortDir === 'asc' ? 'Orden: código menor a mayor' : 'Orden: código mayor a menor'}
                  >
                    <span className="max-sm:hidden">Código</span>
                    <span className="sm:hidden">Cod.</span>
                    <i
                      className={`fas text-[9px] sm:text-[10px] ${codeSortDir === 'asc' ? 'fa-sort-alpha-down' : 'fa-sort-alpha-up-alt'}`}
                      aria-hidden
                    />
                  </button>
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-right whitespace-nowrap" title="Total documentos">
                  Docs
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-right whitespace-nowrap" title="Total pagos">
                  Pagos
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-right whitespace-nowrap">Saldo</th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-center whitespace-nowrap" title="Periodo contable más antiguo">
                  <span className="max-sm:hidden">Periodo</span>
                  <span className="sm:hidden">Per.</span>
                </th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-center whitespace-nowrap">Mora</th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-center whitespace-nowrap w-14 sm:w-24">Score</th>
                <th className="px-2 py-2 sm:px-3 sm:py-3 text-right whitespace-nowrap w-28 sm:w-36">Acc.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2"></i> Cargando reporte...
                  </td>
                </tr>
              ) : sortedReportRows.length > 0 ? (
                pagedReportRows.map((row, idx) => {
                  const mora = periodDebtMoraSemaforo(row.max_overdue_months, row.has_overdue);
                  return (
                    <tr key={`${row.company.id}-${(reportPage - 1) * reportPerPage + idx}`} className="hover:bg-slate-50">
                      <td className="px-3 py-3 w-[11rem] sm:w-[32rem] max-w-[32rem] text-slate-800 font-medium align-top">
                        <span className="block truncate sm:whitespace-normal sm:break-words" title={row.company.business_name}>
                          {row.company.business_name}
                        </span>
                      </td>
                      <td className="px-2 py-2 sm:px-3 sm:py-3 text-slate-600 text-[11px] sm:text-xs font-mono whitespace-nowrap">
                        {row.company.code}
                      </td>
                      <td className="px-2 py-2 sm:px-3 sm:py-3 text-right text-slate-800 whitespace-nowrap tabular-nums text-[11px] sm:text-sm">
                        {formatMoney(row.total_documents)}
                      </td>
                      <td className="px-2 py-2 sm:px-3 sm:py-3 text-right text-slate-800 whitespace-nowrap tabular-nums text-[11px] sm:text-sm">
                        {formatMoney(row.total_payments)}
                      </td>
                      <td
                        className={`px-2 py-2 sm:px-3 sm:py-3 text-right whitespace-nowrap tabular-nums text-[11px] sm:text-sm ${
                          row.balance > 0 ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {formatMoney(row.balance)}
                      </td>
                      <td className="px-2 py-2 sm:px-3 sm:py-3 text-center text-slate-700 text-[10px] sm:text-xs font-mono whitespace-nowrap">
                        {row.oldest_open_debt_period || '—'}
                      </td>
                      <td className="px-1.5 py-2 sm:px-3 sm:py-3 text-center">
                        <span
                          className={`inline-flex max-w-full items-center justify-center px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-semibold whitespace-nowrap ${mora.cls}`}
                        >
                          {mora.label}
                        </span>
                      </td>
                      <td className="px-1.5 py-2 sm:px-3 sm:py-3 text-center align-middle">
                        <div className="flex justify-center">
                          <PeriodScoreMini compact maxLag={row.max_overdue_months} />
                        </div>
                      </td>
                      <td className="px-2 py-2 sm:px-3 sm:py-3">
                        <div className="flex items-center justify-end">
                          <Link
                            to={`/companies/${row.company.id}/statement`}
                            title="Estado de cuenta"
                            className="inline-flex items-center justify-center gap-0 sm:gap-1 max-sm:size-9 max-sm:rounded-full max-sm:p-0 sm:px-3 sm:py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <i className="fas fa-file-invoice-dollar sm:mr-0 text-sm sm:text-xs" aria-hidden />
                            <span className="hidden sm:inline">Estado de cuenta</span>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-500 text-sm">
                    No hay empresas que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!loading || sortedReportRows.length > 0 ? (
          <div className="px-4 sm:px-6 py-4 border-t border-slate-100">
            <Pagination
              page={reportPage}
              perPage={reportPerPage}
              total={sortedReportRows.length}
              onPageChange={handleReportPageChange}
              onPerPageChange={handleReportPerPageChange}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Reports;
