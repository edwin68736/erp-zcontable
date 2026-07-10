import { writeFileSync } from 'node:fs';
import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { TaxSettlementPdfDocument } from '../src/pdf/taxSettlementDocument';
import { computeTaxSettlementSections, defaultTaxSections } from '../src/utils/taxSettlementSections';

const base = defaultTaxSections(2026);
const sections = computeTaxSettlementSections({
  ...base,
  pdt621: {
    ...base.pdt621!,
    enabled: true,
    igv_aplicable_ventas: ['18', '10.5'],
    ventas_netas_18: { base: 50000, no_gravadas: 0, impuesto: 9000, total: 59000 },
    ventas_netas_105: { base: 12000, no_gravadas: 0, impuesto: 1260, total: 13260 },
    notas_credito_18: { base: 1000, no_gravadas: 0, impuesto: 180, total: 1180 },
    notas_credito_105: { base: 500, no_gravadas: 0, impuesto: 52.5, total: 552.5 },
    compras_18: { base: 30000, no_gravadas: 0, impuesto: 5400, total: 35400 },
    compras_105: { base: 8000, no_gravadas: 0, impuesto: 840, total: 8840 },
    impuesto_periodo: 4087.5,
    credito_periodo_anterior: 0,
    saldo_favor: 0,
    percepciones_periodo: 100,
    percepciones_anteriores: 50,
    retenciones_periodo: 200,
    retenciones_anteriores: 75,
    saldo_favor_final: 0,
    renta_ventas_base: 45000,
    renta_ventas_impuesto: 450,
    renta_saldo_favor_itan: 0,
    renta_impuesto_a_pagar: 450,
    impuesto_a_pagar: 4537.5,
  },
  pdt601: {
    ...base.pdt601!,
    enabled: true,
    essalud: 1200,
    onp: 80,
    afp: 320,
    rta_4ta: 150,
    rta_5ta: 90,
  },
  itan: {
    ...base.itan!,
    enabled: true,
    impuesto: 250,
  },
});

const settlement = {
  id: 1,
  company_id: 1,
  status: 'borrador',
  number: 'LI-202606',
  issue_date: '2026-07-07',
  liquidation_period: '2026-06',
  period_label: 'JUNIO 2026',
  pdt621_json: JSON.stringify(sections),
  total_honorarios: 0,
  total_impuestos: 0,
  total_general: 0,
  company: {
    id: 1,
    business_name: 'CONSTRUCTORA CAP 10 HERMANOS & ASOCIADOS S.R.L.',
    ruc: '20613653920',
    code: 'CAP10',
  },
  lines: [
    { id: 1, line_type: 'honorario', concept: 'Honorarios mensuales', amount: 850, sort_order: 1, period_ym: '2026-06' },
    { id: 2, line_type: 'document_ref', concept: 'Deuda pendiente', amount: 120, sort_order: 2, period_ym: '2026-05' },
  ],
};

const firm = {
  name: 'Z CONTABLE & ASOCIADOS S.A.C.',
  ruc: '20123456789',
  address: 'Av. Principal 123, Lima, Perú',
  phone: '+51 999 888 777',
  email: 'contacto@zcontable.com',
  statement_bank_info: 'BCP — Cta. Corriente Soles\n0011-0123-4567890123\nCCI: 002-123-456789012345-67',
  statement_payment_observations: 'Enviar constancia de pago al correo del estudio.',
  statement_payment_qr_caption: 'Paga aquí con Yape',
} as const;

const el = React.createElement(TaxSettlementPdfDocument, {
  settlement: settlement as never,
  firm: firm as never,
  logoPng: null,
  footerAssets: null,
});

const blob = await pdf(el).toBlob();
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync('debug-liq.pdf', buf);
console.log('Wrote debug-liq.pdf', buf.length, 'bytes');
