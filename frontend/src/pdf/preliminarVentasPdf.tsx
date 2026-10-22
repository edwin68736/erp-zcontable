import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
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
const PILL_GREEN = '#0E8F47';

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "2026-08" → "AGOSTO 2026" (en mayúsculas, como lo pide el estudio para el preliminar). */
function periodLabel(periodYm: string): string {
  const [y, m] = periodYm.split('-').map(Number);
  const name = MONTH_NAMES[(m ?? 0) - 1];
  return name && y ? `${name.toUpperCase()} ${y}` : periodYm;
}
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

/** "2026-09-15" → "15/09/2026" ('' si no es una fecha YYYY-MM-DD). */
function formatIsoDate(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Sin guionado automático (react-pdf parte palabras con "-" por defecto; la plantilla no). */
const noHyphen = (word: string) => [word];

/** "Facturas Emitidas (18%)" → "Facturas emitidas (18%)" (capitalización de la plantilla). */
function conceptLabel(label: string): string {
  return label.replace('Emitidas', 'emitidas').replace('Notas de Crédito', 'Notas de crédito');
}

const s = StyleSheet.create({
  page: { paddingTop: 18, paddingBottom: 34, paddingHorizontal: 26, fontSize: 8, color: V2.text },

  /* Encabezado */
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  headerLeft: { width: '54%', paddingRight: 14 },
  logo: { width: 132, height: 34, objectFit: 'contain', marginBottom: 4 },
  firmName: { fontSize: 15, fontWeight: 700, color: V2.green, marginBottom: 3 },
  tagline: { fontSize: 7.3, color: V2.muted, marginBottom: 8 },
  contactRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3.5 },
  contactText: { fontSize: 6.9, color: V2.muted, lineHeight: 1.35, flex: 1 },
  headerRight: { width: '46%', alignItems: 'flex-end' },
  /* Píldora verde que sangra hasta el borde derecho de la hoja (paddingHorizontal de página = 26). */
  titlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginRight: -26,
    marginTop: -2,
    marginBottom: 9,
    paddingVertical: 9,
    paddingLeft: 12,
    paddingRight: 26,
    backgroundColor: PILL_GREEN,
    borderTopLeftRadius: 30,
    borderBottomLeftRadius: 30,
  },
  titleCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: V2.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleDivider: { width: 1, height: 34, backgroundColor: '#FFFFFF', opacity: 0.45, marginHorizontal: 11 },
  titleText: { fontSize: 19, fontWeight: 700, color: V2.white, lineHeight: 1.1 },
  docBox: { flexDirection: 'row', borderWidth: 1, borderColor: GREEN_BORDER, borderRadius: 4, backgroundColor: V2.greenSoft },
  docBoxCell: { paddingVertical: 6, paddingHorizontal: 11 },
  docBoxDivider: { borderLeftWidth: 1, borderLeftColor: GREEN_BORDER },
  docBoxLabel: { fontSize: 6.2, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  docBoxValue: { fontSize: 9.2, fontWeight: 700, color: V2.navy, marginTop: 2 },

  /* Datos del cliente */
  infoStrip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: GREEN_BORDER,
    borderRadius: 5,
    backgroundColor: V2.greenSoft,
    paddingVertical: 8,
    marginBottom: 7,
  },
  infoCol: { flex: 1, paddingHorizontal: 10 },
  infoColDivider: { borderLeftWidth: 1, borderLeftColor: GREEN_BORDER },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  infoRowSpacing: { marginBottom: 8 },
  infoLabel: { fontSize: 6.2, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  infoValue: { fontSize: 8.5, fontWeight: 700, color: V2.text, marginTop: 1.5 },

  /* Saludo */
  intro: {
    borderLeftWidth: 3,
    borderLeftColor: V2.blue,
    backgroundColor: V2.greenSoft,
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
  splitLeft: { width: '73%', paddingRight: 12 },
  splitRight: { width: '27%' },

  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  stepText: { fontSize: 9, fontWeight: 700, color: V2.navy, textTransform: 'uppercase', letterSpacing: 0.3 },

  /* Tablas */
  table: { borderWidth: 1, borderColor: GREEN_BORDER, borderRadius: 4, overflow: 'hidden' },
  tHead: { flexDirection: 'row', backgroundColor: V2.greenSoft, borderBottomWidth: 1, borderBottomColor: GREEN_BORDER },
  tHeadCell: { paddingVertical: 3.5, paddingHorizontal: 5 },
  tHeadText: { fontSize: 6.1, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.1 },
  tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: V2.rule },
  tRowLast: { borderBottomWidth: 0 },
  tCell: { paddingVertical: 2.2, paddingHorizontal: 5 },
  tCellDivider: { borderLeftWidth: 0.5, borderLeftColor: V2.rule },
  tText: { fontSize: 7.6, color: V2.text },
  tNum: { fontSize: 7.6, color: V2.text, textAlign: 'right' },
  tRowTotal: { backgroundColor: V2.greenSoft },
  tTextTotal: { fontSize: 7.9, fontWeight: 700, color: V2.navy, textTransform: 'uppercase' },
  tNumTotal: { fontSize: 7.9, fontWeight: 700, color: V2.navy, textAlign: 'right' },
  tRowYellow: { backgroundColor: YELLOW_SOFT },
  /* Compras: sección de totales, con más peso que el resto de tablas */
  comprasTable: { borderWidth: 1.5, borderColor: V2.green, borderRadius: 4, overflow: "hidden" },
  comprasCell: { paddingVertical: 5, paddingHorizontal: 6 },
  comprasText: { fontSize: 9, fontWeight: 700, color: V2.navy },
  comprasNum: { fontSize: 10.5, fontWeight: 700, color: V2.navy, textAlign: "right" },

  /* Resumen bajo la tabla de ventas */
  sumWrap: { marginLeft: '36%', marginTop: 5 },
  sumRow: { flexDirection: 'row', alignItems: 'center' },
  sumLabel: { flex: 1, fontSize: 7.6, color: V2.text, textAlign: 'right', paddingRight: 10, paddingVertical: 2.2 },
  sumValueCell: {
    width: '31.25%',
    paddingVertical: 2.2,
    paddingHorizontal: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: V2.rule,
  },
  sumValue: { fontSize: 7.6, color: V2.text, textAlign: 'right' },
  sumRowHighlight: { backgroundColor: V2.greenSoft, borderRadius: 3, marginTop: 4 },
  sumLabelGreen: { flex: 1, fontSize: 8.2, fontWeight: 700, color: V2.greenDark, textAlign: 'right', paddingRight: 10, paddingVertical: 4.5 },
  sumValueGreen: { fontSize: 9.6, fontWeight: 700, color: V2.greenDark, textAlign: 'right' },


  /* Tarjetas laterales */
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V2.greenSoft,
    borderWidth: 1,
    borderColor: GREEN_BORDER,
    borderRadius: 5,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 5,
  },
  cardLabel: { fontSize: 6.4, fontWeight: 700, color: V2.greenDark, textTransform: 'uppercase', letterSpacing: 0.2 },
  cardAmount: { fontSize: 12.5, fontWeight: 700, color: V2.greenDark, marginTop: 2 },
  cardNote: { fontSize: 6.2, color: V2.muted, marginTop: 1 },
  infoCard: {
    borderWidth: 1,
    borderColor: GREEN_BORDER,
    borderRadius: 5,
    backgroundColor: V2.white,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  infoCardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  infoCardTitle: { flex: 1, fontSize: 7.6, fontWeight: 700, color: V2.navy, lineHeight: 1.25 },
  infoCardText: { fontSize: 7.3, color: V2.muted, lineHeight: 1.35 },
  infoCardDate: { fontWeight: 700, color: V2.navy },

  /* Aviso importante */
  important: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: V2.green,
    borderRadius: 5,
    backgroundColor: V2.white,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  importantText: { flex: 1, fontSize: 8.2, color: V2.text, lineHeight: 1.4, fontStyle: 'italic' },
  importantStrong: { fontWeight: 700, color: V2.navy },
  importantItalic: { fontStyle: 'italic' },

  divider: { borderTopWidth: 1, borderTopColor: V2.navy, borderStyle: 'dashed', marginBottom: 6 },

  /* Recomendaciones */
  recoHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  recoTitle: { fontSize: 10, fontWeight: 700, color: V2.blue, textTransform: 'uppercase', letterSpacing: 0.3 },
  recoBox: {
    borderWidth: 1,
    borderColor: V2.green,
    borderRadius: 5,
    backgroundColor: V2.white,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  recoItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  recoItemLast: { marginBottom: 0 },
  recoText: { flex: 1, fontSize: 7.8, color: V2.text, lineHeight: 1.3 },
  recoNumber: { fontWeight: 700, color: V2.navy },

  /* Pie */
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 26,
    right: 26,
    borderTopWidth: 1,
    borderTopColor: GREEN_BORDER,
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
const VENTAS_COLS = ['30%', '19%', '15%', '16%', '20%'];
const COMPRAS_COLS = ['49%', '17%', '17%', '17%'];
/* Encabezado un poco más chico en Compras: con la columna de concepto más ancha (para que el
 * texto de la fila entre en una línea), "BASE IMPONIBLE" a tamaño normal se partía en dos. */
const COMPRAS_HEAD_TEXT = { fontSize: 6, letterSpacing: 0 };

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

/** "MYPE 1 %", "RER 1.5 %", "Régimen General 1.5 %" o "Coeficiente 1.8 %" — el régimen con el que se calculó la renta. */
function rentaRegimenNote(regimen: string | undefined, ratePct: number): string {
  const rate = `${Number(ratePct.toFixed(4))} %`;
  switch ((regimen ?? '').toLowerCase()) {
    case 'rer':
      return `RER ${rate}`;
    case 'general':
      return `Régimen General ${rate}`;
    case 'coeficiente':
      return `Coeficiente ${rate}`;
    default:
      return `MYPE ${rate}`;
  }
}

function Card({ label, value, icon, note }: { label: string; value: string; icon: PdfIconName; note?: string }) {
  return (
    <View style={s.card}>
      <View style={{ marginRight: 7 }}>
        <IconBadge name={icon} size={22} bg={V2.green} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardLabel}>{label}</Text>
        <Text style={s.cardAmount}>{value}</Text>
        {note ? <Text style={s.cardNote}>{note}</Text> : null}
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
  // Fecha de corte de la entrega: las ventas del PDF son las acumuladas hasta ese día (el estudio
  // envía 2 preliminares al mes, con cortes distintos). Sin corte definido se cae a la fecha de hoy.
  const cutoffText = formatIsoDate(record.cutoff_date) || today;
  const igvAPagar = summary.igv_a_pagar;
  // La sección "2. Compras" y el aviso IMPORTANTE salen siempre, con sus valores normales (0.00 si no hay
  // I.G.V. por pagar): el documento mantiene la misma estructura en todos los casos.
  // I.G.V. que quedaría por pagar si la empresa trae las compras indicadas (I.G.V. a pagar menos el
  // I.G.V. de las compras). Con saldo a favor no hay nada que pagar: 0.
  const igvAproximado = igvAPagar > 0 ? Number(summary.monto_aproximado_igv ?? 0) : 0;
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
            <View style={s.titlePill}>
              <View style={s.titleCircle}>
                <PdfIcon name="fileLines" size={17} color={PILL_GREEN} />
              </View>
              <View style={s.titleDivider} />
              <Text style={s.titleText}>{'PRELIMINAR\nDE VENTAS'}</Text>
            </View>
            <View style={s.docBox}>
              <View style={s.docBoxCell}>
                <Text style={s.docBoxLabel}>RUC</Text>
                <Text style={s.docBoxValue}>{firmRuc || '—'}</Text>
              </View>
              <View style={[s.docBoxCell, s.docBoxDivider]}>
                <Text style={s.docBoxLabel}>Preliminar N°</Text>
                <Text style={s.docBoxValue}>{detail.document_number}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Datos del cliente */}
        <View style={s.infoStrip}>
          <View style={s.infoCol}>
            <View style={s.infoRowSpacing}>
              <InfoField label="Cliente" value={detail.business_name.toUpperCase()} icon="users" bg={V2.green} />
            </View>
            <InfoField label="RUC" value={detail.ruc} icon="addressCard" bg={V2.green} />
          </View>
          <View style={[s.infoCol, s.infoColDivider]}>
            <View style={s.infoRowSpacing}>
              <InfoField label="Periodo" value={periodLabel(detail.period_ym)} icon="calendarDays" bg={V2.green} />
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
                {/* Resultado negativo = la empresa tiene I.G.V. a favor (crédito fiscal): no hay nada que pagar. */}
                <Text style={s.sumLabelGreen}>{igvAPagar < 0 ? 'I.G.V. A FAVOR' : 'I.G.V. A PAGAR'}</Text>
                <View style={[s.sumValueCell, { borderBottomWidth: 0 }]}>
                  <Text style={s.sumValueGreen}>S/ {fmtMoney(Math.abs(igvAPagar))}</Text>
                </View>
              </View>
            </View>

          </View>

          <View style={s.splitRight}>
            <Card label="I.G.V. aproximado" value={`S/ ${fmtMoney(igvAproximado)}`} icon="clipboardList" />
            <Card
              label="Renta aproximada"
              value={`S/ ${fmtMoney(summary.monto_aproximado_renta)}`}
              icon="chartColumn"
              note={rentaRegimenNote(record.renta_regimen, summary.renta_rate_pct)}
            />
            <Card label="Preliminar al" value={cutoffText} icon="calendarDays" />
            <View style={s.infoCard}>
              <View style={s.infoCardHead}>
                <View style={{ marginRight: 6 }}>
                  <PdfIcon name="circleInfo" size={12} color={V2.navy} />
                </View>
                <Text style={s.infoCardTitle} hyphenationCallback={noHyphen}>
                  ¿Qué es el Preliminar de Ventas?
                </Text>
              </View>
              <Text style={s.infoCardText} hyphenationCallback={noHyphen}>
                Es un resumen de todas las ventas que realizó durante el mes a la fecha{' '}
                <Text style={s.infoCardDate}>{cutoffText}</Text>, se le envía días antes de cerrar el mes para poder
                prever el pago de impuestos antes del cierre de mes.
              </Text>
            </View>
          </View>
        </View>

        <View wrap={false} style={{ marginBottom: 7 }}>
          <StepTitle title="2. Compras" icon="chartColumn" />
          <View style={s.comprasTable}>
            <TableHead
              headers={['Concepto', 'Base imponible', 'I.G.V.', 'Total']}
              widths={COMPRAS_COLS}
              textStyle={COMPRAS_HEAD_TEXT}
            />
            <View style={[s.tRow, s.tRowLast, s.tRowYellow]}>
              <View style={[s.comprasCell, { width: COMPRAS_COLS[0] }]}>
                <Text style={s.comprasText}>Importe aproximado a traer en facturas de compra</Text>
              </View>
              {[summary.compras_base, summary.compras_igv, summary.compras_total].map((v, i) => (
                <View key={i} style={[s.comprasCell, s.tCellDivider, { width: COMPRAS_COLS[i + 1], justifyContent: 'center' }]}>
                  <Text style={s.comprasNum}>{fmtMoney(Math.round(Number(v ?? 0)))}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

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
  return `PV-${detail.period_ym}-ENTREGA${detail.slot_index}-${business || detail.company_id}.pdf`;
}
