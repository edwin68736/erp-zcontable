import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PDF_LIQ } from './pdfLiquidationTheme';

const COL_NUM = '17%';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: 3, marginTop: 6 },
  label: { fontSize: 7, color: PDF_LIQ.textMuted, textAlign: 'right', paddingRight: 4 },
  value: { fontSize: 9, fontWeight: 700, color: PDF_LIQ.blueDark, textAlign: 'right' },
  note: {
    fontSize: 6.5,
    color: PDF_LIQ.textMuted,
    textAlign: 'right',
    marginTop: 1,
    marginBottom: 2,
    paddingRight: 4,
  },
});

/** Pie de sección PDT alineado con la columna Impuesto (etiqueta + monto en la misma fila). */
export function PdfPdtSectionFooterRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string | null;
}) {
  return (
    <View>
      <View style={styles.row}>
        <Text style={[styles.label, { width: '66%' }]}>{label}</Text>
        <Text style={[styles.value, { width: COL_NUM }]}>{value}</Text>
        <View style={{ width: COL_NUM }} />
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

export default PdfPdtSectionFooterRow;
