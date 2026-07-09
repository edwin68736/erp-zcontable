import { StyleSheet, Text, View } from '@react-pdf/renderer';

import {

  formatTaxPdfMoney,

  formatTaxPdfTotalMoney,

  getPdt601AppliedDetractionAmount,

  getPdt621DetractionPdfRowLabel,

  isNonZeroTaxAmount,

  listPdt601DisplayRows,

  type TaxSectionPdt601,

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

  p601: TaxSectionPdt601;

  showFooter?: boolean;

};



export function Pdt601PdfSection({ p601, showFooter = true }: Props) {

  const rows = listPdt601DisplayRows(p601).filter((item) => isNonZeroTaxAmount(item.value));

  const detractionApplied = getPdt601AppliedDetractionAmount(p601);

  const detractionLabel = getPdt621DetractionPdfRowLabel(p601.detraction_payment);

  const hasRows = rows.length > 0 || detractionLabel;



  return (

    <View>

      {hasRows ? (

        <View style={styles.dataRow}>

          <View style={{ width: '66%' }} />

          <Text style={[styles.headerText, { width: COL_NUM, textAlign: 'right' }]}>Impuesto</Text>

          <View style={{ width: COL_NUM }} />

        </View>

      ) : null}

      {rows.map((item) => (

        <PdfListRow key={item.label} label={item.label} value={formatTaxPdfMoney(item.value)} />

      ))}

      <View wrap={false}>
        {detractionLabel ? (
          <PdfListRow label={detractionLabel} value={formatTaxPdfMoney(detractionApplied)} />
        ) : null}
        {showFooter ? (
          <PdfListRow
            label="Planilla pendiente"
            value={formatTaxPdfTotalMoney(p601.impuesto_a_pagar)}
            emphasized
          />
        ) : null}
      </View>

    </View>

  );

}



export default Pdt601PdfSection;


