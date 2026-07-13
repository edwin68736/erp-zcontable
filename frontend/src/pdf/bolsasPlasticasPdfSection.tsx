import { StyleSheet, Text, View } from '@react-pdf/renderer';
import {
  formatTaxPdfMoney,
  formatTaxPdfTotalMoney,
  getBolsasPlasticasAppliedDetractionAmount,
  getBolsasPlasticasPayableBeforeDetraction,
  getPdt621DetractionPdfRowLabel,
  isNonZeroTaxAmount,
  type TaxSectionBolsasPlasticas,
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
  bolsas: TaxSectionBolsasPlasticas;
  showFooter?: boolean;
};

export function BolsasPlasticasPdfSection({ bolsas, showFooter = true }: Props) {
  const detractionApplied = getBolsasPlasticasAppliedDetractionAmount(bolsas);
  const detractionLabel = getPdt621DetractionPdfRowLabel(bolsas.detraction_payment);
  const showSaldo = isNonZeroTaxAmount(bolsas.saldo_favor_anterior);

  return (
    <View>
      <View style={styles.dataRow}>
        <View style={{ width: '66%' }} />
        <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Impuesto</Text>
        <View style={{ width: COL_NUM }} />
      </View>
      <PdfListRow label="Impuesto consumo bolsas plásticas" value={formatTaxPdfMoney(bolsas.impuesto)} />
      {showSaldo ? (
        <PdfListRow label="Saldo a favor periodo anterior" value={formatTaxPdfMoney(bolsas.saldo_favor_anterior)} />
      ) : null}
      <View wrap={false}>
        {detractionLabel ? (
          <PdfListRow
            label="Total impuesto"
            value={formatTaxPdfMoney(getBolsasPlasticasPayableBeforeDetraction(bolsas))}
            emphasized
          />
        ) : null}
        {detractionLabel ? (
          <PdfListRow label={detractionLabel} value={formatTaxPdfMoney(detractionApplied)} />
        ) : null}
        {showFooter ? (
          <PdfListRow label="Impuesto a pagar" value={formatTaxPdfTotalMoney(bolsas.impuesto_a_pagar)} emphasized />
        ) : null}
      </View>
    </View>
  );
}

export default BolsasPlasticasPdfSection;
