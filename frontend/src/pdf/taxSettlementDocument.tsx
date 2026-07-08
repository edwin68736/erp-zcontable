import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import { Fragment } from 'react';
import type { FirmConfig, TaxSettlement, TaxSettlementLine } from '../types/dashboard';
import { periodLabelFromYM } from '../utils/liquidationPeriod';
import { loadLogoPngBlobForPdf } from '../utils/pdfLogo';
import {
  formatTaxMoney,
  isNonZeroTaxAmount,
  parseTaxSectionsJson,
  type TaxSettlementSectionsPayload,
} from '../utils/taxSettlementSections';
import { getRentaMensualRatePct } from '../utils/companyTaxRegime';
import { PdfClientInfoRow, PdfHighlightedTotalRow, PdfLiquidationHeader, PdfSectionBar, pdfLiquidationStyles } from './pdfLiquidationComponents';
import { formatIssueDateForPdf, PDF_LIQ } from './pdfLiquidationTheme';
import { Pdt621PdfSection } from './pdt621PdfSection';
import { Pdt601PdfSection } from './pdt601PdfSection';
import {
  PdfLiquidationPaymentFooter,
  PdfTaxRecommendationsFooter,
  type LiquidationPdfAssets,
} from './pdfLiquidationFooter';

export function lineTypeLabelForPdf(t: string): string {
  if (t === 'document_ref') return 'Deuda';
  if (t === 'tax_manual' || t === 'adjustment') return 'Concepto';
  return t;
}

function sumLines(lines: TaxSettlementLine[] | undefined) {
  let honorarios = 0;
  let impuestos = 0;
  for (const ln of lines ?? []) {
    if (ln.line_type === 'tax_manual') impuestos += Number(ln.amount) || 0;
    else honorarios += Number(ln.amount) || 0;
  }
  return { honorarios, impuestos, total: honorarios + impuestos };
}

export function settlementTotalsForPdf(row: TaxSettlement) {
  const emitted = row.status === 'emitida' || row.status === 'cerrada';
  if (emitted) {
    return {
      honorarios: Number(row.total_honorarios) || 0,
      impuestos: Number(row.total_impuestos) || 0,
      total: Number(row.total_general) || 0,
      emitted: true,
    };
  }
  const s = sumLines(row.lines);
  const sections = parseTaxSectionsJson(row.pdt621_json);
  const sectionTax = sections?.grand_total_impuesto_a_pagar ?? 0;
  const impuestos = s.impuestos > 0 ? s.impuestos : sectionTax > 0 ? sectionTax : Number(row.total_impuestos) || 0;
  const total = s.honorarios + impuestos;
  return { honorarios: s.honorarios, impuestos, total, emitted: false };
}

export async function getLogoPngBlobForPdf(logoUrl: string): Promise<Blob | null> {
  return loadLogoPngBlobForPdf(logoUrl);
}

const formatMoney = (value: number) => `S/ ${Number(value ?? 0).toFixed(2)}`;
const formatMoneyAmountOnly = (value: number) => Number(value ?? 0).toFixed(2);

const docStyles = StyleSheet.create({
  draftBanner: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 4,
    padding: 8,
    marginBottom: 10,
  },
  draftBannerText: { fontSize: 8, color: '#9a3412', fontWeight: 700 },
  table: { borderWidth: 1, borderColor: PDF_LIQ.grayBorder },
  honorariosTotal: { marginTop: 6 },
  rowHead: { flexDirection: 'row', backgroundColor: PDF_LIQ.blue, borderBottomWidth: 1, borderBottomColor: PDF_LIQ.blueDark },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  rowAlt: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', backgroundColor: PDF_LIQ.grayBg },
  cell: { paddingVertical: 6, paddingHorizontal: 8 },
  colTipo: { width: '14%' },
  colPeriodo: { width: '14%' },
  colConcepto: { width: '42%' },
  colMonto: { width: '30%', textAlign: 'right' },
  headText: { fontSize: 7.5, fontWeight: 700, color: PDF_LIQ.white, textTransform: 'uppercase' },
  rowText: { fontSize: 8, color: PDF_LIQ.text },
  notes: { marginTop: 10, padding: 8, backgroundColor: PDF_LIQ.grayBg, borderWidth: 1, borderColor: PDF_LIQ.grayBorder },
  notesTitle: { fontSize: 8, fontWeight: 700, color: PDF_LIQ.blueDark, marginBottom: 4, textTransform: 'uppercase' },
  notesText: { fontSize: 8, color: PDF_LIQ.text },
  pdtBlock: { marginBottom: 10 },
  pdtText: { fontSize: 7, color: PDF_LIQ.textMuted },
  pdtSubBlock: { marginBottom: 8 },
  taxSectionsTail: { marginBottom: 10 },
  footer: { position: 'absolute', bottom: 14, left: 28, right: 28, fontSize: 8, color: '#94a3b8' },
});

type TaxSettlementPdfDocumentProps = {
  settlement: TaxSettlement;
  firm: FirmConfig | null;
  logoPng: Blob | null;
  footerAssets?: LiquidationPdfAssets | null;
};

export function TaxSettlementPdfDocument({ settlement, firm, logoPng, footerAssets }: TaxSettlementPdfDocumentProps) {
  const firmName = firm?.name?.trim() || 'Estudio contable';
  const totals = settlementTotalsForPdf(settlement);
  const client = settlement.company;
  const docTitle = `Liquidación ${settlement.number?.trim() || `#${settlement.id}`}`;
  const liqNumber = settlement.number?.trim() || `LIQ-${settlement.id}`;
  const issueStr = formatIssueDateForPdf(settlement.issue_date);
  const periodDisplay =
    (settlement.period_label ?? '').trim() ||
    periodLabelFromYM((settlement.liquidation_period ?? '').trim()) ||
    (settlement.liquidation_period ?? '').trim() ||
    '—';
  const sortedLines = [...(settlement.lines ?? [])]
    .filter((ln) => isNonZeroTaxAmount(Number(ln.amount) || 0))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0));

  const pdtSnippet = (settlement.pdt621_json ?? '').trim();
  const taxSections = parseTaxSectionsJson(settlement.pdt621_json);

  const renderTaxSections = (sections: TaxSettlementSectionsPayload) => (
    <Fragment>
      <PdfSectionBar title="Detalle" />
      {sections.pdt621?.enabled ? (
        <View style={docStyles.pdtSubBlock}>
          <PdfSectionBar title="PDT 621 — IGV y Renta" light />
          <Pdt621PdfSection
            p621={sections.pdt621}
            rentaRatePct={
              sections.pdt621.renta_regimen
                ? getRentaMensualRatePct(sections.pdt621.renta_regimen, sections.pdt621.renta_coeficiente_pct ?? 0)
                : null
            }
          />
        </View>
      ) : null}
      {sections.pdt601?.enabled ? (
        <View style={docStyles.pdtSubBlock}>
          <PdfSectionBar title="PDT 601 — Planilla electrónica" light />
          <Pdt601PdfSection p601={sections.pdt601} />
        </View>
      ) : null}
      {sections.itan?.enabled ? (
        <View style={docStyles.pdtSubBlock}>
          <PdfSectionBar title={`ITAN ${sections.itan.year} — Cuota ${sections.itan.cuota_nro}`} light />
          <Text style={docStyles.pdtText}>
            Impuesto a pagar: {formatTaxMoney(sections.itan.impuesto_a_pagar)}
          </Text>
        </View>
      ) : null}
      <View style={docStyles.taxSectionsTail}>
        <PdfHighlightedTotalRow
          label="Total impuestos a pagar"
          amount={formatMoneyAmountOnly(sections.grand_total_impuesto_a_pagar)}
        />
      </View>
    </Fragment>
  );

  return (
    <Document title={docTitle}>
      <Page size="A4" style={pdfLiquidationStyles.page}>
        <PdfLiquidationHeader firm={firm} logoPng={logoPng} liqNumber={liqNumber} />

        {!totals.emitted ? (
          <View style={docStyles.draftBanner}>
            <Text style={docStyles.draftBannerText}>BORRADOR — Los totales se calculan desde las líneas; emita la liquidación para fijar el documento final.</Text>
          </View>
        ) : null}

        <View style={pdfLiquidationStyles.clientBox}>
          {(
            [
              { label: 'Cliente', value: client?.business_name ?? '—' },
              { label: 'RUC', value: client?.ruc ?? '—' },
              { label: 'Periodo', value: periodDisplay },
              { label: 'Fecha de emisión', value: issueStr },
            ] as const
          ).map((row, idx, arr) => (
            <PdfClientInfoRow
              key={row.label}
              label={row.label}
              value={row.value}
              last={idx === arr.length - 1}
            />
          ))}
        </View>

        <View style={pdfLiquidationStyles.introBar}>
          <Text style={pdfLiquidationStyles.introText}>
            Ante todo saludarlo, la presente es para informarle el detalle de compras y ventas del mes, además de los
            impuestos a pagar.
          </Text>
        </View>

        {taxSections ? renderTaxSections(taxSections) : pdtSnippet ? (
          <View style={docStyles.pdtBlock}>
            <PdfSectionBar title="Detalle" />
            <Text style={docStyles.pdtText}>{pdtSnippet.length > 1200 ? `${pdtSnippet.slice(0, 1200)}…` : pdtSnippet}</Text>
          </View>
        ) : null}

        <PdfSectionBar title="Honorarios y cargos del estudio" breakBefore />
        <View style={docStyles.table}>
          <View style={docStyles.rowHead}>
            <View style={[docStyles.cell, docStyles.colTipo]}>
              <Text style={docStyles.headText}>Tipo</Text>
            </View>
            <View style={[docStyles.cell, docStyles.colPeriodo]}>
              <Text style={docStyles.headText}>Periodo</Text>
            </View>
            <View style={[docStyles.cell, docStyles.colConcepto]}>
              <Text style={docStyles.headText}>Concepto</Text>
            </View>
            <View style={[docStyles.cell, docStyles.colMonto]}>
              <Text style={docStyles.headText}>Monto</Text>
            </View>
          </View>
          {sortedLines.length > 0 ? (
            sortedLines.map((ln, idx) => (
              <View key={ln.id ?? idx} style={idx % 2 === 1 ? docStyles.rowAlt : docStyles.row}>
                <View style={[docStyles.cell, docStyles.colTipo]}>
                  <Text style={docStyles.rowText}>{lineTypeLabelForPdf(ln.line_type)}</Text>
                </View>
                <View style={[docStyles.cell, docStyles.colPeriodo]}>
                  <Text style={docStyles.rowText}>
                    {(() => {
                      const p = (ln.period_ym ?? '').trim();
                      if (p) return p;
                      if (ln.period_date && ln.period_date.length >= 10) return ln.period_date.slice(0, 10);
                      return settlement.liquidation_period || '—';
                    })()}
                  </Text>
                </View>
                <View style={[docStyles.cell, docStyles.colConcepto]}>
                  <Text style={docStyles.rowText}>{ln.concept}</Text>
                </View>
                <View style={[docStyles.cell, docStyles.colMonto]}>
                  <Text style={docStyles.rowText}>{formatMoney(ln.amount)}</Text>
                </View>
              </View>
            ))
          ) : (
            <View style={docStyles.row}>
              <View style={[docStyles.cell, { width: '100%' }]}>
                <Text style={docStyles.rowText}>Sin líneas.</Text>
              </View>
            </View>
          )}
        </View>

        <View style={docStyles.honorariosTotal}>
          <PdfHighlightedTotalRow
            label="Total honorarios a pagar"
            amount={formatMoneyAmountOnly(totals.honorarios)}
          />
        </View>

        {settlement.notes?.trim() ? (
          <View style={docStyles.notes}>
            <Text style={docStyles.notesTitle}>Notas</Text>
            <Text style={docStyles.notesText}>{settlement.notes.trim()}</Text>
          </View>
        ) : null}

        <PdfLiquidationPaymentFooter firm={firm} assets={footerAssets} />
        <PdfTaxRecommendationsFooter />

        <Text
          style={docStyles.footer}
          render={({ pageNumber, totalPages }) => `${firmName} · ${docTitle} · Página ${pageNumber} de ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

export async function generateTaxSettlementPdfBlob(
  settlement: TaxSettlement,
  firm: FirmConfig | null,
  logoPng: Blob | null,
  footerAssets?: LiquidationPdfAssets | null,
): Promise<Blob> {
  const el = (
    <TaxSettlementPdfDocument settlement={settlement} firm={firm} logoPng={logoPng} footerAssets={footerAssets} />
  );
  return pdf(el).toBlob();
}

function liquidationPeriodParts(settlement: TaxSettlement): { year: string; month: string } {
  const period = (settlement.liquidation_period ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split('-');
    return { year, month };
  }
  const issue = (settlement.issue_date ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}/.test(issue)) {
    return { year: issue.slice(0, 4), month: issue.slice(5, 7) };
  }
  const d = new Date();
  return { year: String(d.getFullYear()), month: String(d.getMonth() + 1).padStart(2, '0') };
}

function businessNameForPdfFilename(settlement: TaxSettlement): string {
  const raw = (settlement.company?.business_name ?? settlement.company?.code ?? `EMPRESA-${settlement.company_id}`)
    .trim()
    .toUpperCase();
  const sanitized = raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return sanitized || `EMPRESA-${settlement.company_id}`;
}

export function taxSettlementPdfFilename(settlement: TaxSettlement): string {
  const { year, month } = liquidationPeriodParts(settlement);
  const business = businessNameForPdfFilename(settlement);
  return `LIQ-${year}-${month}-${business}.pdf`;
}
