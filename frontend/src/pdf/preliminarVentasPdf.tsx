import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { FirmConfig } from '../types/dashboard';
import type { PreliminarVentasSlotDetail } from '../services/preliminarVentas';
import { PdfIcon, type PdfIconName } from './pdfIcons';
import { IconBadge, V2, fetchFallbackLogoBlob } from './taxSettlementDocumentV2';

/**
 * PDF "Preliminar de Ventas" — misma línea visual que la Liquidación v2 (paleta, íconos, logo de
 * marca), pero documento independiente: no se genera a partir de una liquidación ni comparte su
 * cálculo. Diseño calcado de la referencia del estudio (2026-10-02).
 */

const YELLOW_SOFT = '#FEF3C7';
const GREEN_BORDER = '#C9EBD9';

function fmtMoney(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Celda de tabla: guion cuando el monto es cero, igual que la plantilla. */
function fmtCell(n: number | undefined | null): string {
  return Math.round(Number(n ?? 0) * 100) === 0 ? '-' : fmtMoney(n);
}

function todayForPdf(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Sin guionado automático (react-pdf parte palabras con "-" por defecto; la plantilla no). */
const noHyphen = (word: string) => [word];

/** "Facturas Emitidas (18%)" → "Facturas emitidas (18%)" (capitalización de la plantilla). */
function conceptLabel(label: string): string {
  return label.replace('Emitidas', 'emitidas').replace('Notas de Crédito', 'Notas de crédito');
}

const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 40, paddingHorizontal: 26, fontSize: 8, color: V2.text },

  /* Encabezado */
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  headerLeft: { width: '54%', paddingRight: 14 },
  logo: { width: 132, height: 34, objectFit: 'contain', marginBottom: 4 },
  firmName: { fontSize: 15, fontWeight: 700, color: V2.green, marginBottom: 3 },
  tagline: { fontSize: 7.3, color: V2.muted, marginBottom: 8 },
  contactRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3.5 },
  contactText: { fontSize: 6.9, color: V2.muted, lineHeight: 1.35, flex: 1 },
  headerRight: { width: '46%', alignItems: 'flex-end' },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 11 },
  titleText: { fontSize: 20, fontWeight: 700, color: V2.navy, lineHeight: 1.08 },
  docBox: { flexDirection: 'row', borderWidth: 1, borderColor: V2.border, borderRadius: 4, backgroundColor: V2.bg },
  docBoxCell: { paddingVertical: 6, paddingHorizontal: 11 },
  docBoxDivider: { borderLeftWidth: 1, borderLeftColor: V2.border },
  docBoxLabel: { fontSize: 6.2, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  docBoxValue: { fontSize: 9.2, fontWeight: 700, color: V2.navy, marginTop: 2 },

  /* Datos del cliente */
  infoStrip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: V2.border,
    borderRadius: 5,
    backgroundColor: V2.blueSoft,
    paddingVertical: 8,
    marginBottom: 7,
  },
  infoCol: { flex: 1, paddingHorizontal: 10 },
  infoColDivider: { borderLeftWidth: 1, borderLeftColor: V2.border },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  infoRowSpacing: { marginBottom: 8 },
  infoLabel: { fontSize: 6.2, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  infoValue: { fontSize: 8.5, fontWeight: 700, color: V2.text, marginTop: 1.5 },

  /* Saludo */
  intro: {
    borderLeftWidth: 3,
    borderLeftColor: V2.blue,
    backgroundColor: V2.bg,
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 7,
  },
  introText: { fontSize: 7.9, color: V2.text, lineHeight: 1.4 },
  introEmphasis: { color: V2.blue },

  /* Banda y subtítulo */
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V2.navy,
    borderRadius: 4,
    paddingVertical: 6.5,
    paddingHorizontal: 10,
    marginBottom: 7,
  },
  bandText: { fontSize: 10.6, fontWeight: 700, color: V2.white, textTransform: 'uppercase', letterSpacing: 0.5 },
  subHeading: { marginBottom: 6 },
  subHeadingText: { fontSize: 10, fontWeight: 700, color: V2.blue, textTransform: 'uppercase', letterSpacing: 0.3 },
  subHeadingRule: { borderBottomWidth: 1, borderBottomColor: V2.rule, marginTop: 4 },

  /* Bloque partido */
  splitRow: { flexDirection: 'row', marginBottom: 7 },
  splitLeft: { width: '65%', paddingRight: 12 },
  splitRight: { width: '35%' },

  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  stepText: { fontSize: 9, fontWeight: 700, color: V2.navy, textTransform: 'uppercase', letterSpacing: 0.3 },

  /* Tablas */
  table: { borderWidth: 1, borderColor: V2.border, borderRadius: 4, overflow: 'hidden' },
  tHead: { flexDirection: 'row', backgroundColor: V2.blueSoft, borderBottomWidth: 1, borderBottomColor: V2.border },
  tHeadCell: { paddingVertical: 4.5, paddingHorizontal: 5 },
  tHeadText: { fontSize: 6.1, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.1 },
  tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: V2.rule },
  tRowLast: { borderBottomWidth: 0 },
  tCell: { paddingVertical: 4.2, paddingHorizontal: 5 },
  tCellDivider: { borderLeftWidth: 0.5, borderLeftColor: V2.rule },
  tText: { fontSize: 7.6, color: V2.text },
  tNum: { fontSize: 7.6, color: V2.text, textAlign: 'right' },
  tRowTotal: { backgroundColor: V2.blueSoft },
  tTextTotal: { fontSize: 7.9, fontWeight: 700, color: V2.navy, textTransform: 'uppercase' },
  tNumTotal: { fontSize: 7.9, fontWeight: 700, color: V2.navy, textAlign: 'right' },
  tRowYellow: { backgroundColor: YELLOW_SOFT },

  /* Resumen bajo la tabla de ventas */
  sumWrap: { marginLeft: '36%', marginTop: 5 },
  sumRow: { flexDirection: 'row', alignItems: 'center' },
  sumLabel: { flex: 1, fontSize: 7.6, color: V2.text, textAlign: 'right', paddingRight: 10, paddingVertical: 4 },
  sumValueCell: {
    width: '31.25%',
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: V2.rule,
  },
  sumValue: { fontSize: 7.6, color: V2.text, textAlign: 'right' },
  sumRowHighlight: { backgroundColor: V2.greenSoft, borderRadius: 3, marginTop: 4 },
  sumLabelGreen: { flex: 1, fontSize: 8.2, fontWeight: 700, color: V2.greenDark, textAlign: 'right', paddingRight: 10, paddingVertical: 5.5 },
  sumValueGreen: { fontSize: 9.6, fontWeight: 700, color: V2.greenDark, textAlign: 'right' },

  /* Montos aproximados */
  approxBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V2.greenSoft,
    borderRadius: 3,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginTop: 5,
  },
  approxLabel: { flex: 1, fontSize: 7.8, fontWeight: 700, color: V2.greenDark, textTransform: 'uppercase' },
  approxValue: { fontSize: 8.8, fontWeight: 700, color: V2.greenDark, textAlign: 'right' },
  approxValueZero: { fontSize: 8.8, fontWeight: 700, color: V2.navy, textAlign: 'right' },

  /* Tarjetas laterales */
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V2.greenSoft,
    borderWidth: 1,
    borderColor: GREEN_BORDER,
    borderRadius: 5,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  cardLabel: { fontSize: 7.2, fontWeight: 700, color: V2.greenDark, textTransform: 'uppercase', letterSpacing: 0.3 },
  cardAmount: { fontSize: 17, fontWeight: 700, color: V2.greenDark, marginTop: 2 },
  infoCard: {
    borderWidth: 1,
    borderColor: V2.border,
    borderRadius: 5,
    backgroundColor: V2.white,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  infoCardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  infoCardTitle: { fontSize: 8.2, fontWeight: 700, color: V2.navy },
  infoCardText: { fontSize: 7.3, color: V2.muted, lineHeight: 1.45 },

  /* Aviso importante */
  important: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: V2.border,
    borderRadius: 5,
    backgroundColor: V2.bg,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  importantText: { flex: 1, fontSize: 8.2, color: V2.text, lineHeight: 1.5 },
  importantStrong: { fontWeight: 700, color: V2.navy },
  importantItalic: { fontStyle: 'italic' },

  divider: { borderTopWidth: 1, borderTopColor: V2.navy, borderStyle: 'dashed', marginBottom: 9 },

  /* Recomendaciones */
  recoHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  recoTitle: { fontSize: 10, fontWeight: 700, color: V2.blue, textTransform: 'uppercase', letterSpacing: 0.3 },
  recoBox: {
    borderWidth: 1,
    borderColor: V2.border,
    borderRadius: 5,
    backgroundColor: V2.bg,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  recoItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3.5 },
  recoItemLast: { marginBottom: 0 },
  recoText: { flex: 1, fontSize: 7.8, color: V2.text, lineHeight: 1.4 },
  recoNumber: { fontWeight: 700, color: V2.navy },

  /* Pie */
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 26,
    right: 26,
    borderTopWidth: 1,
    borderTopColor: V2.border,
    paddingTop: 6,
  },
  footerText: { fontSize: 6.8, color: V2.muted, textAlign: 'center' },
});

/** Recomendaciones fijas del Preliminar de Ventas (texto tal cual lo maneja el estudio). */
const RECOMMENDATIONS: string[] = [
  'Hacer la entrega de sus documentos como máximo el 5 de cada mes para la declaración de impuestos y envío de su liquidación de impuestos.',
  'Solicitar Facturas por todas las compras realizadas siempre en cuando estén relacionadas al giro de su negocio (no se registrarán gastos personales).',
  'Realizar pagos a través del sistema financiero siempre que las compras superen 500.00 dólares o 2000.00 soles.',
  'Cuando compre materiales, materia prima etc. solicitar guía de remisión remitente muy aparte de factura.',
  'Si compra activos fijos comuníquese con nosotros para su activación y depreciación correspondiente.',
  'Evite enviar documentos, fotos de facturas, boletas etc. a celulares que no pertenezcan al estudio; no nos hacemos responsable de ello.',
];

/* Anchos de columna (relativos a la tabla) calcados de la plantilla. */
const VENTAS_COLS = ['24%', '20%', '18%', '18%', '20%'];
const COMPRAS_COLS = ['56%', '17%', '13.5%', '13.5%'];
/* Encabezado un poco más chico en Compras: con la columna de concepto más ancha (para que el
 * texto de la fila entre en una línea), "BASE IMPONIBLE" a tamaño normal se partía en dos. */
const COMPRAS_HEAD_TEXT = { fontSize: 5.5, letterSpacing: 0 };

function StepTitle({ title, icon }: { title: string; icon: PdfIconName }) {
  return (
    <View style={s.stepRow}>
      <View style={{ marginRight: 6 }}>
        <PdfIcon name={icon} size={10} color={V2.green} />
      </View>
      <Text style={s.stepText}>{title}</Text>
    </View>
  );
}

function TableHead({
  headers,
  widths,
  textStyle = {},
}: {
  headers: string[];
  widths: string[];
  textStyle?: { fontSize?: number; letterSpacing?: number };
}) {
  return (
    <View style={s.tHead}>
      {headers.map((h, i) => (
        <View key={h} style={[s.tHeadCell, { width: widths[i] }]}>
          <Text style={[s.tHeadText, textStyle, i > 0 ? { textAlign: 'right' } : {}]}>{h}</Text>
        </View>
      ))}
    </View>
  );
}

function Card({ label, value, icon }: { label: string; value: string; icon: PdfIconName }) {
  return (
    <View style={s.card}>
      <View style={{ marginRight: 10 }}>
        <IconBadge name={icon} size={28} bg={V2.green} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardLabel}>{label}</Text>
        <Text style={s.cardAmount}>{value}</Text>
      </View>
    </View>
  );
}

function InfoField({ label, value, icon, bg }: { label: string; value: string; icon: PdfIconName; bg: string }) {
  return (
    <View style={s.infoRow}>
      <View style={{ marginRight: 7 }}>
        <IconBadge name={icon} size={19} bg={bg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.sumRow}>
      <Text style={s.sumLabel}>{label}</Text>
      <View style={s.sumValueCell}>
        <Text style={s.sumValue}>{value}</Text>
      </View>
    </View>
  );
}

function ApproxBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.approxBar}>
      <Text style={s.approxLabel}>{label}</Text>
      {children}
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
  const contactLines = (
    [
      { icon: 'locationDot', text: firm?.address?.trim() ?? '' },
      { icon: 'phone', text: firm?.phone?.trim() ?? '' },
      { icon: 'envelope', text: firm?.email?.trim() ?? '' },
    ] as Array<{ icon: PdfIconName; text: string }>
  ).filter((c) => Boolean(c.text));

  const summary = detail.summary;
  const record = detail.record;
  const today = todayForPdf();
  const igvAPagar = summary.igv_a_pagar;
  // Con saldo a favor (I.G.V. A PAGAR <= 0) no corresponde pedir compras: se omite la sección y su
  // aviso, mismo criterio que PreliminarVentasDetailPage.tsx.
  const showCompras = igvAPagar > 0;
  // Retención/percepción no figuran en la plantilla base: se agregan al resumen solo si tienen monto.
  const retencion = Number(record.retencion_monto ?? 0);
  const percepcion = Number(record.percepcion_monto ?? 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Encabezado */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            {logoPng ? <Image style={s.logo} src={logoPng} /> : <Text style={s.firmName}>{firmName}</Text>}
            <Text style={s.tagline}>Comprometidos con el éxito de tu empresa.</Text>
            {contactLines.map((line) => (
              <View key={line.icon} style={s.contactRow}>
                <View style={{ width: 9, marginRight: 5, marginTop: 1, alignItems: 'center' }}>
                  <PdfIcon name={line.icon} size={7} color={V2.navy} />
                </View>
                <Text style={s.contactText} hyphenationCallback={noHyphen}>
                  {line.text}
                </Text>
              </View>
            ))}
          </View>
          <View style={s.headerRight}>
            <View style={s.titleRow}>
              <View style={{ marginRight: 9 }}>
                <IconBadge name="fileLines" size={31} bg={V2.navy} />
              </View>
              <Text style={s.titleText}>{'PRELIMINAR\nDE VENTAS'}</Text>
            </View>
            <View style={s.docBox}>
              <View style={s.docBoxCell}>
                <Text style={s.docBoxLabel}>RUC</Text>
                <Text style={s.docBoxValue}>{firmRuc || '—'}</Text>
              </View>
              <View style={[s.docBoxCell, s.docBoxDivider]}>
                <Text style={s.docBoxLabel}>Documento N°</Text>
                <Text style={s.docBoxValue}>{detail.document_number}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Datos del cliente */}
        <View style={s.infoStrip}>
          <View style={s.infoCol}>
            <View style={s.infoRowSpacing}>
              <InfoField label="Cliente" value={detail.business_name.toUpperCase()} icon="users" bg={V2.blue} />
            </View>
            <InfoField label="RUC" value={detail.ruc} icon="addressCard" bg={V2.green} />
          </View>
          <View style={[s.infoCol, s.infoColDivider]}>
            <View style={s.infoRowSpacing}>
              <InfoField label="Preliminar de ventas al:" value={today} icon="calendarDays" bg={V2.navy} />
            </View>
            <InfoField label="Fecha de emisión" value={today} icon="calendarCheck" bg={V2.green} />
          </View>
        </View>

        <View style={s.intro}>
          <Text style={s.introText} hyphenationCallback={noHyphen}>
            Ante todo saludarlo, la presente es para informarle sobre la liquidación de impuestos{' '}
            <Text style={s.introEmphasis}>PRELIMINAR</Text> de su empresa, la que a continuación detallamos:
          </Text>
        </View>

        <View style={s.band}>
          <View style={{ marginRight: 7 }}>
            <PdfIcon name="fileLines" size={11} color={V2.white} />
          </View>
          <Text style={s.bandText}>Detalle de impuestos</Text>
        </View>

        <View style={s.subHeading}>
          <Text style={s.subHeadingText}>PDT 621 — IGV y Renta mensual</Text>
          <View style={s.subHeadingRule} />
        </View>

        <View wrap={false} style={s.splitRow}>
          <View style={s.splitLeft}>
            <StepTitle title="1. Ventas" icon="cartShopping" />
            <View style={s.table}>
              <TableHead headers={['Concepto', 'Base imponible', 'No gravadas', 'I.G.V.', 'Total']} widths={VENTAS_COLS} />
              {summary.rows.map((row) => (
                <View key={row.label} style={s.tRow}>
                  <View style={[s.tCell, { width: VENTAS_COLS[0] }]}>
                    <Text style={s.tText}>{conceptLabel(row.label)}</Text>
                  </View>
                  {[row.base, row.no_gravadas, row.igv, row.total].map((v, i) => (
                    <View key={i} style={[s.tCell, s.tCellDivider, { width: VENTAS_COLS[i + 1] }]}>
                      <Text style={s.tNum}>{fmtCell(v)}</Text>
                    </View>
                  ))}
                </View>
              ))}
              <View style={[s.tRow, s.tRowLast, s.tRowTotal]}>
                <View style={[s.tCell, { width: VENTAS_COLS[0] }]}>
                  <Text style={s.tTextTotal}>{summary.total_row.label}</Text>
                </View>
                {[summary.total_row.base, summary.total_row.no_gravadas, summary.total_row.igv, summary.total_row.total].map(
                  (v, i) => (
                    <View key={i} style={[s.tCell, s.tCellDivider, { width: VENTAS_COLS[i + 1] }]}>
                      <Text style={s.tNumTotal}>{fmtCell(v)}</Text>
                    </View>
                  ),
                )}
              </View>
            </View>

            <View style={s.sumWrap}>
              <SumRow label="I.G.V. Resultante" value={fmtMoney(summary.igv_resultante)} />
              <SumRow label="(-) Crédito de I.G.V. del periodo anterior" value={fmtMoney(summary.credito_periodo_anterior)} />
              {retencion ? <SumRow label="(-) Retención" value={fmtMoney(retencion)} /> : null}
              {percepcion ? <SumRow label="(-) Percepción" value={fmtMoney(percepcion)} /> : null}
              <View style={[s.sumRow, s.sumRowHighlight]}>
                <Text style={s.sumLabelGreen}>I.G.V. A PAGAR</Text>
                <View style={[s.sumValueCell, { borderBottomWidth: 0 }]}>
                  <Text style={s.sumValueGreen}>S/ {fmtMoney(igvAPagar)}</Text>
                </View>
              </View>
            </View>

            {showCompras ? (
              <View style={{ marginTop: 10 }}>
                <StepTitle title="2. Compras" icon="chartColumn" />
                <View style={s.table}>
                  <TableHead
                    headers={['Concepto', 'Base imponible', 'I.G.V.', 'Total']}
                    widths={COMPRAS_COLS}
                    textStyle={COMPRAS_HEAD_TEXT}
                  />
                  <View style={[s.tRow, s.tRowLast, s.tRowYellow]}>
                    <View style={[s.tCell, { width: COMPRAS_COLS[0] }]}>
                      <Text style={s.tText}>Importe aproximado a traer en facturas de compra</Text>
                    </View>
                    {[record.compras_base, summary.compras_igv, summary.compras_total].map((v, i) => (
                      <View key={i} style={[s.tCell, s.tCellDivider, { width: COMPRAS_COLS[i + 1] }]}>
                        <Text style={s.tNum}>{fmtCell(v)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            ) : null}

            <View style={{ marginTop: 6 }}>
              <ApproxBar label="Monto aproximado a pagar en I.G.V.">
                {summary.monto_aproximado_igv != null ? (
                  <Text style={s.approxValue}>S/ {fmtMoney(summary.monto_aproximado_igv)}</Text>
                ) : (
                  <Text style={s.approxValueZero}>0</Text>
                )}
              </ApproxBar>
              <ApproxBar label="Monto aproximado a pagar en Renta">
                <Text style={s.approxValue}>S/ {fmtMoney(summary.monto_aproximado_renta)}</Text>
              </ApproxBar>
            </View>
          </View>

          <View style={s.splitRight}>
            <Card label="I.G.V. a pagar" value={`S/ ${fmtMoney(igvAPagar)}`} icon="clipboardList" />
            <Card label="Renta aproximada" value={`S/ ${fmtMoney(summary.monto_aproximado_renta)}`} icon="chartColumn" />
            <Card label="Preliminar al" value={today} icon="calendarDays" />
            <View style={s.infoCard}>
              <View style={s.infoCardHead}>
                <View style={{ marginRight: 6 }}>
                  <PdfIcon name="circleInfo" size={12} color={V2.navy} />
                </View>
                <Text style={s.infoCardTitle}>¿Qué es el PDT 621?</Text>
              </View>
              <Text style={s.infoCardText} hyphenationCallback={noHyphen}>
                Declaración mensual del IGV y Renta. Incluye información de ventas, compras y determina los impuestos a
                pagar.
              </Text>
            </View>
          </View>
        </View>

        {showCompras ? (
          <View wrap={false} style={s.important}>
            <View style={{ marginRight: 8, marginTop: 1 }}>
              <PdfIcon name="circleInfo" size={14} color={V2.navy} />
            </View>
            <Text style={s.importantText} hyphenationCallback={noHyphen}>
              <Text style={s.importantStrong}>¡IMPORTANTE! </Text>
              El monto de las compras indicado es solo un valor referencial. Se recomienda que{' '}
              <Text style={s.importantItalic}>
                el monto de las compras sea mayor al de las ventas para reducir el pago del I.G.V. En caso de que el
                monto de las compras sea inferior al recomendado, su empresa podría estar sujeta a un mayor pago de
                impuestos.
              </Text>
            </Text>
          </View>
        ) : null}

        <View style={s.divider} />

        <View wrap={false}>
          <View style={s.recoHead}>
            <View style={{ marginRight: 8 }}>
              <IconBadge name="listUl" size={20} bg={V2.navy} />
            </View>
            <Text style={s.recoTitle}>Recomendaciones a tener en cuenta</Text>
          </View>
          <View style={s.recoBox}>
            {RECOMMENDATIONS.map((text, idx) => (
              <View
                key={text.slice(0, 24)}
                style={[s.recoItem, idx === RECOMMENDATIONS.length - 1 ? s.recoItemLast : {}]}
              >
                <View style={{ marginRight: 7, marginTop: 0.5 }}>
                  <PdfIcon name="circleCheck" size={10} color={V2.green} />
                </View>
                <Text style={s.recoText} hyphenationCallback={noHyphen}>
                  <Text style={s.recoNumber}>{idx + 1}. </Text>
                  {text}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) =>
              `${firmName.toUpperCase()}   |   Preliminar de Ventas ${detail.document_number}   |   Página ${pageNumber} de ${totalPages}`
            }
          />
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
  // Encabezado de marca: si el estudio no tiene logo configurado se usa el de public/ (igual que
  // la Liquidación v2).
  const headerLogo = logoPng ?? (await fetchFallbackLogoBlob());
  const el = <PreliminarVentasPdfDocument detail={detail} firm={firm} logoPng={headerLogo} />;
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
