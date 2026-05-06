import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { FirmConfig, TaxSettlement, TaxSettlementLine } from '../types/dashboard';
import { loadLogoPngBlobForPdf } from '../utils/pdfLogo';

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
  const emitted = row.status === 'emitida';
  if (emitted) {
    return {
      honorarios: Number(row.total_honorarios) || 0,
      impuestos: Number(row.total_impuestos) || 0,
      total: Number(row.total_general) || 0,
      emitted: true,
    };
  }
  const s = sumLines(row.lines);
  return { ...s, emitted: false };
}

export async function getLogoPngBlobForPdf(logoUrl: string): Promise<Blob | null> {
  return loadLogoPngBlobForPdf(logoUrl);
}

const formatMoney = (value: number) => `S/ ${Number(value ?? 0).toFixed(2)}`;

type TaxSettlementPdfDocumentProps = {
  settlement: TaxSettlement;
  firm: FirmConfig | null;
  logoPng: Blob | null;
};

export function TaxSettlementPdfDocument({ settlement, firm, logoPng }: TaxSettlementPdfDocumentProps) {
  const firmName = firm?.name?.trim() || 'Estudio contable';
  const firmRuc = firm?.ruc?.trim() || '';
  const firmAddr = firm?.address?.trim() || '';
  const totals = settlementTotalsForPdf(settlement);
  const client = settlement.company;
  const docTitle = `Liquidación ${settlement.number?.trim() || `#${settlement.id}`}`;
  const issueStr = (settlement.issue_date ?? '').slice(0, 10) || '—';
  const sortedLines = [...(settlement.lines ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0));

  const styles = StyleSheet.create({
    page: { paddingTop: 28, paddingBottom: 36, paddingHorizontal: 28, fontSize: 9, color: '#0f172a' },
    header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '70%' },
    logo: { width: 44, height: 44, objectFit: 'contain' },
    firmName: { fontSize: 12, fontWeight: 700 },
    firmMeta: { fontSize: 8, color: '#475569', marginTop: 2 },
    docTitle: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
    docMeta: { fontSize: 9, color: '#475569', marginBottom: 12 },
    draftBanner: {
      backgroundColor: '#fff7ed',
      borderWidth: 1,
      borderColor: '#fed7aa',
      borderRadius: 6,
      padding: 8,
      marginBottom: 12,
    },
    draftBannerText: { fontSize: 8, color: '#9a3412', fontWeight: 700 },
    block: { marginBottom: 12 },
    blockTitle: { fontSize: 9, fontWeight: 700, color: '#334155', marginBottom: 4 },
    clientLine: { fontSize: 9, color: '#0f172a', marginBottom: 2 },
    table: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, overflow: 'hidden' },
    rowHead: { flexDirection: 'row', backgroundColor: '#f8fafc', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
    row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    cell: { paddingVertical: 7, paddingHorizontal: 8 },
    colTipo: { width: '14%' },
    colPeriodo: { width: '14%' },
    colConcepto: { width: '42%' },
    colMonto: { width: '30%', textAlign: 'right' },
    headText: { fontSize: 8, fontWeight: 700, color: '#475569' },
    rowText: { fontSize: 8, color: '#0f172a' },
    totalsBox: { marginTop: 12, alignSelf: 'flex-end', width: '48%', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 10 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    totalLabel: { fontSize: 8, color: '#64748b' },
    totalValue: { fontSize: 9, fontWeight: 700 },
    totalGrand: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
    notes: { marginTop: 10, padding: 8, backgroundColor: '#f8fafc', borderRadius: 6 },
    notesText: { fontSize: 8, color: '#334155' },
    pdtBlock: { marginTop: 10 },
    pdtText: { fontSize: 7, color: '#475569' },
    footer: { position: 'absolute', bottom: 14, left: 28, right: 28, fontSize: 8, color: '#94a3b8' },
  });

  const pdtSnippet = (settlement.pdt621_json ?? '').trim();
  const pdtShort = pdtSnippet.length > 1200 ? `${pdtSnippet.slice(0, 1200)}…` : pdtSnippet;

  return (
    <Document title={docTitle}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logoPng ? <Image style={styles.logo} src={logoPng} /> : null}
            <View>
              <Text style={styles.firmName}>{firmName}</Text>
              {firmRuc ? <Text style={styles.firmMeta}>RUC {firmRuc}</Text> : null}
              {firmAddr ? <Text style={styles.firmMeta}>{firmAddr}</Text> : null}
            </View>
          </View>
        </View>

        <Text style={styles.docTitle}>Liquidación de impuestos y honorarios</Text>
        <Text style={styles.docMeta}>
          {docTitle} · Emisión {issueStr}
          {settlement.period_label ? ` · Periodo ${settlement.period_label}` : ''}
        </Text>

        {!totals.emitted ? (
          <View style={styles.draftBanner}>
            <Text style={styles.draftBannerText}>BORRADOR — Los totales se calculan desde las líneas; emita la liquidación para fijar el documento final.</Text>
          </View>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Cliente</Text>
          <Text style={styles.clientLine}>{client?.business_name ?? '—'}</Text>
          {client?.ruc ? <Text style={styles.clientLine}>RUC {client.ruc}</Text> : null}
          {client?.address ? <Text style={styles.clientLine}>{client.address}</Text> : null}
        </View>

        <View style={styles.table}>
          <View style={styles.rowHead}>
            <View style={[styles.cell, styles.colTipo]}>
              <Text style={styles.headText}>Tipo</Text>
            </View>
            <View style={[styles.cell, styles.colPeriodo]}>
              <Text style={styles.headText}>Periodo</Text>
            </View>
            <View style={[styles.cell, styles.colConcepto]}>
              <Text style={styles.headText}>Concepto</Text>
            </View>
            <View style={[styles.cell, styles.colMonto]}>
              <Text style={styles.headText}>Monto</Text>
            </View>
          </View>
          {sortedLines.length > 0 ? (
            sortedLines.map((ln, idx) => (
              <View key={ln.id ?? idx} style={styles.row} wrap={false}>
                <View style={[styles.cell, styles.colTipo]}>
                  <Text style={styles.rowText}>{lineTypeLabelForPdf(ln.line_type)}</Text>
                </View>
                <View style={[styles.cell, styles.colPeriodo]}>
                  <Text style={styles.rowText}>
                    {(ln.period_ym && /^\d{4}-\d{2}$/.test(ln.period_ym)
                      ? ln.period_ym
                      : ln.period_date && ln.period_date.length >= 10
                        ? ln.period_date.slice(0, 10)
                        : settlement.liquidation_period) || '—'}
                  </Text>
                </View>
                <View style={[styles.cell, styles.colConcepto]}>
                  <Text style={styles.rowText}>{ln.concept}</Text>
                </View>
                <View style={[styles.cell, styles.colMonto]}>
                  <Text style={styles.rowText}>{formatMoney(ln.amount)}</Text>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.row}>
              <View style={[styles.cell, { width: '100%' }]}>
                <Text style={styles.rowText}>Sin líneas.</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.totalsBox}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Honorarios y cargos</Text>
            <Text style={styles.totalValue}>{formatMoney(totals.honorarios)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Fiscal / PDT</Text>
            <Text style={styles.totalValue}>{formatMoney(totals.impuestos)}</Text>
          </View>
          <View style={styles.totalGrand}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(totals.total)}</Text>
          </View>
        </View>

        {settlement.notes?.trim() ? (
          <View style={styles.notes}>
            <Text style={styles.blockTitle}>Notas</Text>
            <Text style={styles.notesText}>{settlement.notes.trim()}</Text>
          </View>
        ) : null}

        {pdtShort ? (
          <View style={styles.pdtBlock}>
            <Text style={styles.blockTitle}>Referencia fiscal (JSON)</Text>
            <Text style={styles.pdtText}>{pdtShort}</Text>
          </View>
        ) : null}

        <Text
          style={styles.footer}
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
): Promise<Blob> {
  const el = <TaxSettlementPdfDocument settlement={settlement} firm={firm} logoPng={logoPng} />;
  return pdf(el).toBlob();
}

export function taxSettlementPdfFilename(settlement: TaxSettlement): string {
  const n = (settlement.number ?? '').replace(/[^\w.-]+/g, '_').replace(/^_|_$/g, '');
  return n ? `Liquidacion-${n}.pdf` : `Liquidacion-id-${settlement.id}.pdf`;
}
