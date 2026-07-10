import { StyleSheet, Text, View } from '@react-pdf/renderer';
import {
  formatTaxPdfMoney,
  formatTaxPdfTotalMoney,
  getItanAppliedDetractionAmount,
  getPdt621DetractionPdfRowLabel,
  type TaxSectionItan,
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
  itan: TaxSectionItan;
  showFooter?: boolean;
};

export function ItanPdfSection({ itan, showFooter = true }: Props) {
  const detractionApplied = getItanAppliedDetractionAmount(itan);
  const detractionLabel = getPdt621DetractionPdfRowLabel(itan.detraction_payment);

  return (
    <View>
      <View style={styles.dataRow}>
        <View style={{ width: '66%' }} />
        <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Impuesto</Text>
        <View style={{ width: COL_NUM }} />
      </View>
      <PdfListRow label={`Cuota N° ${itan.cuota_nro}`} value={formatTaxPdfMoney(itan.impuesto)} />
      <View wrap={false}>
        {detractionLabel ? (
          <PdfListRow label={detractionLabel} value={formatTaxPdfMoney(detractionApplied)} />
        ) : null}
        {showFooter ? (
          <PdfListRow
            label="ITAN pendiente"
            value={formatTaxPdfTotalMoney(itan.impuesto_a_pagar)}
            emphasized
          />
        ) : null}
      </View>
    </View>
  );
}

export default ItanPdfSection;
