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
  getPdt621IgvPayableBeforeDetraction,
  getPdt621IgvSaldoFavorLabel,
  getPdt621PercepcionesRetencionesFieldLabel,
  getPdt621RentaNetAfterDetraction,
  getPdt621RentaPayableBeforeDetraction,
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
    backgroundColor: V2.white,
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

  /* Tarjetas de resumen: SIEMPRE debajo de la tabla, nunca al lado en la misma fila flex.
   * react-pdf no reparte bien una fila que mezcla una columna partible (tabla larga) con una
   * columna no-partible (tarjeta) cuando esa fila debe cruzar una página: produce texto
   * superpuesto/duplicado. Poniendo la tabla a ancho completo y las tarjetas debajo, en flujo
   * normal de arriba hacia abajo, se elimina ese riesgo. Ancho fijo (no flex) para que una sola
   * tarjeta no se estire a todo el ancho cuando no hay pareja (p. ej. honorarios).
   */
  cardsRow: { flexDirection: 'row', marginTop: 2, marginBottom: 10 },
  cardsRowItem: { width: '48%', marginRight: '4%' },

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

  /* Banda total */
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
    paddingVertical: 5,
    paddingHorizontal: 12,
    minWidth: 96,
  },
  totalBandAmount: { fontSize: 11, fontWeight: 700, color: V2.navy, textAlign: 'right' },

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

function Band({ title, icon }: { title: string; icon: PdfIconName }) {
  return (
    <View style={s.band}>
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
 */
function SubHeading({ title, minPresenceAhead = 60 }: { title: string; minPresenceAhead?: number }) {
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
  minPresenceAhead = 60,
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
 * Fila de tarjetas cortas debajo de una tabla (nunca al lado de contenido partible — ver nota
 * en el estilo `cardsRow`). Cada hijo directo debe ser un `CardsRowItem`.
 *
 * `wrap={false}` aquí SÍ es seguro (a diferencia del extinto `Split`): los hijos de esta fila
 * son siempre tarjetas cortas ya atómicas (PendingCard/InfoCard, ~50-70pt), nunca una tabla de
 * longitud variable. Mantiene ambas tarjetas juntas en la misma página en vez de partir el par.
 */
function CardsRow({ children }: { children: ReactNode }) {
  return (
    <View wrap={false} style={s.cardsRow}>
      {children}
    </View>
  );
}

function CardsRowItem({ children }: { children: ReactNode }) {
  return <View style={s.cardsRowItem}>{children}</View>;
}

function PendingCard({
  label,
  amount,
  icon = 'receipt',
}: {
  label: string;
  amount: string;
  icon?: PdfIconName;
}) {
  return (
    <View wrap={false} style={s.pendCard}>
      <View style={{ marginRight: 8 }}>
        <IconBadge name={icon} size={24} bg={V2.green} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.pendLabel}>{label}</Text>
        <Text style={s.pendAmount}>{amount}</Text>
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

/** Tabla simple etiqueta/monto (secciones distintas a IGV). */
function AmountTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
  if (rows.length === 0) return null;
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
          style={[s.tRow, idx === rows.length - 1 ? s.tRowLast : {}]}
        >
          <View style={[s.tCell, { width: '68%' }]}>
            <Text style={s.tText}>{r.label}</Text>
          </View>
          <View style={[s.tCell, { width: '32%' }]}>
            <Text style={s.tNum}>{r.value}</Text>
          </View>
        </View>
      ))}
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

const COL_C = '32%';
const COL_N = '17%';

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
          <View key={h} style={[s.tHeadCell, { width: COL_N }]}>
            <Text style={[s.tHeadText, { textAlign: 'right' }]}>{h}</Text>
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
  const igvPayableBefore = getPdt621IgvPayableBeforeDetraction(p621);
  const rentaPayableBefore = getPdt621RentaPayableBeforeDetraction(p621);
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

  const rentaSummary: Array<{ label: string; value: string; tone: SumTone }> = [
    ...(isNonZeroTaxAmount(p621.renta_ventas_base)
      ? [{ label: 'Ingresos netos (base)', value: formatTaxPdfRowMoney(p621.renta_ventas_base), tone: 'normal' as SumTone }]
      : []),
    {
      label: `Impuesto renta${rentaRateLabel ? ` (${rentaRateLabel})` : ''}`,
      value: formatTaxPdfRowMoney(p621.renta_ventas_impuesto),
      tone: 'normal',
    },
    { label: 'Saldo a favor ITAN', value: formatTaxPdfMoney(p621.renta_saldo_favor_itan), tone: 'normal' },
    { label: 'Impuesto a pagar (renta)', value: formatTaxPdfTotalMoney(p621.renta_impuesto_a_pagar), tone: 'strong' },
  ];

  return (
    <Fragment>
      <SubHeading title="PDT 621 — IGV y Renta" />

      <StepTitle title="1. IGV mensual" icon="cartShopping" />
      <IgvTable p621={p621} />
      <View style={{ marginTop: 4, marginBottom: 6 }}>
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
      <CardsRow>
        {igvPayableBefore > 0 ? (
          <CardsRowItem>
            <PendingCard
              label="IGV pendiente"
              amount={formatTaxPdfTotalMoney(getPdt621IgvNetAfterDetraction(p621))}
              icon="receipt"
            />
          </CardsRowItem>
        ) : null}
        <CardsRowItem>
          <InfoCard
            title="¿Qué es el IGV?"
            text="Impuesto General a las Ventas. Se aplica a la venta de bienes y prestación de servicios."
          />
        </CardsRowItem>
      </CardsRow>

      <StepTitle title="2. Renta mensual" icon="chartColumn" />
      <AmountTable rows={rentaSummary.map((r) => ({ label: r.label, value: r.value }))} />
      {detrLabelRenta ? (
        <View style={{ marginTop: 4, marginBottom: 6 }}>
          <SumRow label={detrLabelRenta} value={formatTaxPdfMoney(getPdt621AppliedDetractionAmountRenta(p621))} />
        </View>
      ) : null}
      <CardsRow>
        {rentaPayableBefore > 0 ? (
          <CardsRowItem>
            <PendingCard
              label="Renta pendiente"
              amount={formatTaxPdfTotalMoney(getPdt621RentaNetAfterDetraction(p621))}
              icon="chartColumn"
            />
          </CardsRowItem>
        ) : null}
        <CardsRowItem>
          <InfoCard
            title="¿Qué es la Renta?"
            text="Impuesto a las utilidades obtenidas por la actividad económica de la empresa."
          />
        </CardsRowItem>
      </CardsRow>
    </Fragment>
  );
}

/** Bloque genérico: título + tabla de conceptos + tarjeta pendiente + nota. */
function SimpleBlock({
  title,
  rows,
  pendingLabel,
  pendingAmount,
  infoTitle,
  infoText,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
  pendingLabel: string;
  pendingAmount: number;
  infoTitle: string;
  infoText: string;
}) {
  return (
    <Fragment>
      {/* Sin wrap={false} aquí: solo el título reserva espacio mínimo (minPresenceAhead).
          La tabla puede partirse entre filas si la sección no cabe entera en la página; las
          tarjetas van DEBAJO de la tabla (nunca al lado) para no cruzar una página junto a
          contenido partible. */}
      <SubHeading title={title} />
      <AmountTable rows={rows} />
      <CardsRow>
        <CardsRowItem>
          <PendingCard label={pendingLabel} amount={formatTaxPdfTotalMoney(pendingAmount)} />
        </CardsRowItem>
        <CardsRowItem>
          <InfoCard title={infoTitle} text={infoText} />
        </CardsRowItem>
      </CardsRow>
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
          Honorarios fluye en el flujo normal (SIN `break` forzado): forzar que siempre empiece
          en una página nueva se probó y rompe la regla real del documento — "máximo el contenido
          necesario, sin espacio en blanco" — cuando el bloque anterior (p. ej. un PDT 601 con
          varias líneas) ya se desborda un poco a la página 2 antes de llegar aquí: el resto de
          esa página 2 queda vacío y Honorarios se empuja a una 3ª página innecesaria. Dejarlo en
          flujo normal hace que arranque donde alcance el espacio, sin desperdiciarlo.
        */}
        <Band title="Honorarios y cargos del estudio" icon="userTie" />
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
        <CardsRow>
          <CardsRowItem>
            <PendingCard
              label="Total honorarios a pagar"
              amount={formatTaxMoney(totals.honorarios)}
              icon="wallet"
            />
          </CardsRowItem>
        </CardsRow>

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
