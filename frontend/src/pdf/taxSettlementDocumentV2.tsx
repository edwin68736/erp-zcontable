import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import { Fragment, type ReactNode } from 'react';
import type { FirmConfig, TaxSettlement } from '../types/dashboard';
import { formatLiquidationNumberForPdf, periodLabelFromYM } from '../utils/liquidationPeriod';
import { formatRentaRateLabel, getRentaMensualRatePct } from '../utils/companyTaxRegime';
import {
  formatImpuestoPeriodoPdf,
  formatPdt621IgvBalanceAmount,
  formatTaxMoney,
  formatTaxPdfMoney,
  formatTaxPdfRowMoney,
  formatTaxPdfTotalMoney,
  getBolsasPlasticasAppliedDetractionAmount,
  getItanAppliedDetractionAmount,
  getPdt601AppliedDetractionAmount,
  getPdt601DetractableBeforeDetraction,
  getPdt617AppliedDetractionAmount,
  getPdt617GrossBeforeDetraction,
  getPdt621AppliedDetractionAmount,
  getPdt621AppliedDetractionAmountRenta,
  getPdt621DetractionPdfRowLabel,
  getPdt621IgvBalanceLabel,
  getPdt621IgvNetAfterDetraction,
  getPdt621IgvSaldoFavorLabel,
  getPdt621PercepcionesRetencionesFieldLabel,
  getPdt621RentaNetAfterDetraction,
  getPdt710AppliedDetractionAmount,
  isNonZeroTaxAmount,
  isTaxIgvRowVisibleInPdf,
  listPdt601DisplayRows,
  listPdt621IgvDisplayRows,
  parseTaxSectionsJson,
  type TaxSectionBolsasPlasticas,
  type TaxSectionItan,
  type TaxSectionPdt601,
  type TaxSectionPdt617,
  type TaxSectionPdt621,
  type TaxSectionPdt710,
  type TaxSettlementSectionsPayload,
} from '../utils/taxSettlementSections';
import { formatIssueDateForPdf } from './pdfLiquidationTheme';
import { PdfIcon, type PdfIconName } from './pdfIcons';
import { PDF_TAX_RECOMMENDATIONS, PDF_TAX_RECOMMENDATIONS_TITLE } from './pdfTaxRecommendations';
import type { LiquidationPdfAssets } from './pdfLiquidationFooter';
import { settlementTotalsForPdf, taxSettlementPdfFilename } from './taxSettlementDocument';

/**
 * Diseño v2 de la liquidación: misma información que `taxSettlementDocument`,
 * presentación distinta (tarjetas, banda oscura, columna lateral con montos
 * pendientes y notas explicativas). Toda la derivación de datos se reutiliza
 * desde utils/taxSettlementSections para que ambos PDF nunca diverjan.
 */

const V2 = {
  navy: '#0B2E63',
  navyDeep: '#082349',
  blue: '#1D63B5',
  blueSoft: '#EEF4FC',
  green: '#00A94F',
  greenSoft: '#E9F7F0',
  greenDark: '#047A42',
  purple: '#7A3394',
  border: '#DDE5EF',
  rule: '#E8EDF4',
  bg: '#F5F8FC',
  text: '#0F172A',
  muted: '#64748B',
  white: '#FFFFFF',
  amber: '#B45309',
  amberSoft: '#FFF7ED',
};

const s = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 44,
    paddingHorizontal: 26,
    fontSize: 8,
    color: V2.text,
  },

  /* Encabezado */
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  headerLeft: { width: '52%', paddingRight: 14 },
  logo: { width: 132, height: 34, objectFit: 'contain', marginBottom: 3 },
  firmName: { fontSize: 15, fontWeight: 700, color: V2.green, marginBottom: 3 },
  tagline: { fontSize: 7.5, color: V2.muted, marginBottom: 7 },
  contactRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2.5 },
  contactText: { fontSize: 6.8, color: V2.muted, lineHeight: 1.35, flex: 1 },
  headerRight: { width: '48%', alignItems: 'flex-end' },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  titleBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: V2.navy,
    marginRight: 8,
  },
  titleText: { fontSize: 17, fontWeight: 700, color: V2.navy, lineHeight: 1.12 },
  docBox: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: V2.border,
    borderRadius: 4,
    backgroundColor: V2.bg,
    overflow: 'hidden',
  },
  docBoxCell: { paddingVertical: 6, paddingHorizontal: 12 },
  docBoxDivider: { borderLeftWidth: 1, borderLeftColor: V2.border },
  docBoxLabel: { fontSize: 6.2, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  docBoxValue: { fontSize: 9.5, fontWeight: 700, color: V2.navy, marginTop: 2 },

  /* Tarjetas de cliente */
  infoStrip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: V2.border,
    borderRadius: 5,
    backgroundColor: V2.blueSoft,
    paddingVertical: 6,
    marginBottom: 6,
  },
  infoCellDivider: { borderLeftWidth: 1, borderLeftColor: V2.rule },
  infoLabel: { fontSize: 5.8, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  infoValue: { fontSize: 7.6, fontWeight: 700, color: V2.text, marginTop: 1.5, lineHeight: 1.2 },
  /** Columna con 2 filas apiladas (p. ej. Cliente encima de RUC). */
  infoGroupCell: { flex: 1, paddingHorizontal: 9 },
  infoStackRow: { flexDirection: 'row', alignItems: 'center' },
  infoStackRowSpacing: { marginBottom: 5 },

  /* Aviso borrador */
  draft: {
    borderLeftWidth: 3,
    borderLeftColor: V2.amber,
    backgroundColor: V2.amberSoft,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 3,
    marginBottom: 6,
  },
  draftText: { fontSize: 7, fontWeight: 700, color: V2.amber },

  /* Saludo */
  intro: {
    borderLeftWidth: 3,
    borderLeftColor: V2.blue,
    backgroundColor: V2.bg,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 3,
    marginBottom: 7,
  },
  introText: { fontSize: 7.6, color: V2.text, lineHeight: 1.4 },

  /* Banda de sección */
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V2.navy,
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  bandText: { fontSize: 9, fontWeight: 700, color: V2.white, textTransform: 'uppercase', letterSpacing: 0.5 },

  /* Título de bloque fiscal */
  subHeading: { marginBottom: 4 },
  subHeadingText: { fontSize: 9, fontWeight: 700, color: V2.blue, textTransform: 'uppercase', letterSpacing: 0.3 },
  subHeadingRule: { borderBottomWidth: 1, borderBottomColor: V2.rule, marginTop: 3 },

  /* Bloque partido: contenido (título+tabla+resumen) a la izquierda, tarjetas al costado
   * a la derecha. A diferencia de `cardsRow` (que reparte 2 tarjetas cortas), aquí una de las
   * columnas SÍ es de largo variable (tabla), así que el par entero se envuelve con
   * `wrap={false}` en el nivel del bloque (ver `SplitBlock`) para que nunca se corte a mitad
   * de página — o el bloque cabe entero, o salta entero a la siguiente. Como estas tablas son
   * de tamaño acotado (conceptos fijos, no un listado de transacciones), el bloque es siempre
   * corto y ese salto no deja huecos grandes.
   */
  splitRow: { flexDirection: 'row', marginBottom: 10 },
  splitLeft: { width: '63%', paddingRight: 12 },
  splitRight: { width: '37%' },

  /* Título numerado */
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  stepText: { fontSize: 8.4, fontWeight: 700, color: V2.text, textTransform: 'uppercase', letterSpacing: 0.3 },

  /* Tabla */
  table: { borderWidth: 1, borderColor: V2.border, borderRadius: 4, overflow: 'hidden' },
  tHead: { flexDirection: 'row', backgroundColor: V2.bg, borderBottomWidth: 1, borderBottomColor: V2.border },
  tHeadCell: { paddingVertical: 3.5, paddingHorizontal: 5 },
  tHeadText: { fontSize: 5.9, fontWeight: 700, color: V2.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  tRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: V2.rule },
  tRowLast: { borderBottomWidth: 0 },
  tCell: { paddingVertical: 3, paddingHorizontal: 5 },
  tText: { fontSize: 7, color: V2.text },
  tNum: { fontSize: 7, color: V2.text, textAlign: 'right' },
  /** Fila de total dentro de la tabla (última fila, resaltada en verde — p. ej. "Impuesto a pagar"). */
  tRowTotal: { backgroundColor: V2.greenSoft, borderBottomWidth: 0 },
  tTextTotal: { fontSize: 7.4, fontWeight: 700, color: V2.greenDark, textTransform: 'uppercase' },
  tNumTotal: { fontSize: 7.4, fontWeight: 700, color: V2.greenDark, textAlign: 'right' },

  /* Filas resumen */
  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2.5,
    paddingHorizontal: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: V2.rule,
  },
  sumDot: { width: 8, height: 8, borderRadius: 2, backgroundColor: V2.blueSoft, marginRight: 6 },
  sumLabel: { flex: 1, fontSize: 7, color: V2.text },
  sumLabelStrong: { flex: 1, fontSize: 7.4, fontWeight: 700, color: V2.navy, textTransform: 'uppercase' },
  sumValue: { fontSize: 7, color: V2.text, textAlign: 'right' },
  sumValueStrong: { fontSize: 7.8, fontWeight: 700, color: V2.navy, textAlign: 'right' },
  sumRowHighlight: { backgroundColor: V2.greenSoft, borderRadius: 3 },
  sumLabelGreen: { flex: 1, fontSize: 7.4, fontWeight: 700, color: V2.greenDark, textTransform: 'uppercase' },
  sumValueGreen: { fontSize: 7.8, fontWeight: 700, color: V2.greenDark, textAlign: 'right' },

  /* Tarjeta de monto pendiente */
  pendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V2.greenSoft,
    borderWidth: 1,
    borderColor: '#C9EBD9',
    borderRadius: 5,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 5,
  },
  pendLabel: { fontSize: 6.6, fontWeight: 700, color: V2.greenDark, textTransform: 'uppercase', letterSpacing: 0.3 },
  pendAmount: { fontSize: 13, fontWeight: 700, color: V2.greenDark, marginTop: 1 },

  /* Distintivo "IGV Justo": solo aparece cuando la liquidación está acogida. */
  igvJustoTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: V2.blueSoft,
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 7,
    marginBottom: 5,
  },
  igvJustoTagText: { fontSize: 6.4, fontWeight: 700, color: V2.blue, textTransform: 'uppercase', letterSpacing: 0.3 },

  /* Tarjeta explicativa */
  infoCard: {
    borderWidth: 1,
    borderColor: V2.border,
    borderRadius: 5,
    backgroundColor: V2.white,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  infoCardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  infoCardTitle: { fontSize: 7.6, fontWeight: 700, color: V2.navy },
  infoCardText: { fontSize: 6.8, color: V2.muted, lineHeight: 1.45 },

  /* Banda total. La caja blanca va con el margen normal dentro de la banda (sin pegarse al
   * borde); lo que se ajusta es el padding INTERNO de la caja — más angosto a la derecha para
   * que el monto se acerque a su propio borde derecho. */
  totalBand: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V2.navy,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 7,
  },
  totalBandLabel: { flex: 1, fontSize: 9, fontWeight: 700, color: V2.white, textTransform: 'uppercase', letterSpacing: 0.5 },
  totalBandBox: {
    backgroundColor: V2.white,
    borderRadius: 3,
    alignItems: 'flex-end',
    paddingVertical: 5,
    paddingLeft: 9,
    paddingRight: 6,
    minWidth: 66,
  },
  totalBandAmount: { fontSize: 11, fontWeight: 700, color: V2.navy, textAlign: 'right' },

  /* Banda total de honorarios: más chica que `totalBand` — debe verse subordinada al
   * encabezado de la sección ("Honorarios y cargos del estudio"), no al mismo nivel. */
  honorariosTotalBand: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: V2.navy,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginTop: 6,
    marginBottom: 10,
  },
  honorariosTotalBandLabel: {
    flex: 1,
    fontSize: 7.6,
    fontWeight: 700,
    color: V2.white,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  honorariosTotalBandBox: {
    backgroundColor: V2.white,
    borderRadius: 3,
    alignItems: 'flex-end',
    paddingVertical: 2.5,
    paddingLeft: 7,
    paddingRight: 5,
    minWidth: 54,
  },
  honorariosTotalBandAmount: { fontSize: 9, fontWeight: 700, color: V2.navy, textAlign: 'right' },

  /* Pagos */
  payWrap: { flexDirection: 'row', marginTop: 4, marginBottom: 10 },
  payLeft: { width: '58%', paddingRight: 12 },
  payRight: { width: '42%' },
  /** Bloque de pagos sin recuadro: el contenido va suelto sobre la hoja. */
  payCard: {
    paddingVertical: 2,
    paddingRight: 10,
  },
  payHeadRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  bankLogo: { width: 44, height: 20, objectFit: 'contain', marginRight: 8 },
  payLineFirst: { fontSize: 7.4, fontWeight: 700, color: V2.navy, marginBottom: 2 },
  payLine: { fontSize: 6.6, color: V2.muted, lineHeight: 1.4 },
  qrWrap: { alignItems: 'center', justifyContent: 'center' },
  qrImage: { width: 62, height: 62, objectFit: 'contain' },
  qrCaption: {
    marginTop: 4,
    backgroundColor: V2.purple,
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  qrCaptionText: { fontSize: 5.6, fontWeight: 700, color: V2.white, textAlign: 'center' },
  obsRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 7 },
  obsText: { flex: 1, fontSize: 6.6, fontWeight: 700, color: V2.navy, lineHeight: 1.4 },

  /* Recomendaciones */
  recoTitle: {
    fontSize: 8.2,
    fontWeight: 700,
    color: V2.blue,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 5,
  },
  recoItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2.5 },
  recoText: { flex: 1, fontSize: 6.4, color: V2.muted, lineHeight: 1.4 },

  /* Notas */
  notes: {
    borderWidth: 1,
    borderColor: V2.border,
    borderRadius: 5,
    backgroundColor: V2.bg,
    padding: 9,
    marginBottom: 10,
  },
  notesTitle: { fontSize: 7.4, fontWeight: 700, color: V2.navy, textTransform: 'uppercase', marginBottom: 3 },
  notesText: { fontSize: 7, color: V2.text, lineHeight: 1.4 },

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
  footerText: { fontSize: 6.4, color: V2.muted, textAlign: 'center' },
});

/* ---------- Piezas reutilizables ---------- */

/** Círculo de color con un icono centrado (patrón visual del diseño v2). */
function IconBadge({
  name,
  size,
  bg,
  color = V2.white,
}: {
  name: PdfIconName;
  size: number;
  bg: string;
  color?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <PdfIcon name={name} size={size * 0.52} color={color} />
    </View>
  );
}

function Band({
  title,
  icon,
  forcePageBreak = false,
}: {
  title: string;
  icon: PdfIconName;
  /** Fuerza que esta banda (y todo lo que sigue) arranque en una página nueva. */
  forcePageBreak?: boolean;
}) {
  return (
    <View style={s.band} break={forcePageBreak}>
      <View style={{ marginRight: 7 }}>
        <PdfIcon name={icon} size={11} color={V2.white} />
      </View>
      <Text style={s.bandText}>{title}</Text>
    </View>
  );
}

/**
 * `minPresenceAhead` reserva espacio mínimo antes de dibujar el título: si no queda suficiente
 * hueco en la página actual, react-pdf difiere TODO el bloque (título incluido) a la siguiente
 * página, evitando el título huérfano solo al pie de página con su contenido en la otra hoja.
 * A diferencia de `wrap={false}`, esto no obliga a que el resto del bloque quepa entero.
 *
 * 130pt (no 60): el mínimo real de un bloque completo (título + tabla + tarjeta lateral) nunca
 * baja de ~150pt incluso para secciones cortas como ITAN; con 60pt el título igual quedaba
 * huérfano a centímetros del pie de página, con su tabla recién empezando en la hoja siguiente.
 */
function SubHeading({ title, minPresenceAhead = 130 }: { title: string; minPresenceAhead?: number }) {
  return (
    <View minPresenceAhead={minPresenceAhead} style={s.subHeading}>
      <Text style={s.subHeadingText}>{title}</Text>
      <View style={s.subHeadingRule} />
    </View>
  );
}

function StepTitle({
  title,
  icon,
  minPresenceAhead = 110,
}: {
  title: string;
  icon: PdfIconName;
  minPresenceAhead?: number;
}) {
  return (
    <View minPresenceAhead={minPresenceAhead} style={s.stepRow}>
      <View style={{ marginRight: 6 }}>
        <PdfIcon name={icon} size={10} color={V2.green} />
      </View>
      <Text style={s.stepText}>{title}</Text>
    </View>
  );
}

/**
 * Bloque partido: contenido principal (título + tabla + resumen) a la izquierda, tarjetas de
 * monto pendiente y explicación apiladas a la derecha — ver estilo `splitRow`.
 *
 * `wrap={false}` en el nivel del bloque completo: como las tablas de estas secciones son de
 * tamaño acotado (conceptos fiscales fijos, no un listado de transacciones), el bloque nunca es
 * tan alto como para necesitar partirse. O cabe entero en la página actual, o react-pdf lo mueve
 * entero a la siguiente — nunca se corta a mitad de tabla junto a una tarjeta, que es el caso que
 * antes producía texto superpuesto/duplicado cuando se intentó una fila mixta tabla+tarjeta.
 */
function SplitBlock({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <View wrap={false} style={s.splitRow}>
      <View style={s.splitLeft}>{left}</View>
      <View style={s.splitRight}>{right}</View>
    </View>
  );
}

/**
 * `tag`, si se pasa (p. ej. "IGV Justo"), se muestra pegado al costado del monto — no arriba de
 * la tarjeta — para que quede claro que ESE monto pendiente es el que está bajo ese régimen.
 */
function PendingCard({
  label,
  amount,
  icon = 'receipt',
  tag,
}: {
  label: string;
  amount: string;
  icon?: PdfIconName;
  tag?: string;
}) {
  return (
    <View wrap={false} style={s.pendCard}>
      <View style={{ marginRight: 8 }}>
        <IconBadge name={icon} size={24} bg={V2.green} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.pendLabel}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={s.pendAmount}>{amount}</Text>
          {tag ? (
            <View style={[s.igvJustoTag, { marginLeft: 6, marginBottom: 0 }]}>
              <Text style={s.igvJustoTagText}>{tag}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <View wrap={false} style={s.infoCard}>
      <View style={s.infoCardHead}>
        <View style={{ marginRight: 6 }}>
          <PdfIcon name="circleInfo" size={11} color={V2.blue} />
        </View>
        <Text style={s.infoCardTitle}>{title}</Text>
      </View>
      <Text style={s.infoCardText}>{text}</Text>
    </View>
  );
}

type SumTone = 'normal' | 'strong' | 'green';

function SumRow({ label, value, tone = 'normal' }: { label: string; value: string; tone?: SumTone }) {
  const labelStyle = tone === 'green' ? s.sumLabelGreen : tone === 'strong' ? s.sumLabelStrong : s.sumLabel;
  const valueStyle = tone === 'green' ? s.sumValueGreen : tone === 'strong' ? s.sumValueStrong : s.sumValue;
  return (
    <View style={[s.sumRow, tone === 'green' ? s.sumRowHighlight : {}]}>
      {tone === 'normal' ? <View style={s.sumDot} /> : null}
      <Text style={labelStyle}>{label}</Text>
      <Text style={valueStyle}>{value}</Text>
    </View>
  );
}

/**
 * Tabla simple etiqueta/monto (secciones distintas a IGV). `totalRow`, si se pasa, se agrega
 * como última fila resaltada en verde (mismo tratamiento que el total de IGV) — p. ej.
 * "Impuesto a pagar".
 */
function AmountTable({
  rows,
  totalRow,
}: {
  rows: Array<{ label: string; value: string }>;
  totalRow?: { label: string; value: string };
}) {
  if (rows.length === 0 && !totalRow) return null;
  return (
    <View style={s.table}>
      <View wrap={false} style={s.tHead}>
        <View style={[s.tHeadCell, { width: '68%' }]}>
          <Text style={s.tHeadText}>Concepto</Text>
        </View>
        <View style={[s.tHeadCell, { width: '32%' }]}>
          <Text style={[s.tHeadText, { textAlign: 'right' }]}>Impuesto</Text>
        </View>
      </View>
      {rows.map((r, idx) => (
        <View
          key={`${r.label}-${idx}`}
          wrap={false}
          style={[s.tRow, !totalRow && idx === rows.length - 1 ? s.tRowLast : {}]}
        >
          <View style={[s.tCell, { width: '68%' }]}>
            <Text style={s.tText}>{r.label}</Text>
          </View>
          <View style={[s.tCell, { width: '32%' }]}>
            <Text style={s.tNum}>{r.value}</Text>
          </View>
        </View>
      ))}
      {totalRow ? (
        <View wrap={false} style={[s.tRow, s.tRowLast, s.tRowTotal]}>
          <View style={[s.tCell, { width: '68%' }]}>
            <Text style={s.tTextTotal}>{totalRow.label}</Text>
          </View>
          <View style={[s.tCell, { width: '32%' }]}>
            <Text style={s.tNumTotal}>{totalRow.value}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ---------- Encabezado y datos del cliente ---------- */

function HeaderV2({
  firm,
  logoPng,
  liqNumber,
}: {
  firm: FirmConfig | null;
  logoPng: Blob | null;
  liqNumber: string;
}) {
  const firmName = firm?.name?.trim() || 'Estudio contable';
  const firmRuc = firm?.ruc?.trim() || '';
  const contactLines = (
    [
      { icon: 'locationDot', text: firm?.address?.trim() ?? '' },
      { icon: 'phone', text: firm?.phone?.trim() ?? '' },
      { icon: 'envelope', text: firm?.email?.trim() ?? '' },
    ] as Array<{ icon: PdfIconName; text: string }>
  ).filter((c) => Boolean(c.text));

  return (
    <View style={s.header}>
      <View style={s.headerLeft}>
        {logoPng ? <Image style={s.logo} src={logoPng} /> : <Text style={s.firmName}>{firmName}</Text>}
        <Text style={s.tagline}>Comprometidos con el éxito de tu empresa.</Text>
        {contactLines.map((line) => (
          <View key={line.icon} style={s.contactRow}>
            <View style={{ width: 9, marginRight: 5, marginTop: 1, alignItems: 'center' }}>
              <PdfIcon name={line.icon} size={7} color={V2.blue} />
            </View>
            <Text style={s.contactText}>{line.text}</Text>
          </View>
        ))}
      </View>

      <View style={s.headerRight}>
        <View style={s.titleRow}>
          <View style={{ marginRight: 8 }}>
            <IconBadge name="fileInvoice" size={30} bg={V2.navy} />
          </View>
          <Text style={s.titleText}>{'LIQUIDACIÓN\nDE IMPUESTOS'}</Text>
        </View>
        <View style={s.docBox}>
          <View style={s.docBoxCell}>
            <Text style={s.docBoxLabel}>RUC</Text>
            <Text style={s.docBoxValue}>{firmRuc || '—'}</Text>
          </View>
          <View style={[s.docBoxCell, s.docBoxDivider]}>
            <Text style={s.docBoxLabel}>Liquidación N°</Text>
            <Text style={s.docBoxValue}>{liqNumber}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function InfoStrip({
  groups,
}: {
  /** Cada grupo es una columna; sus filas se apilan una debajo de otra dentro de esa columna. */
  groups: Array<Array<{ label: string; value: string; color: string; icon: PdfIconName }>>;
}) {
  return (
    <View style={s.infoStrip}>
      {groups.map((group, idx) => (
        <View key={group.map((it) => it.label).join('+')} style={[s.infoGroupCell, idx > 0 ? s.infoCellDivider : {}]}>
          {group.map((it, i) => (
            <View key={it.label} style={[s.infoStackRow, i < group.length - 1 ? s.infoStackRowSpacing : {}]}>
              <View style={{ marginRight: 6 }}>
                <IconBadge name={it.icon} size={17} bg={it.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.infoLabel}>{it.label}</Text>
                <Text style={s.infoValue}>{it.value}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ---------- Secciones fiscales ---------- */

/* Anchas relativas al contenedor de la tabla, ahora más angosto (columna izquierda del split). */
const COL_C = '34%';
const COL_N = '16.5%';
/* Encabezados algo más compactos que `s.tHeadCell`/`s.tHeadText`: en la columna angosta del
 * split, "Base imponible"/"No gravadas" a tamaño normal se parten en dos líneas. */
const COL_N_HEAD_CELL = { paddingVertical: 3.5, paddingHorizontal: 3 };
const COL_N_HEAD_TEXT = { fontSize: 5.3, letterSpacing: 0 };

function IgvTable({ p621 }: { p621: TaxSectionPdt621 }) {
  const rows = listPdt621IgvDisplayRows(p621, { forPdf: true }).filter(
    ({ row, alwaysShowInPdf }) => alwaysShowInPdf || isTaxIgvRowVisibleInPdf(row),
  );
  return (
    <View style={s.table}>
      <View wrap={false} style={s.tHead}>
        <View style={[s.tHeadCell, { width: COL_C }]}>
          <Text style={s.tHeadText}>Concepto</Text>
        </View>
        {['Base imponible', 'No gravadas', 'Impuesto', 'Total'].map((h) => (
          <View key={h} style={[s.tHeadCell, COL_N_HEAD_CELL, { width: COL_N }]}>
            <Text style={[s.tHeadText, COL_N_HEAD_TEXT, { textAlign: 'right' }]}>{h}</Text>
          </View>
        ))}
      </View>
      {rows.map(({ label, row }, idx) => (
        <View key={label} wrap={false} style={[s.tRow, idx === rows.length - 1 ? s.tRowLast : {}]}>
          <View style={[s.tCell, { width: COL_C }]}>
            <Text style={s.tText}>{label}</Text>
          </View>
          <View style={[s.tCell, { width: COL_N }]}>
            <Text style={s.tNum}>{formatTaxPdfMoney(row.base)}</Text>
          </View>
          <View style={[s.tCell, { width: COL_N }]}>
            <Text style={s.tNum}>{formatTaxPdfMoney(row.no_gravadas ?? 0)}</Text>
          </View>
          <View style={[s.tCell, { width: COL_N }]}>
            <Text style={s.tNum}>{formatTaxPdfMoney(row.impuesto)}</Text>
          </View>
          <View style={[s.tCell, { width: COL_N }]}>
            <Text style={s.tNum}>{formatTaxPdfMoney(row.total)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Pdt621Block({ p621, rentaRatePct }: { p621: TaxSectionPdt621; rentaRatePct: number | null }) {
  const igvSaldoFavor = getPdt621IgvSaldoFavorLabel(p621);
  const igvBalance = getPdt621IgvBalanceLabel(p621);
  const detrLabelIgv = getPdt621DetractionPdfRowLabel(p621.detraction_payment_igv);
  const detrLabelRenta = getPdt621DetractionPdfRowLabel(p621.detraction_payment_renta);
  const rentaRateLabel = rentaRatePct != null ? formatRentaRateLabel(rentaRatePct) : null;

  const igvSummary: Array<{ label: string; value: string; tone: SumTone }> = [
    { label: 'Impuesto del periodo', value: formatImpuestoPeriodoPdf(p621.impuesto_periodo), tone: 'normal' },
    { label: 'Crédito periodo anterior', value: formatTaxPdfMoney(p621.credito_periodo_anterior), tone: 'normal' },
    {
      label: igvSaldoFavor.label,
      value: isNonZeroTaxAmount(igvSaldoFavor.amount) ? formatPdt621IgvBalanceAmount(igvSaldoFavor) : '-',
      tone: 'strong',
    },
    {
      label: getPdt621PercepcionesRetencionesFieldLabel('Percepciones del periodo', p621.saldo_favor),
      value: formatTaxPdfMoney(p621.percepciones_periodo),
      tone: 'normal',
    },
    {
      label: getPdt621PercepcionesRetencionesFieldLabel('Percepciones periodos anteriores', p621.saldo_favor),
      value: formatTaxPdfMoney(p621.percepciones_anteriores),
      tone: 'normal',
    },
    {
      label: getPdt621PercepcionesRetencionesFieldLabel('Retenciones del periodo', p621.saldo_favor),
      value: formatTaxPdfMoney(p621.retenciones_periodo),
      tone: 'normal',
    },
    {
      label: getPdt621PercepcionesRetencionesFieldLabel('Retenciones periodos anteriores', p621.saldo_favor),
      value: formatTaxPdfMoney(p621.retenciones_anteriores),
      tone: 'normal',
    },
  ];

  const rentaRows: Array<{ label: string; value: string }> = [
    ...(isNonZeroTaxAmount(p621.renta_ventas_base)
      ? [{ label: 'Ingresos netos (base)', value: formatTaxPdfRowMoney(p621.renta_ventas_base) }]
      : []),
    {
      label: `Impuesto renta${rentaRateLabel ? ` (${rentaRateLabel})` : ''}`,
      value: formatTaxPdfRowMoney(p621.renta_ventas_impuesto),
    },
    { label: 'Saldo a favor ITAN', value: formatTaxPdfMoney(p621.renta_saldo_favor_itan) },
    ...(detrLabelRenta
      ? [{ label: detrLabelRenta, value: formatTaxPdfMoney(getPdt621AppliedDetractionAmountRenta(p621)) }]
      : []),
  ];
  /* Neto de detracción, igual que la tarjeta "Renta pendiente": el total resaltado en verde es
   * siempre la última fila y ya refleja cualquier ajuste anterior (detracción incluida). */
  const rentaTotalRow = {
    label: 'Impuesto a pagar (renta)',
    value: formatTaxPdfTotalMoney(getPdt621RentaNetAfterDetraction(p621)),
  };

  return (
    <Fragment>
      <SubHeading title="PDT 621 — IGV y Renta" />

      <StepTitle title="1. IGV mensual" icon="cartShopping" />
      <SplitBlock
        left={
          <Fragment>
            <IgvTable p621={p621} />
            <View style={{ marginTop: 4 }}>
              {igvSummary.map((r) => (
                <SumRow key={r.label} label={r.label} value={r.value} tone={r.tone} />
              ))}
              {detrLabelIgv ? (
                <SumRow label={detrLabelIgv} value={formatTaxPdfMoney(getPdt621AppliedDetractionAmount(p621))} />
              ) : null}
              <SumRow
                label={igvBalance.label}
                value={
                  isNonZeroTaxAmount(igvBalance.amount)
                    ? formatPdt621IgvBalanceAmount({ label: igvBalance.label, amount: igvBalance.amount })
                    : '-'
                }
                tone="green"
              />
            </View>
          </Fragment>
        }
        right={
          <Fragment>
            <PendingCard
              label="IGV pendiente"
              amount={formatTaxPdfTotalMoney(getPdt621IgvNetAfterDetraction(p621))}
              icon="receipt"
              tag={p621.igv_justo ? 'IGV Justo' : undefined}
            />
            <InfoCard
              title="¿Qué es el IGV?"
              text="Impuesto General a las Ventas. Se aplica a la venta de bienes y prestación de servicios."
            />
            {p621.igv_justo ? (
              <InfoCard
                title="¿Qué es IGV Justo?"
                text="Régimen que permite a las MYPE postergar el pago del IGV según un cronograma especial, sin intereses ni multas."
              />
            ) : null}
          </Fragment>
        }
      />

      <StepTitle title="2. Renta mensual" icon="chartColumn" />
      <SplitBlock
        left={<AmountTable rows={rentaRows} totalRow={rentaTotalRow} />}
        right={
          <Fragment>
            <PendingCard
              label="Renta pendiente"
              amount={formatTaxPdfTotalMoney(getPdt621RentaNetAfterDetraction(p621))}
              icon="chartColumn"
            />
            <InfoCard
              title="¿Qué es la Renta?"
              text="Impuesto a las utilidades obtenidas por la actividad económica de la empresa."
            />
          </Fragment>
        }
      />
    </Fragment>
  );
}

/** Bloque genérico: título + tabla de conceptos (con total en verde) + tarjeta pendiente + nota. */
function SimpleBlock({
  title,
  rows,
  totalLabel,
  pendingLabel,
  pendingAmount,
  infoTitle,
  infoText,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
  totalLabel: string;
  pendingLabel: string;
  pendingAmount: number;
  infoTitle: string;
  infoText: string;
}) {
  return (
    <Fragment>
      <SubHeading title={title} />
      <SplitBlock
        left={
          <AmountTable
            rows={rows}
            totalRow={{ label: totalLabel, value: formatTaxPdfTotalMoney(pendingAmount) }}
          />
        }
        right={
          <Fragment>
            <PendingCard label={pendingLabel} amount={formatTaxPdfTotalMoney(pendingAmount)} />
            <InfoCard title={infoTitle} text={infoText} />
          </Fragment>
        }
      />
    </Fragment>
  );
}

function buildPdt601Rows(p601: TaxSectionPdt601): Array<{ label: string; value: string }> {
  const rows = listPdt601DisplayRows(p601)
    .filter((item) => isNonZeroTaxAmount(item.value))
    .map((item) => ({ label: item.label, value: formatTaxPdfMoney(item.value) }));
  const detrLabel = getPdt621DetractionPdfRowLabel(p601.detraction_payment);
  if (detrLabel) {
    rows.push({ label: 'Total planilla', value: formatTaxPdfMoney(getPdt601DetractableBeforeDetraction(p601)) });
    rows.push({ label: detrLabel, value: formatTaxPdfMoney(getPdt601AppliedDetractionAmount(p601)) });
  }
  return rows;
}

function buildItanRows(itan: TaxSectionItan): Array<{ label: string; value: string }> {
  const rows = [{ label: `Cuota N° ${itan.cuota_nro}`, value: formatTaxPdfMoney(itan.impuesto) }];
  const detrLabel = getPdt621DetractionPdfRowLabel(itan.detraction_payment);
  if (detrLabel) rows.push({ label: detrLabel, value: formatTaxPdfMoney(getItanAppliedDetractionAmount(itan)) });
  return rows;
}

function buildPdt617Rows(p617: TaxSectionPdt617): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (isNonZeroTaxAmount(p617.retencion_igv_base) || isNonZeroTaxAmount(p617.retencion_igv_impuesto)) {
    rows.push({ label: 'Retención IGV (base)', value: formatTaxPdfMoney(p617.retencion_igv_base) });
    rows.push({ label: 'Retención IGV (impuesto)', value: formatTaxPdfMoney(p617.retencion_igv_impuesto) });
  }
  if (isNonZeroTaxAmount(p617.retencion_renta_base) || isNonZeroTaxAmount(p617.retencion_renta_impuesto)) {
    rows.push({ label: 'Retención renta (base)', value: formatTaxPdfMoney(p617.retencion_renta_base) });
    rows.push({ label: 'Retención renta (impuesto)', value: formatTaxPdfMoney(p617.retencion_renta_impuesto) });
  }
  const detrLabel = getPdt621DetractionPdfRowLabel(p617.detraction_payment);
  if (detrLabel) {
    rows.push({ label: 'Total retenciones', value: formatTaxPdfMoney(getPdt617GrossBeforeDetraction(p617)) });
    rows.push({ label: detrLabel, value: formatTaxPdfMoney(getPdt617AppliedDetractionAmount(p617)) });
  }
  return rows;
}

function buildBolsasRows(b: TaxSectionBolsasPlasticas): Array<{ label: string; value: string }> {
  const rows = [
    { label: 'Impuesto del periodo', value: formatTaxPdfMoney(b.impuesto) },
    { label: 'Saldo a favor anterior', value: formatTaxPdfMoney(b.saldo_favor_anterior) },
  ];
  const detrLabel = getPdt621DetractionPdfRowLabel(b.detraction_payment);
  if (detrLabel) {
    rows.push({ label: detrLabel, value: formatTaxPdfMoney(getBolsasPlasticasAppliedDetractionAmount(b)) });
  }
  return rows;
}

function buildPdt710Rows(p710: TaxSectionPdt710): Array<{ label: string; value: string }> {
  const rows = [
    { label: 'Renta anual resultante', value: formatTaxPdfMoney(p710.renta_anual_resultante) },
    { label: 'Saldo a favor anterior', value: formatTaxPdfMoney(p710.saldo_favor_anterior) },
  ];
  const detrLabel = getPdt621DetractionPdfRowLabel(p710.detraction_payment);
  if (detrLabel) {
    rows.push({ label: detrLabel, value: formatTaxPdfMoney(getPdt710AppliedDetractionAmount(p710)) });
  }
  return rows;
}

/* ---------- Estimador de altura: ¿cabe "Detalle de impuestos" entero en la página 1? ---------- */

/**
 * Constantes calibradas midiendo la posición Y real (en pt, vía `textContent` de pdf.js) de
 * cada elemento en PDFs generados con este mismo componente — no son un cálculo teórico desde
 * el CSS. Se usan solo para decidir si conviene forzar el salto de página de "Honorarios" (ver
 * `forcePageBreak` en `TaxSettlementPdfDocumentV2`): si el detalle de impuestos ya se desborda
 * de la página 1 por sí solo, forzar el salto es innecesario y deja media página en blanco.
 */
const HEIGHT_EST = {
  ROW: 14.5,
  STEPTITLE: 16,
  SUBHEADING: 18,
  SUMMARY_TRANSITION: 18.3,
  SUMROW: 13.6,
  /** Piso conservador (peor caso ~3 líneas) para la columna de tarjetas al costado de cada
   * bloque: cuando la tabla tiene pocas filas, la tarjeta+explicación puede ser más alta. */
  CARD_FLOOR: 84,
  GAP_WITHIN_PDT621: 23,
  GAP_BETWEEN_BLOCKS: 29,
  TOTAL_BAND: 44,
  PREFIX_NO_DRAFT: 236,
  DRAFT_EXTRA: 22,
  PAGE_CONTENT_BOTTOM: 798,
  SAFETY_MARGIN: 15,
};

function estimateIgvSplitHeight(p621: TaxSectionPdt621): number {
  const igvRows = listPdt621IgvDisplayRows(p621, { forPdf: true }).filter(
    ({ row, alwaysShowInPdf }) => alwaysShowInPdf || isTaxIgvRowVisibleInPdf(row),
  ).length;
  const igvSummaryRows = 7 + (getPdt621DetractionPdfRowLabel(p621.detraction_payment_igv) ? 1 : 0) + 1;
  const tableColumn =
    igvRows * HEIGHT_EST.ROW + HEIGHT_EST.SUMMARY_TRANSITION + (igvSummaryRows - 1) * HEIGHT_EST.SUMROW;
  // Con IGV Justo activo la columna de tarjetas suma el distintivo + una tarjeta explicativa más.
  const cardColumn = p621.igv_justo ? HEIGHT_EST.CARD_FLOOR + 50 : HEIGHT_EST.CARD_FLOOR;
  return Math.max(tableColumn, cardColumn);
}

function estimateRentaSplitHeight(p621: TaxSectionPdt621): number {
  const rentaRows =
    (isNonZeroTaxAmount(p621.renta_ventas_base) ? 1 : 0) +
    2 + // impuesto renta + saldo a favor ITAN
    (getPdt621DetractionPdfRowLabel(p621.detraction_payment_renta) ? 1 : 0) +
    1; // fila total
  return Math.max(rentaRows * HEIGHT_EST.ROW, HEIGHT_EST.CARD_FLOOR);
}

function estimatePdt621Height(p621: TaxSectionPdt621): number {
  return (
    HEIGHT_EST.SUBHEADING +
    HEIGHT_EST.STEPTITLE +
    estimateIgvSplitHeight(p621) +
    HEIGHT_EST.GAP_WITHIN_PDT621 +
    HEIGHT_EST.STEPTITLE +
    estimateRentaSplitHeight(p621)
  );
}

/** Bloque genérico (PDT 601, ITAN, PDT 617, ICBPER, PDT 710): título + tabla (+1 fila de total). */
function estimateSimpleBlockHeight(rowCount: number): number {
  const tableColumn = (rowCount + 1) * HEIGHT_EST.ROW;
  return HEIGHT_EST.SUBHEADING + Math.max(tableColumn, HEIGHT_EST.CARD_FLOOR);
}

/**
 * Altura estimada (en pt) del bloque "Detalle de impuestos" completo, desde el título de la
 * banda hasta el final de la banda "Total impuestos a pagar" — es decir, todo lo que precede a
 * "Honorarios" en el flujo normal de la página 1.
 */
function estimateDetalleImpuestosHeight(sec: TaxSettlementSectionsPayload): number {
  let height = 0;
  let firstBlock = true;
  const addBlock = (blockHeight: number) => {
    if (!firstBlock) height += HEIGHT_EST.GAP_BETWEEN_BLOCKS;
    height += blockHeight;
    firstBlock = false;
  };
  if (sec.pdt621?.enabled) addBlock(estimatePdt621Height(sec.pdt621));
  if (sec.pdt601?.enabled) addBlock(estimateSimpleBlockHeight(buildPdt601Rows(sec.pdt601).length));
  if (sec.itan?.enabled) addBlock(estimateSimpleBlockHeight(buildItanRows(sec.itan).length));
  if (sec.pdt617?.enabled) addBlock(estimateSimpleBlockHeight(buildPdt617Rows(sec.pdt617).length));
  if (sec.bolsas_plasticas?.enabled) {
    addBlock(estimateSimpleBlockHeight(buildBolsasRows(sec.bolsas_plasticas).length));
  }
  if (sec.pdt710?.enabled) addBlock(estimateSimpleBlockHeight(buildPdt710Rows(sec.pdt710).length));
  return height + HEIGHT_EST.TOTAL_BAND;
}

/**
 * true → forzar que "Honorarios" arranque en una página nueva (el detalle de impuestos cabe
 * entero en la página 1, así que sin forzar el salto Honorarios compartiría esa página).
 * false → dejarlo fluir en flujo normal (el detalle ya se desborda de la página 1 por su cuenta,
 * forzar aquí solo empujaría Honorarios a una página más, dejando la anterior con mucho espacio
 * en blanco — exactamente el bug reportado en producción).
 */
function shouldForceHonorariosPageBreak(
  sections: TaxSettlementSectionsPayload | null,
  draftBannerShown: boolean,
): boolean {
  if (!sections) return true;
  const prefix = HEIGHT_EST.PREFIX_NO_DRAFT + (draftBannerShown ? HEIGHT_EST.DRAFT_EXTRA : 0);
  const estimatedEnd = prefix + estimateDetalleImpuestosHeight(sections);
  return estimatedEnd <= HEIGHT_EST.PAGE_CONTENT_BOTTOM - HEIGHT_EST.SAFETY_MARGIN;
}

/* ---------- Pagos y recomendaciones ---------- */

function PaymentBlockV2({ firm, assets }: { firm: FirmConfig | null; assets?: LiquidationPdfAssets | null }) {
  const bankInfo = (firm?.statement_bank_info ?? '').trim();
  const observations = (firm?.statement_payment_observations ?? '').trim();
  const qrCaption = (firm?.statement_payment_qr_caption ?? '').trim() || 'Paga aquí con Yape';
  const bankLogoPng = assets?.bankLogoPng ?? null;
  const paymentQrPng = assets?.paymentQrPng ?? null;
  if (!bankInfo && !observations && !bankLogoPng && !paymentQrPng) return null;

  const lines = bankInfo.split(/\r?\n/).filter((p) => p.trim());

  return (
    <View wrap={false} minPresenceAhead={120} style={s.payWrap}>
      <View style={s.payLeft}>
        <View style={s.payCard}>
          <View style={s.payHeadRow}>
            {bankLogoPng ? <Image style={s.bankLogo} src={bankLogoPng} /> : null}
            {lines.length > 0 ? <Text style={s.payLineFirst}>{lines[0].trim()}</Text> : null}
          </View>
          {lines.slice(1).map((line, idx) => (
            <Text key={`${idx}-${line.slice(0, 10)}`} style={s.payLine}>
              {line.trim()}
            </Text>
          ))}
          {observations ? (
            <View style={s.obsRow}>
              <View style={{ marginRight: 6, marginTop: 0.5 }}>
                <IconBadge name="whatsapp" size={12} bg={V2.green} />
              </View>
              <Text style={s.obsText}>OBS: {observations}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={s.payRight}>
        {paymentQrPng ? (
          <View style={[s.payCard, s.qrWrap]}>
            <Image style={s.qrImage} src={paymentQrPng} />
            <View style={s.qrCaption}>
              <Text style={s.qrCaptionText}>{qrCaption}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function RecommendationsV2() {
  return (
    <View>
      <Text style={s.recoTitle}>{PDF_TAX_RECOMMENDATIONS_TITLE}</Text>
      {PDF_TAX_RECOMMENDATIONS.map((text, idx) => (
        <View key={text.slice(0, 24)} style={s.recoItem}>
          <View style={{ marginRight: 5, marginTop: 0.8 }}>
            <PdfIcon name="circleCheck" size={7} color={V2.green} />
          </View>
          <Text style={s.recoText}>
            {idx + 1}. {text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ---------- Documento ---------- */

type Props = {
  settlement: TaxSettlement;
  firm: FirmConfig | null;
  logoPng: Blob | null;
  footerAssets?: LiquidationPdfAssets | null;
};

export function TaxSettlementPdfDocumentV2({ settlement, firm, logoPng, footerAssets }: Props) {
  const firmName = firm?.name?.trim() || 'Estudio contable';
  const totals = settlementTotalsForPdf(settlement);
  const client = settlement.company;
  const liqNumber = formatLiquidationNumberForPdf(
    settlement.number,
    settlement.liquidation_period,
    settlement.id,
  );
  const docTitle = `Liquidación ${liqNumber}`;
  const issueStr = formatIssueDateForPdf(settlement.issue_date);
  const periodDisplay =
    (settlement.period_label ?? '').trim() ||
    periodLabelFromYM((settlement.liquidation_period ?? '').trim()) ||
    (settlement.liquidation_period ?? '').trim() ||
    '—';

  const sortedLines = [...(settlement.lines ?? [])]
    .filter((ln) => isNonZeroTaxAmount(Number(ln.amount) || 0))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0));

  const sections = parseTaxSectionsJson(settlement.pdt621_json, { includeDetraction: true });

  const renderSections = (sec: TaxSettlementSectionsPayload) => (
    <Fragment>
      <Band title="Detalle de impuestos" icon="fileInvoice" />
      {sec.pdt621?.enabled ? (
        <Pdt621Block
          p621={sec.pdt621}
          rentaRatePct={
            sec.pdt621.renta_regimen
              ? getRentaMensualRatePct(sec.pdt621.renta_regimen, sec.pdt621.renta_coeficiente_pct ?? 0)
              : null
          }
        />
      ) : null}
      {sec.pdt601?.enabled ? (
        <SimpleBlock
          title="PDT 601 — Planilla electrónica"
          rows={buildPdt601Rows(sec.pdt601)}
          totalLabel="Impuesto a pagar (planilla)"
          pendingLabel="Planilla pendiente"
          pendingAmount={sec.pdt601.impuesto_a_pagar}
          infoTitle="¿Qué es el PDT 601?"
          infoText="Planilla electrónica. Declara las remuneraciones y aportes de los trabajadores: EsSalud, ONP, AFP y rentas de 4ta y 5ta."
        />
      ) : null}
      {sec.itan?.enabled ? (
        <SimpleBlock
          title={`ITAN ${sec.itan.year}`}
          rows={buildItanRows(sec.itan)}
          totalLabel="Impuesto a pagar (ITAN)"
          pendingLabel="ITAN pendiente"
          pendingAmount={sec.itan.impuesto_a_pagar}
          infoTitle="¿Qué es el ITAN?"
          infoText="Impuesto Temporal a los Activos Netos. Se paga en cuotas sobre el valor de los activos de la empresa."
        />
      ) : null}
      {sec.pdt617?.enabled ? (
        <SimpleBlock
          title="PDT 617 — Otras retenciones"
          rows={buildPdt617Rows(sec.pdt617)}
          totalLabel="Impuesto a pagar (retenciones)"
          pendingLabel="Retenciones pendientes"
          pendingAmount={sec.pdt617.impuesto_a_pagar}
          infoTitle="¿Qué son las retenciones?"
          infoText="Montos de IGV y renta retenidos en operaciones con terceros, que la empresa declara y paga a la SUNAT."
        />
      ) : null}
      {sec.bolsas_plasticas?.enabled ? (
        <SimpleBlock
          title="Impuesto al consumo de bolsas plásticas"
          rows={buildBolsasRows(sec.bolsas_plasticas)}
          totalLabel="Impuesto a pagar (ICBPER)"
          pendingLabel="ICBPER pendiente"
          pendingAmount={sec.bolsas_plasticas.impuesto_a_pagar}
          infoTitle="¿Qué es el ICBPER?"
          infoText="Impuesto al consumo de las bolsas plásticas entregadas a los clientes en cada operación."
        />
      ) : null}
      {sec.pdt710?.enabled ? (
        <SimpleBlock
          title={`PDT 710 — Renta anual ${sec.pdt710.year}`}
          rows={buildPdt710Rows(sec.pdt710)}
          totalLabel="Impuesto a pagar (renta anual)"
          pendingLabel="Renta anual pendiente"
          pendingAmount={sec.pdt710.impuesto_a_pagar}
          infoTitle="¿Qué es la renta anual?"
          infoText="Impuesto anual resultante del ejercicio, menos el saldo a favor del periodo anterior."
        />
      ) : null}

      <View wrap={false} style={s.totalBand}>
        <View style={{ marginRight: 7 }}>
          <PdfIcon name="coins" size={12} color={V2.white} />
        </View>
        <Text style={s.totalBandLabel}>Total impuestos a pagar</Text>
        <View style={s.totalBandBox}>
          <Text style={s.totalBandAmount}>{formatTaxMoney(sec.grand_total_impuesto_a_pagar)}</Text>
        </View>
      </View>
    </Fragment>
  );

  return (
    <Document title={docTitle}>
      <Page size="A4" style={s.page}>
        <HeaderV2 firm={firm} logoPng={logoPng} liqNumber={liqNumber} />

        <InfoStrip
          groups={[
            [
              { label: 'Cliente', value: client?.business_name ?? '—', color: V2.blue, icon: 'users' },
              { label: 'RUC', value: client?.ruc ?? '—', color: V2.green, icon: 'addressCard' },
            ],
            [
              { label: 'Periodo', value: periodDisplay, color: V2.navy, icon: 'calendarDays' },
              { label: 'Fecha de emisión', value: issueStr, color: V2.green, icon: 'calendarCheck' },
            ],
          ]}
        />

        {!totals.emitted ? (
          <View style={s.draft}>
            <Text style={s.draftText}>
              BORRADOR — Los totales se calculan desde las líneas; emita la liquidación para fijar el documento final.
            </Text>
          </View>
        ) : null}

        <View style={s.intro}>
          <Text style={s.introText}>
            Ante todo saludarlo, la presente es para informarle el detalle de compras y ventas del mes, además de los
            impuestos a pagar.
          </Text>
        </View>

        {sections ? renderSections(sections) : null}

        {/*
          Honorarios nunca debe compartir la página 1 con el detalle de impuestos — regla de
          negocio explícita. Pero forzar el salto SIEMPRE (sin condición) causaba el bug real:
          cuando el detalle de impuestos ya se desborda de la página 1 por su cuenta (el caso
          común con varios PDT), forzar otro salto empuja Honorarios a una página de más y deja
          la anterior con muchísimo espacio en blanco. `shouldForceHonorariosPageBreak` estima
          (a partir de conteos de filas reales, calibrado contra PDFs renderizados) si el detalle
          alcanza a caber entero en la página 1; solo en ese caso se fuerza el salto.
        */}
        <Band
          title="Honorarios y cargos del estudio"
          icon="userTie"
          forcePageBreak={shouldForceHonorariosPageBreak(sections, !totals.emitted)}
        />
        <View style={s.table}>
          <View wrap={false} style={s.tHead}>
            <View style={[s.tHeadCell, { width: '52%' }]}>
              <Text style={s.tHeadText}>Concepto</Text>
            </View>
            <View style={[s.tHeadCell, { width: '24%' }]}>
              <Text style={s.tHeadText}>Periodo</Text>
            </View>
            <View style={[s.tHeadCell, { width: '24%' }]}>
              <Text style={[s.tHeadText, { textAlign: 'right' }]}>Monto</Text>
            </View>
          </View>
          {sortedLines.length > 0 ? (
            sortedLines.map((ln, idx) => (
              <View
                key={ln.id ?? idx}
                wrap={false}
                style={[s.tRow, idx === sortedLines.length - 1 ? s.tRowLast : {}]}
              >
                <View style={[s.tCell, { width: '52%' }]}>
                  <Text style={s.tText}>{ln.concept}</Text>
                </View>
                <View style={[s.tCell, { width: '24%' }]}>
                  <Text style={s.tText}>
                    {(ln.period_ym ?? '').trim() ||
                      (ln.period_date && ln.period_date.length >= 10 ? ln.period_date.slice(0, 10) : '') ||
                      settlement.liquidation_period ||
                      '—'}
                  </Text>
                </View>
                <View style={[s.tCell, { width: '24%' }]}>
                  <Text style={s.tNum}>{formatTaxMoney(ln.amount)}</Text>
                </View>
              </View>
            ))
          ) : (
            <View style={[s.tRow, s.tRowLast]}>
              <View style={[s.tCell, { width: '100%' }]}>
                <Text style={s.tText}>Sin líneas.</Text>
              </View>
            </View>
          )}
        </View>
        <View wrap={false} style={s.honorariosTotalBand}>
          <View style={{ marginRight: 6 }}>
            <PdfIcon name="wallet" size={10} color={V2.white} />
          </View>
          <Text style={s.honorariosTotalBandLabel}>Total honorarios a pagar</Text>
          <View style={s.honorariosTotalBandBox}>
            <Text style={s.honorariosTotalBandAmount}>{formatTaxMoney(totals.honorarios)}</Text>
          </View>
        </View>

        {settlement.notes?.trim() ? (
          <View wrap={false} style={s.notes}>
            <Text style={s.notesTitle}>Notas</Text>
            <Text style={s.notesText}>{settlement.notes.trim()}</Text>
          </View>
        ) : null}

        <PaymentBlockV2 firm={firm} assets={footerAssets} />
        <RecommendationsV2 />

        <View style={s.footer} fixed>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) =>
              `${firmName}   |   ${docTitle}   |   Página ${pageNumber} de ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

/** Logo de marca incluido en `public/`, usado si el estudio no tiene logo_url configurado. */
const PDF_V2_FALLBACK_LOGO = 'calendario-pdf-logo.png';

function publicBaseUrl(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.BASE_URL === 'string') {
    return import.meta.env.BASE_URL;
  }
  return '/';
}

async function fetchFallbackLogoBlob(): Promise<Blob | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch(`${publicBaseUrl()}${PDF_V2_FALLBACK_LOGO}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

export async function generateTaxSettlementPdfV2Blob(
  settlement: TaxSettlement,
  firm: FirmConfig | null,
  logoPng: Blob | null,
  footerAssets?: LiquidationPdfAssets | null,
): Promise<Blob> {
  // El encabezado v2 es de marca: si no llega el logo del estudio, usamos el de public/.
  const headerLogo = logoPng ?? (await fetchFallbackLogoBlob());
  const el = (
    <TaxSettlementPdfDocumentV2
      settlement={settlement}
      firm={firm}
      logoPng={headerLogo}
      footerAssets={footerAssets}
    />
  );
  return pdf(el).toBlob();
}

/** Mismo nombre que el PDF v1 con sufijo -V2 para distinguir la descarga. */
export function taxSettlementPdfV2Filename(settlement: TaxSettlement): string {
  return taxSettlementPdfFilename(settlement).replace(/\.pdf$/i, '-V2.pdf');
}
