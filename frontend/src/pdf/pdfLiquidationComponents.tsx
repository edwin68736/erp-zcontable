import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import type { FirmConfig } from '../types/dashboard';
import { PDF_LIQ } from './pdfLiquidationTheme';

export function PdfSectionBar({
  title,
  light = false,
  minPresenceAhead,
  breakBefore = false,
}: {
  title: string;
  light?: boolean;
  minPresenceAhead?: number;
  /** Fuerza salto de página antes de la barra (p. ej. honorarios en hoja 2). */
  breakBefore?: boolean;
}) {
  const presenceProps = typeof minPresenceAhead === 'number' ? { minPresenceAhead } : {};
  const breakProps = breakBefore ? { break: true as const } : {};

  return (
    <View
      {...presenceProps}
      {...breakProps}
      style={{
        backgroundColor: light ? PDF_LIQ.blueLight : PDF_LIQ.blue,
        paddingVertical: 5,
        paddingHorizontal: 8,
        marginBottom: 6,
        marginTop: light ? 0 : 4,
      }}
    >
      <Text
        style={{
          color: PDF_LIQ.white,
          fontSize: light ? 8 : 9,
          fontWeight: 700,
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {title}
      </Text>
    </View>
  );
}

/**
 * Bloque de sección PDF (título + contenido).
 * No usar minPresenceAhead aquí: react-pdf considera todos los hermanos siguientes
 * y puede empujar bloques largos (PDT 621) a la página siguiente dejando huecos en blanco.
 */
export function PdfSectionBlock({
  title,
  light = false,
  children,
}: {
  title: string;
  light?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ marginBottom: 8 }}>
      <PdfSectionBar title={title} light={light} />
      {children}
    </View>
  );
}

/** Fila total resaltada: etiqueta | S/ | monto (fondo amarillo, como liquidación legacy). */
export function PdfHighlightedTotalRow({ label, amount }: { label: string; amount: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: PDF_LIQ.highlightYellow,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: PDF_LIQ.text,
        marginTop: 6,
      }}
    >
      <View
        style={{
          flex: 1,
          paddingVertical: 6,
          paddingHorizontal: 8,
          borderRightWidth: 1,
          borderRightColor: PDF_LIQ.text,
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: 8,
            fontWeight: 700,
            color: PDF_LIQ.text,
            textTransform: 'uppercase',
            textAlign: 'right',
          }}
        >
          {label}
        </Text>
      </View>
      <View
        style={{
          width: 26,
          paddingVertical: 6,
          borderRightWidth: 1,
          borderRightColor: PDF_LIQ.text,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 8, fontWeight: 700, color: PDF_LIQ.text }}>S/</Text>
      </View>
      <View
        style={{
          width: 76,
          paddingVertical: 6,
          paddingHorizontal: 8,
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 9, fontWeight: 700, color: PDF_LIQ.text, textAlign: 'right' }}>{amount}</Text>
      </View>
    </View>
  );
}

type PdfLiquidationHeaderProps = {
  firm: FirmConfig | null;
  logoPng: Blob | null;
  liqNumber: string;
};

/** Encabezado: logo + datos del estudio a la izquierda; recuadro RUC / título / número a la derecha. */
export function PdfLiquidationHeader({ firm, logoPng, liqNumber }: PdfLiquidationHeaderProps) {
  const firmName = firm?.name?.trim() || 'Estudio contable';
  const firmRuc = firm?.ruc?.trim() || '';
  const firmAddr = firm?.address?.trim() || '';
  const firmPhone = firm?.phone?.trim() || '';
  const firmEmail = firm?.email?.trim() || '';

  return (
    <View style={pdfLiquidationStyles.header}>
      <View style={pdfLiquidationStyles.headerFirmCol}>
        {logoPng ? (
          <Image style={pdfLiquidationStyles.logo} src={logoPng} />
        ) : (
          <Text style={pdfLiquidationStyles.firmName}>{firmName}</Text>
        )}
        {firmAddr ? <Text style={pdfLiquidationStyles.firmContact}>{firmAddr}</Text> : null}
        {firmPhone ? <Text style={pdfLiquidationStyles.firmContact}>{firmPhone}</Text> : null}
        {firmEmail ? <Text style={pdfLiquidationStyles.firmContact}>{firmEmail}</Text> : null}
      </View>

      <View style={pdfLiquidationStyles.headerDocBox}>
        {firmRuc ? (
          <View style={pdfLiquidationStyles.headerDocRow}>
            <Text style={pdfLiquidationStyles.headerDocRuc}>RUC {firmRuc}</Text>
          </View>
        ) : null}
        <View style={pdfLiquidationStyles.headerDocTitleWrap}>
          <Text style={pdfLiquidationStyles.headerDocTitle}>Liquidación de impuestos</Text>
        </View>
        <View style={[pdfLiquidationStyles.headerDocRow, pdfLiquidationStyles.headerDocRowLast]}>
          <Text style={pdfLiquidationStyles.headerDocNumber}>{liqNumber}</Text>
        </View>
      </View>
    </View>
  );
}

export function PdfClientInfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: PDF_LIQ.text,
        minHeight: 18,
      }}
    >
      <View style={pdfLiquidationStyles.clientLabelCell}>
        <Text style={pdfLiquidationStyles.clientLabelText}>{label}:</Text>
      </View>
      <View style={pdfLiquidationStyles.clientValueCell}>
        <Text style={pdfLiquidationStyles.clientValueText}>{value}</Text>
      </View>
    </View>
  );
}

export const pdfLiquidationStyles = StyleSheet.create({
  page: { paddingTop: 24, paddingBottom: 36, paddingHorizontal: 28, fontSize: 9, color: PDF_LIQ.text },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerFirmCol: { flex: 1, minWidth: 0, paddingRight: 14 },
  logo: { width: 118, height: 42, objectFit: 'contain', marginBottom: 4 },
  firmName: { fontSize: 12, fontWeight: 700, color: PDF_LIQ.blueDark, marginBottom: 4 },
  firmContact: { fontSize: 7.5, color: PDF_LIQ.textMuted, lineHeight: 1.35, marginTop: 2 },
  headerDocBox: {
    width: '38%',
    minWidth: 148,
    borderWidth: 1,
    borderColor: PDF_LIQ.text,
    overflow: 'hidden',
  },
  headerDocRow: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: PDF_LIQ.white,
    borderBottomWidth: 1,
    borderBottomColor: PDF_LIQ.text,
    alignItems: 'center',
  },
  headerDocRowLast: { borderBottomWidth: 0 },
  headerDocRuc: { fontSize: 9, fontWeight: 700, color: PDF_LIQ.text, textAlign: 'center' },
  headerDocTitleWrap: {
    backgroundColor: PDF_LIQ.blue,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: PDF_LIQ.text,
  },
  headerDocTitle: {
    color: PDF_LIQ.white,
    fontSize: 8,
    fontWeight: 700,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  headerDocNumber: { fontSize: 9, fontWeight: 700, color: PDF_LIQ.text, textAlign: 'center' },
  clientBox: {
    borderWidth: 1,
    borderColor: PDF_LIQ.text,
    marginBottom: 8,
    overflow: 'hidden',
  },
  clientLabelCell: {
    width: '27%',
    backgroundColor: PDF_LIQ.blue,
    paddingVertical: 3,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  clientLabelText: {
    color: PDF_LIQ.white,
    fontSize: 7,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  clientValueCell: {
    width: '73%',
    backgroundColor: PDF_LIQ.white,
    paddingVertical: 3,
    paddingHorizontal: 8,
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: PDF_LIQ.text,
  },
  clientValueText: { fontSize: 8, color: PDF_LIQ.text, lineHeight: 1.2, textTransform: 'uppercase' },
  introBar: {
    backgroundColor: PDF_LIQ.grayBg,
    paddingVertical: 7,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: PDF_LIQ.grayBorder,
  },
  introText: { fontSize: 8, color: PDF_LIQ.text, lineHeight: 1.35 },
});
