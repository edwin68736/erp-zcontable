export const POS_PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'yape', label: 'Yape' },
  { value: 'plin', label: 'Plin' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'otro', label: 'Otro' },
] as const;

export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number]['value'];

export const isCashPosMethod = (method: string) => {
  const m = method.trim().toLowerCase();
  return m === 'efectivo' || m === 'cash' || m === 'contado';
};
