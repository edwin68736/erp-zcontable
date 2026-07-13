import { StyleSheet, Text, View } from '@react-pdf/renderer';
import {
  formatTaxPdfMoney,
  formatTaxPdfTotalMoney,
  getPdt617AppliedDetractionAmount,
  getPdt617GrossBeforeDetraction,
  getPdt621DetractionPdfRowLabel,
  isNonZeroTaxAmount,
  type TaxSectionPdt617,
} from '../utils/taxSettlementSections';
import { PDF_LIQ } from './pdfLiquidationTheme';

// La columna Impuesto (66%–83%) y el margen derecho (17%) coinciden con las demás
// secciones del PDF (601 / ITAN / bolsas / 710) para que todo quede alineado.
const COL_CONCEPT = '49%';
const COL_NUM = '17%';

const styles = StyleSheet.create({
  headerText: {
    fontSize: 7,
    fontWeight: 700,
    color: PDF_LIQ.text,
    textTransform: 'uppercase',
  },
  rowText: { fontSize: 7, color: PDF_LIQ.text },
  label: { fontSize: 7, color: PDF_LIQ.textMuted },
  labelEmphasis: { fontSize: 7.5, fontWeight: 700, color: PDF_LIQ.blueDark, textTransform: 'uppercase' },
  value: { fontSize: 7, color: PDF_LIQ.text, textAlign: 'right' },
  valueEmphasis: { fontSize: 7.5, fontWeight: 700, color: PDF_LIQ.blueDark, textAlign: 'right' },
  dataRow: { flexDirection: 'row', paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB' },
});

function PdfDataRow({ label, base, impuesto }: { label: string; base: string; impuesto: string }) {
  return (
    <View style={styles.dataRow}>
      <Text style={[styles.rowText, { width: COL_CONCEPT }]}>{label}</Text>
      <Text style={[styles.value, { width: COL_NUM }]}>{base}</Text>
      <Text style={[styles.value, { width: COL_NUM }]}>{impuesto}</Text>
      <View style={{ width: COL_NUM }} />
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
  p617: TaxSectionPdt617;
  showFooter?: boolean;
};

export function Pdt617PdfSection({ p617, showFooter = true }: Props) {
  const detractionApplied = getPdt617AppliedDetractionAmount(p617);
  const detractionLabel = getPdt621DetractionPdfRowLabel(p617.detraction_payment);
  const showIgvRow =
    isNonZeroTaxAmount(p617.retencion_igv_base) || isNonZeroTaxAmount(p617.retencion_igv_impuesto);
  const showRentaRow =
    isNonZeroTaxAmount(p617.retencion_renta_base) || isNonZeroTaxAmount(p617.retencion_renta_impuesto);

  return (
    <View>
      <View style={styles.dataRow}>
        <Text style={[styles.headerText, { width: COL_CONCEPT }]}>Concepto</Text>
        <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Base imponible</Text>
        <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Impuesto</Text>
        <View style={{ width: COL_NUM }} />
      </View>
      {showIgvRow ? (
        <PdfDataRow
          label="Retenciones de IGV"
          base={formatTaxPdfMoney(p617.retencion_igv_base)}
          impuesto={formatTaxPdfMoney(p617.retencion_igv_impuesto)}
        />
      ) : null}
      {showRentaRow ? (
        <PdfDataRow
          label="Retenciones de renta"
          base={formatTaxPdfMoney(p617.retencion_renta_base)}
          impuesto={formatTaxPdfMoney(p617.retencion_renta_impuesto)}
        />
      ) : null}
      <View wrap={false}>
        {detractionLabel ? (
          <PdfSummaryRow
            label="Total retenciones"
            value={formatTaxPdfMoney(getPdt617GrossBeforeDetraction(p617))}
            emphasized
          />
        ) : null}
        {detractionLabel ? (
          <PdfSummaryRow label={detractionLabel} value={formatTaxPdfMoney(detractionApplied)} />
        ) : null}
        {showFooter ? (
          <PdfSummaryRow label="Impuesto a pagar" value={formatTaxPdfTotalMoney(p617.impuesto_a_pagar)} emphasized />
        ) : null}
      </View>
    </View>
  );
}

export default Pdt617PdfSection;
