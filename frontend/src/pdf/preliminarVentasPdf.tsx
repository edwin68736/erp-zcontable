import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { FirmConfig } from '../types/dashboard';
import type { PreliminarVentasSlotDetail } from '../services/preliminarVentas';

/**
 * PDF "Preliminar de Ventas" — completamente independiente del de Liquidación
 * (frontend/src/pdf/taxSettlementDocument*.tsx): ni comparte componentes visuales ni se
 * genera a partir de una liquidación. Mismo membrete/numeración que ya usa el estudio para este
 * documento, ver docs de la conversación (imágenes de referencia del usuario, 2026-09-25).
 */

const GREEN = '#047857';
const GREEN_LIGHT = '#059669';
const BORDER = '#1A1A1A';
const TEXT = '#1A1A1A';
const TEXT_MUTED = '#475569';
const YELLOW = '#FEF3C7';
const BLUE = '#1D4ED8';
const BLUE_BG = '#EFF6FF';

function fmtMoney(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  return v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayForPdf(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const s = StyleSheet.create({
  page: { paddingTop: 24, paddingBottom: 36, paddingHorizontal: 28, fontSize: 8, color: TEXT },

  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  headerFirmCol: { flex: 1, minWidth: 0, paddingRight: 14 },
  logo: { width: 118, height: 42, objectFit: 'contain', marginBottom: 4 },
  firmName: { fontSize: 12, fontWeight: 700, color: GREEN, marginBottom: 4 },
  firmContact: { fontSize: 7.5, color: TEXT_MUTED, lineHeight: 1.35, marginTop: 2 },
  headerDocBox: { width: '38%', minWidth: 148, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  headerDocRow: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    alignItems: 'center',
  },
  headerDocRowLast: { borderBottomWidth: 0 },
  headerDocRuc: { fontSize: 9, fontWeight: 700, color: TEXT, textAlign: 'center' },
  headerDocTitleWrap: {
    backgroundColor: GREEN,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerDocTitle: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: 700,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  headerDocNumber: { fontSize: 9, fontWeight: 700, color: TEXT, textAlign: 'center' },

  clientBox: { borderWidth: 1, borderColor: BORDER, marginBottom: 8, overflow: 'hidden' },
  clientRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, minHeight: 18 },
  clientRowLast: { borderBottomWidth: 0 },
  clientLabelCell: { width: '27%', backgroundColor: GREEN, paddingVertical: 3, paddingHorizontal: 8, justifyContent: 'center' },
  clientLabelText: { color: '#FFFFFF', fontSize: 7, fontWeight: 700, textTransform: 'uppercase' },
  clientValueCell: {
    width: '73%',
    backgroundColor: '#FFFFFF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: BORDER,
  },
  clientValueText: { fontSize: 8, color: TEXT, lineHeight: 1.2 },

  introBar: { paddingVertical: 7, paddingHorizontal: 10, marginBottom: 8 },
  introText: { fontSize: 8, color: TEXT, lineHeight: 1.4 },
  introEmphasis: { fontStyle: 'italic', fontWeight: 700 },

  sectionBar: { backgroundColor: GREEN, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 6, marginTop: 4 },
  sectionBarText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 700,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  subSectionBar: { backgroundColor: GREEN_LIGHT, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 6 },
  subSectionBarText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: 700,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  blockTitle: { fontSize: 8.5, fontWeight: 700, color: TEXT, marginBottom: 4, textTransform: 'uppercase' },

  tableHeadRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingBottom: 3, marginBottom: 2 },
  tableRow: { flexDirection: 'row', paddingVertical: 2.5 },
  tableRowTotal: { flexDirection: 'row', paddingVertical: 3, borderTopWidth: 1, borderTopColor: BORDER, marginTop: 1 },
  colConcept: { width: '34%' },
  colNum: { width: '22%', textAlign: 'right' },
  headText: { fontSize: 7, fontWeight: 700, color: TEXT_MUTED, textTransform: 'uppercase' },
  rowText: { fontSize: 7.5, color: TEXT },
  rowTextTotal: { fontSize: 7.5, fontWeight: 700, color: TEXT },
  numText: { fontSize: 7.5, color: TEXT, textAlign: 'right' },
  numTextTotal: { fontSize: 7.5, fontWeight: 700, color: TEXT, textAlign: 'right' },

  summaryRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 2 },
  summaryLabel: { fontSize: 7.5, color: TEXT_MUTED, textAlign: 'right', width: '55%', paddingRight: 6 },
  summaryValue: { fontSize: 7.5, color: TEXT, textAlign: 'right', width: '22%' },
  summaryLabelStrong: { fontSize: 8, fontWeight: 700, color: TEXT, textAlign: 'right', width: '55%', paddingRight: 6 },
  summaryValueStrong: { fontSize: 8, fontWeight: 700, color: TEXT, textAlign: 'right', width: '22%' },

  comprasHintRow: { flexDirection: 'row', backgroundColor: YELLOW, marginBottom: 4 },
  comprasHintLabelCell: { width: '56%', paddingVertical: 5, paddingHorizontal: 6 },
  comprasHintLabelText: { fontSize: 7.5, fontStyle: 'italic', fontWeight: 700, color: TEXT },
  comprasHintValueCell: { width: '44%', paddingVertical: 5, paddingHorizontal: 6, justifyContent: 'center' },

  approxBox: { flexDirection: 'row', marginTop: 4, marginBottom: 4 },
  approxCell: { flex: 1 },
  approxLabel: { fontSize: 7, fontWeight: 700, color: TEXT, textTransform: 'uppercase' },
  approxValue: { fontSize: 7.5, color: TEXT, textAlign: 'right' },

  importantBox: {
    borderWidth: 1,
    borderColor: BLUE,
    backgroundColor: BLUE_BG,
    borderRadius: 2,
    padding: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  importantText: { fontSize: 7.5, fontStyle: 'italic', color: BLUE, lineHeight: 1.4 },

  recoDivider: { borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4, paddingTop: 6, borderStyle: 'dashed' },
  recoTitle: { fontSize: 8, fontWeight: 700, color: TEXT, textTransform: 'uppercase', marginBottom: 4 },
  recoItem: { fontSize: 7, color: TEXT, lineHeight: 1.4, marginBottom: 2.5 },
  recoItemBold: { fontWeight: 700 },
});

/** Recomendaciones fijas del Preliminar de Ventas (texto tal cual lo maneja el estudio). */
const RECOMMENDATIONS: string[] = [
  'Hacer la entrega de sus documentos como máximo el 5 de cada mes para la declaración de impuestos y envío de su liquidación de Impuestos.',
  'Solicitar Facturas por todas las compras realizadas siempre en cuando estén relacionadas al giro de su negocio (no se registrarán gastos personales).',
  'Realizar pagos a través del sistema financiero siempre que las compras superen 500.00 dólares o 2000.00 soles.',
  'Cuando compre materiales, materia prima etc. solicitar guía de remisión remitente muy aparte de factura.',
  'Si compra activos fijos comuníquese con nosotros para su activación y depreciación correspondiente.',
  'Evite enviar documentos, fotos de facturas, boletas etc. a celulares que no pertenezcan al estudio no nos hacemos responsable de ello.',
];

function ClientRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={last ? [s.clientRow, s.clientRowLast] : s.clientRow}>
      <View style={s.clientLabelCell}>
        <Text style={s.clientLabelText}>{label}:</Text>
      </View>
      <View style={s.clientValueCell}>
        <Text style={s.clientValueText}>{value}</Text>
      </View>
    </View>
  );
}

type Props = {
  detail: PreliminarVentasSlotDetail;
  firm: FirmConfig | null;
  logoPng: Blob | null;
};

export function PreliminarVentasPdfDocument({ detail, firm, logoPng }: Props) {
  const firmName = firm?.name?.trim() || 'Estudio contable';
  const firmRuc = firm?.ruc?.trim() || '';
  const firmAddr = firm?.address?.trim() || '';
  const firmPhone = firm?.phone?.trim() || '';
  const summary = detail.summary;
  const ventasRows = summary.rows;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.headerFirmCol}>
            {logoPng ? <Image style={s.logo} src={logoPng} /> : <Text style={s.firmName}>{firmName}</Text>}
            {firmAddr ? <Text style={s.firmContact}>{firmAddr}</Text> : null}
            {firmPhone ? <Text style={s.firmContact}>{firmPhone}</Text> : null}
          </View>
          <View style={s.headerDocBox}>
            {firmRuc ? (
              <View style={s.headerDocRow}>
                <Text style={s.headerDocRuc}>RUC {firmRuc}</Text>
              </View>
            ) : null}
            <View style={s.headerDocTitleWrap}>
              <Text style={s.headerDocTitle}>Preliminar de Ventas</Text>
            </View>
            <View style={[s.headerDocRow, s.headerDocRowLast]}>
              <Text style={s.headerDocNumber}>{detail.document_number}</Text>
            </View>
          </View>
        </View>

        <View style={s.clientBox}>
          <ClientRow label="Cliente" value={detail.business_name.toUpperCase()} />
          <ClientRow label="RUC" value={detail.ruc} />
          <ClientRow label="Preliminar de ventas al" value={todayForPdf()} last />
        </View>

        <View style={s.introBar}>
          <Text style={s.introText}>
            Ante todo saludarlo, la presente es para informarle sobre la liquidación de impuestos{' '}
            <Text style={s.introEmphasis}>PRELIMINAR</Text> de su empresa, la que a continuación detallamos:
          </Text>
        </View>

        <View style={s.sectionBar}>
          <Text style={s.sectionBarText}>Detalle</Text>
        </View>
        <View style={s.subSectionBar}>
          <Text style={s.subSectionBarText}>PDT 621 - IGV y Renta mensual</Text>
        </View>

        <Text style={s.blockTitle}>1.- Ventas</Text>
        <View style={s.tableHeadRow}>
          <Text style={[s.headText, s.colConcept]} />
          <Text style={[s.headText, s.colNum]}>Base imponible</Text>
          <Text style={[s.headText, s.colNum]}>No gravadas</Text>
          <Text style={[s.headText, s.colNum]}>I.G.V</Text>
          <Text style={[s.headText, s.colNum]}>Total</Text>
        </View>
        {ventasRows.map((row) => (
          <View key={row.label} style={s.tableRow}>
            <Text style={[s.rowText, s.colConcept]}>{row.label}</Text>
            <Text style={[s.numText, s.colNum]}>{row.base ? fmtMoney(row.base) : '-'}</Text>
            <Text style={[s.numText, s.colNum]}>{row.no_gravadas ? fmtMoney(row.no_gravadas) : '-'}</Text>
            <Text style={[s.numText, s.colNum]}>{row.igv ? fmtMoney(row.igv) : '-'}</Text>
            <Text style={[s.numText, s.colNum]}>{row.total ? fmtMoney(row.total) : '-'}</Text>
          </View>
        ))}
        <View style={s.tableRowTotal}>
          <Text style={[s.rowTextTotal, s.colConcept]}>{summary.total_row.label}</Text>
          <Text style={[s.numTextTotal, s.colNum]}>{fmtMoney(summary.total_row.base)}</Text>
          <Text style={[s.numTextTotal, s.colNum]}>{fmtMoney(summary.total_row.no_gravadas)}</Text>
          <Text style={[s.numTextTotal, s.colNum]}>{fmtMoney(summary.total_row.igv)}</Text>
          <Text style={[s.numTextTotal, s.colNum]}>{fmtMoney(summary.total_row.total)}</Text>
        </View>

        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>I.G.V Resultante</Text>
          <Text style={s.summaryValue}>{fmtMoney(summary.igv_resultante)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>(-) Crédito de I.G.V. del periodo anterior</Text>
          <Text style={s.summaryValue}>{fmtMoney(summary.credito_periodo_anterior)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>(-) Retención</Text>
          <Text style={s.summaryValue}>{fmtMoney(detail.record.retencion_monto)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>(-) Percepción</Text>
          <Text style={s.summaryValue}>{fmtMoney(detail.record.percepcion_monto)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabelStrong}>I.G.V. A PAGAR</Text>
          <Text style={s.summaryValueStrong}>{fmtMoney(summary.igv_a_pagar)}</Text>
        </View>

        {/* Si el I.G.V. A PAGAR da negativo (saldo a favor), no corresponde mostrar la sección de
            Compras — mismo criterio que PreliminarVentasDetailPage.tsx. */}
        {summary.igv_a_pagar > 0 ? (
          <>
            <Text style={[s.blockTitle, { marginTop: 8 }]}>2.- Compras</Text>
            <View style={s.tableHeadRow}>
              <Text style={[s.headText, s.colConcept]} />
              <Text style={[s.headText, s.colNum]}>Base imponible</Text>
              <Text style={[s.headText, s.colNum]}>I.G.V</Text>
              <Text style={[s.headText, s.colNum]}>Total</Text>
            </View>
            <View style={s.comprasHintRow}>
              <View style={s.comprasHintLabelCell}>
                <Text style={s.comprasHintLabelText}>Importe aproximado a traer en facturas de compra</Text>
              </View>
              <View style={s.comprasHintValueCell}>
                <Text style={s.numText}>{detail.record.compras_base ? fmtMoney(detail.record.compras_base) : ''}</Text>
              </View>
            </View>
          </>
        ) : null}

        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Monto aproximado a pagar en I.G.V.</Text>
          <Text style={s.summaryValue}>
            {summary.monto_aproximado_igv != null ? fmtMoney(summary.monto_aproximado_igv) : ''}
          </Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabelStrong}>Monto aproximado a pagar en Renta</Text>
          <Text style={s.summaryValueStrong}>S/ {fmtMoney(summary.monto_aproximado_renta)}</Text>
        </View>

        {summary.igv_a_pagar > 0 ? (
          <View style={s.importantBox}>
            <Text style={s.importantText}>
              ¡IMPORTANTE! El monto de las compras indicado es solo un valor referencial. Se recomienda que el monto
              de las compras sea mayor al de las ventas para reducir el pago del I.G.V. En caso de que el monto de
              las compras sea inferior al recomendado, su empresa podría estar sujeta a un mayor pago de impuestos.
            </Text>
          </View>
        ) : null}

        <View style={s.recoDivider}>
          <Text style={s.recoTitle}>Recomendaciones a tener en cuenta</Text>
          {RECOMMENDATIONS.map((text, idx) => (
            <Text key={text.slice(0, 24)} style={s.recoItem}>
              <Text style={s.recoItemBold}>{idx + 1}. </Text>
              {text}
            </Text>
          ))}
        </View>
      </Page>
    </Document>
  );
}

export async function generatePreliminarVentasPdfBlob(
  detail: PreliminarVentasSlotDetail,
  firm: FirmConfig | null,
  logoPng: Blob | null,
): Promise<Blob> {
  const el = <PreliminarVentasPdfDocument detail={detail} firm={firm} logoPng={logoPng} />;
  return pdf(el).toBlob();
}

export function preliminarVentasPdfFilename(detail: PreliminarVentasSlotDetail): string {
  const business = (detail.business_name || `EMPRESA-${detail.company_id}`)
    .trim()
    .toUpperCase()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `PRELIMINAR-VENTAS-${detail.period_ym}-ENTREGA${detail.slot_index}-${business || detail.company_id}.pdf`;
}
