import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { FirmConfig } from '../types/dashboard';
import { PDF_LIQ } from './pdfLiquidationTheme';
import { PDF_TAX_RECOMMENDATIONS, PDF_TAX_RECOMMENDATIONS_TITLE } from './pdfTaxRecommendations';

export type LiquidationPdfAssets = {
  bankLogoPng?: Blob | null;
  paymentQrPng?: Blob | null;
};

const styles = StyleSheet.create({
  divider: {
    borderTopWidth: 1,
    borderTopColor: PDF_LIQ.text,
    borderStyle: 'dashed',
    marginTop: 10,
    marginBottom: 8,
    paddingTop: 8,
  },
  paymentRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bankCol: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', minWidth: 0, marginRight: 10 },
  bankLogo: { width: 36, height: 36, objectFit: 'contain', marginRight: 8 },
  bankTextWrap: { flex: 1, minWidth: 0 },
  bankLine: { fontSize: 6.5, color: PDF_LIQ.blueDark, lineHeight: 1.35, marginBottom: 1.5 },
  bankLineFirst: { fontSize: 7, fontWeight: 700, color: PDF_LIQ.blueDark, marginBottom: 2 },
  obsLine: { fontSize: 6.5, fontWeight: 700, color: PDF_LIQ.blueDark, lineHeight: 1.35, marginTop: 3 },
  qrCol: { width: 78, alignItems: 'center' },
  qrImage: { width: 64, height: 64, objectFit: 'contain' },
  qrCaption: {
    marginTop: 3,
    backgroundColor: '#7A3394',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 2,
    width: '100%',
  },
  qrCaptionText: {
    fontSize: 5.5,
    fontWeight: 700,
    color: PDF_LIQ.white,
    textAlign: 'center',
  },
  recoDivider: {
    borderTopWidth: 1,
    borderTopColor: PDF_LIQ.text,
    marginTop: 10,
    marginBottom: 6,
    paddingTop: 6,
  },
  recoTitle: {
    fontSize: 8,
    fontWeight: 700,
    color: PDF_LIQ.blueDark,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  recoItem: { fontSize: 6.5, color: PDF_LIQ.blueDark, lineHeight: 1.35, marginBottom: 2.5 },
});

function BankInfoBlock({
  bankInfo,
  observations,
  bankLogoPng,
}: {
  bankInfo: string;
  observations: string;
  bankLogoPng?: Blob | null;
}) {
  const paragraphs = bankInfo.split(/\r?\n/).filter((p) => p.trim());
  const obs = observations.trim();

  return (
    <View style={styles.bankCol}>
      {bankLogoPng ? <Image style={styles.bankLogo} src={bankLogoPng} /> : null}
      <View style={styles.bankTextWrap}>
        {paragraphs.map((para, idx) => (
          <Text key={`${idx}-${para.slice(0, 12)}`} style={idx === 0 ? styles.bankLineFirst : styles.bankLine}>
            {para.trim()}
          </Text>
        ))}
        {obs ? <Text style={styles.obsLine}>OBS: {obs}</Text> : null}
      </View>
    </View>
  );
}

function QrBlock({ qrPng, caption }: { qrPng: Blob; caption: string }) {
  return (
    <View style={styles.qrCol}>
      <Image style={styles.qrImage} src={qrPng} />
      <View style={styles.qrCaption}>
        <Text style={styles.qrCaptionText}>{caption}</Text>
      </View>
    </View>
  );
}

export function PdfLiquidationPaymentFooter({
  firm,
  assets,
}: {
  firm: FirmConfig | null;
  assets?: LiquidationPdfAssets | null;
}) {
  const bankInfo = (firm?.statement_bank_info ?? '').trim();
  const observations = (firm?.statement_payment_observations ?? '').trim();
  const qrCaption = (firm?.statement_payment_qr_caption ?? '').trim() || 'Paga aquí con Yape';
  const bankLogoPng = assets?.bankLogoPng ?? null;
  const paymentQrPng = assets?.paymentQrPng ?? null;

  const showPayment = Boolean(bankInfo || observations || bankLogoPng || paymentQrPng);
  if (!showPayment) return null;

  return (
    <View style={styles.divider}>
      <View style={styles.paymentRow}>
        <BankInfoBlock bankInfo={bankInfo} observations={observations} bankLogoPng={bankLogoPng} />
        {paymentQrPng ? <QrBlock qrPng={paymentQrPng} caption={qrCaption} /> : null}
      </View>
    </View>
  );
}

export function PdfTaxRecommendationsFooter() {
  return (
    <View style={styles.recoDivider}>
      <Text style={styles.recoTitle}>{PDF_TAX_RECOMMENDATIONS_TITLE}</Text>
      {PDF_TAX_RECOMMENDATIONS.map((text, idx) => (
        <Text key={text.slice(0, 24)} style={styles.recoItem}>
          {idx + 1}. {text}
        </Text>
      ))}
    </View>
  );
}
