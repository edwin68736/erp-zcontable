import { StyleSheet, Text, View } from '@react-pdf/renderer';

import { formatRentaRateLabel } from '../utils/companyTaxRegime';

import {

  formatImpuestoPeriodoPdf,

  formatPdt621IgvBalanceAmount,

  getPdt621DetractionPdfRowLabel,

  getPdt621PercepcionesRetencionesFieldLabel,

  getPdt621AppliedDetractionAmount,

  getPdt621AppliedDetractionAmountRenta,

  getPdt621IgvBalanceLabel,

  getPdt621IgvNetAfterDetraction,

  getPdt621IgvPayableBeforeDetraction,

  getPdt621IgvSaldoFavorLabel,

  getPdt621RentaNetAfterDetraction,

  getPdt621RentaPayableBeforeDetraction,

  formatTaxPdfMoney,

  formatTaxPdfRowMoney,

  formatTaxPdfTotalMoney,

  isNonZeroTaxAmount,

  isTaxIgvRowVisibleInPdf,

  listPdt621IgvDisplayRows,

  type TaxSectionPdt621,

} from '../utils/taxSettlementSections';

import { PDF_LIQ } from './pdfLiquidationTheme';



const COL_CONCEPT = '32%';

const COL_NUM = '17%';



const styles = StyleSheet.create({

  sectionTitle: {

    fontSize: 8,

    fontWeight: 700,

    color: PDF_LIQ.blueDark,

    marginBottom: 4,

    textTransform: 'uppercase',

  },

  headerText: {

    fontSize: 7,

    fontWeight: 700,

    color: PDF_LIQ.text,

    textTransform: 'uppercase',

  },

  headerRow: {

    flexDirection: 'row',

    paddingVertical: 3,

    paddingHorizontal: 2,

    marginBottom: 2,

    borderBottomWidth: 1,

    borderBottomColor: PDF_LIQ.grayBorder,

  },

  rowText: { fontSize: 7, color: PDF_LIQ.text },

  label: { fontSize: 7, color: PDF_LIQ.textMuted },

  labelEmphasis: { fontSize: 7.5, fontWeight: 700, color: PDF_LIQ.blueDark, textTransform: 'uppercase' },

  value: { fontSize: 7, color: PDF_LIQ.text, textAlign: 'right' },

  valueEmphasis: { fontSize: 7.5, fontWeight: 700, color: PDF_LIQ.blueDark, textAlign: 'right' },

  dataRow: { flexDirection: 'row', paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB' },

  sectionDivider: { borderTopWidth: 1, borderTopColor: PDF_LIQ.grayBorder, marginTop: 6, paddingTop: 4 },
  pdt621Total: { borderTopWidth: 1, borderTopColor: PDF_LIQ.grayBorder, marginTop: 6, paddingTop: 4 },
});



function PdfHeaderRow() {

  return (

    <View style={styles.headerRow}>

      <Text style={[styles.headerText, { width: COL_CONCEPT }]}>Concepto</Text>

      <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Base imponible</Text>

      <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>No gravadas</Text>

      <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Impuesto</Text>

      <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Total</Text>

    </View>

  );

}



function PdfIgvDataRow({

  label,

  base,

  noGravadas,

  impuesto,

  total,

}: {

  label: string;

  base: string;

  noGravadas: string;

  impuesto: string;

  total: string;

}) {

  return (

    <View style={styles.dataRow}>

      <Text style={[styles.rowText, { width: COL_CONCEPT }]}>{label}</Text>

      <Text style={[styles.value, { width: COL_NUM }]}>{base}</Text>

      <Text style={[styles.value, { width: COL_NUM }]}>{noGravadas}</Text>

      <Text style={[styles.value, { width: COL_NUM }]}>{impuesto}</Text>

      <Text style={[styles.value, { width: COL_NUM }]}>{total}</Text>

    </View>

  );

}



function PdfSummaryRow({

  label,

  value,

  emphasized = false,

}: {

  label: string;

  value: string;

  emphasized?: boolean;

}) {

  return (

    <View style={styles.dataRow}>

      <Text style={[emphasized ? styles.labelEmphasis : styles.label, { width: '66%', textAlign: 'right', paddingRight: 4 }]}>

        {label}

      </Text>

      <Text style={[emphasized ? styles.valueEmphasis : styles.value, { width: COL_NUM }]}>{value}</Text>

      <View style={{ width: COL_NUM }} />

    </View>

  );

}



type Props = {
  p621: TaxSectionPdt621;
  rentaRatePct?: number | null;
};

export function Pdt621PdfFooter({ p621 }: { p621: TaxSectionPdt621 }) {
  const igvPayableBefore = getPdt621IgvPayableBeforeDetraction(p621);
  if (igvPayableBefore <= 0) return null;

  return (
    <View wrap={false} style={styles.pdt621Total}>
      <PdfSummaryRow
        label="IGV pendiente"
        value={formatTaxPdfTotalMoney(getPdt621IgvNetAfterDetraction(p621))}
        emphasized
      />
    </View>
  );
}

function Pdt621RentaPdfPendingRow({ p621 }: { p621: TaxSectionPdt621 }) {
  const rentaPayableBefore = getPdt621RentaPayableBeforeDetraction(p621);
  if (rentaPayableBefore <= 0) return null;

  return (
    <View wrap={false} style={styles.pdt621Total}>
      <PdfSummaryRow
        label="Renta pendiente"
        value={formatTaxPdfTotalMoney(getPdt621RentaNetAfterDetraction(p621))}
        emphasized
      />
    </View>
  );
}

export function Pdt621PdfSection({ p621, rentaRatePct }: Props) {

  const igvRows = listPdt621IgvDisplayRows(p621, { forPdf: true }).filter(
    ({ row, alwaysShowInPdf }) => alwaysShowInPdf || isTaxIgvRowVisibleInPdf(row),
  );

  const rentaRateLabel = rentaRatePct != null ? formatRentaRateLabel(rentaRatePct) : null;

  const igvBalance = getPdt621IgvBalanceLabel(p621);

  const igvSaldoFavor = getPdt621IgvSaldoFavorLabel(p621);

  const detractionAppliedIgv = getPdt621AppliedDetractionAmount(p621);

  const detractionAppliedRenta = getPdt621AppliedDetractionAmountRenta(p621);

  const detractionLabelIgv = getPdt621DetractionPdfRowLabel(p621.detraction_payment_igv);

  const detractionLabelRenta = getPdt621DetractionPdfRowLabel(p621.detraction_payment_renta);



  const summaryRows = [

    { label: 'Impuesto del periodo', value: formatImpuestoPeriodoPdf(p621.impuesto_periodo), emphasized: false },

    { label: 'Crédito periodo anterior', value: formatTaxPdfMoney(p621.credito_periodo_anterior), emphasized: false },

    {

      label: igvSaldoFavor.label,

      value: isNonZeroTaxAmount(igvSaldoFavor.amount)

        ? formatPdt621IgvBalanceAmount(igvSaldoFavor)

        : '—',

      emphasized: true,

    },

    {

      label: getPdt621PercepcionesRetencionesFieldLabel('Percepciones del periodo', p621.saldo_favor),

      value: formatTaxPdfMoney(p621.percepciones_periodo),

      emphasized: false,

    },

    {

      label: getPdt621PercepcionesRetencionesFieldLabel('Percepciones periodos anteriores', p621.saldo_favor),

      value: formatTaxPdfMoney(p621.percepciones_anteriores),

      emphasized: false,

    },

    {

      label: getPdt621PercepcionesRetencionesFieldLabel('Retenciones del periodo', p621.saldo_favor),

      value: formatTaxPdfMoney(p621.retenciones_periodo),

      emphasized: false,

    },

    {

      label: getPdt621PercepcionesRetencionesFieldLabel('Retenciones periodos anteriores', p621.saldo_favor),

      value: formatTaxPdfMoney(p621.retenciones_anteriores),

      emphasized: false,

    },

    {

      label: igvBalance.label,

      value: isNonZeroTaxAmount(igvBalance.amount)

        ? formatPdt621IgvBalanceAmount({ label: igvBalance.label, amount: igvBalance.amount })

        : '—',

      emphasized: true,

    },

  ] as const;



  const rentaRows = [

    ...(isNonZeroTaxAmount(p621.renta_ventas_base)

      ? [{ label: 'Ingresos netos (base)', value: formatTaxPdfRowMoney(p621.renta_ventas_base), emphasized: false as const }]

      : []),

    {

      label: `Impuesto renta${rentaRateLabel ? ` (${rentaRateLabel})` : ''}`,

      value: formatTaxPdfRowMoney(p621.renta_ventas_impuesto),

      emphasized: false as const,

    },

    { label: 'Saldo a favor ITAN', value: formatTaxPdfMoney(p621.renta_saldo_favor_itan), emphasized: false as const },

    {

      label: 'Impuesto a pagar (renta)',

      value: formatTaxPdfTotalMoney(p621.renta_impuesto_a_pagar),

      emphasized: true as const,

    },

  ] as const;



  return (

    <View>

      <Text style={styles.sectionTitle}>1. IGV mensual</Text>

      <PdfHeaderRow />

      {igvRows.map(({ label, row }) => (
        <PdfIgvDataRow
          key={label}
          label={label}
          base={formatTaxPdfMoney(row.base)}
          noGravadas={formatTaxPdfMoney(row.no_gravadas ?? 0)}
          impuesto={formatTaxPdfMoney(row.impuesto)}
          total={formatTaxPdfMoney(row.total)}
        />
      ))}

      {summaryRows.map((item) => (

        <PdfSummaryRow key={item.label} label={item.label} value={item.value} emphasized={item.emphasized} />

      ))}

      {detractionLabelIgv ? (

        <PdfSummaryRow

          label={detractionLabelIgv}

          value={formatTaxPdfMoney(detractionAppliedIgv)}

        />

      ) : null}

      <Pdt621PdfFooter p621={p621} />

      <View wrap={false} style={styles.sectionDivider}>

        <Text style={styles.sectionTitle}>2. Renta mensual</Text>

        <View style={styles.dataRow}>

          <View style={{ width: '66%' }} />

          <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Impuesto</Text>

          <View style={{ width: COL_NUM }} />

        </View>

        {rentaRows.map((item) => (

          <PdfSummaryRow key={item.label} label={item.label} value={item.value} emphasized={item.emphasized} />

        ))}

        {detractionLabelRenta ? (

          <PdfSummaryRow

            label={detractionLabelRenta}

            value={formatTaxPdfMoney(detractionAppliedRenta)}

          />

        ) : null}

        <Pdt621RentaPdfPendingRow p621={p621} />

      </View>

    </View>

  );

}



export default Pdt621PdfSection;


