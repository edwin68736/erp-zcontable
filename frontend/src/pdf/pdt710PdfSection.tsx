import { StyleSheet, Text, View } from '@react-pdf/renderer';
import {
  formatTaxPdfMoney,
  formatTaxPdfTotalMoney,
  getPdt710AppliedDetractionAmount,
  getPdt710PayableBeforeDetraction,
  getPdt621DetractionPdfRowLabel,
  isNonZeroTaxAmount,
  type TaxSectionPdt710,
} from '../utils/taxSettlementSections';
import { PDF_LIQ } from './pdfLiquidationTheme';

const COL_NUM = '17%';

const styles = StyleSheet.create({
  headerText: {
    fontSize: 7,
    fontWeight: 700,
    color: PDF_LIQ.text,
    textTransform: 'uppercase',
  },
  label: { fontSize: 7, color: PDF_LIQ.textMuted },
  labelEmphasis: { fontSize: 7.5, fontWeight: 700, color: PDF_LIQ.blueDark, textTransform: 'uppercase' },
  value: { fontSize: 7, color: PDF_LIQ.text, textAlign: 'right' },
  valueEmphasis: { fontSize: 7.5, fontWeight: 700, color: PDF_LIQ.blueDark, textAlign: 'right' },
  dataRow: { flexDirection: 'row', paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB' },
});

function PdfListRow({
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
  p710: TaxSectionPdt710;
  showFooter?: boolean;
};

export function Pdt710PdfSection({ p710, showFooter = true }: Props) {
  const detractionApplied = getPdt710AppliedDetractionAmount(p710);
  const detractionLabel = getPdt621DetractionPdfRowLabel(p710.detraction_payment);
  const showSaldo = isNonZeroTaxAmount(p710.saldo_favor_anterior);

  return (
    <View>
      <View style={styles.dataRow}>
        <View style={{ width: '66%' }} />
        <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Impuesto</Text>
        <View style={{ width: COL_NUM }} />
      </View>
      <PdfListRow label="Renta anual resultante" value={formatTaxPdfMoney(p710.renta_anual_resultante)} />
      {showSaldo ? (
        <PdfListRow label="Saldo a favor periodo anterior" value={formatTaxPdfMoney(p710.saldo_favor_anterior)} />
      ) : null}
      <View wrap={false}>
        {detractionLabel ? (
          <PdfListRow
            label="Total impuesto"
            value={formatTaxPdfMoney(getPdt710PayableBeforeDetraction(p710))}
            emphasized
          />
        ) : null}
        {detractionLabel ? (
          <PdfListRow label={detractionLabel} value={formatTaxPdfMoney(detractionApplied)} />
        ) : null}
        {showFooter ? (
          <PdfListRow label="Impuesto a pagar" value={formatTaxPdfTotalMoney(p710.impuesto_a_pagar)} emphasized />
        ) : null}
      </View>
    </View>
  );
}

export default Pdt710PdfSection;
