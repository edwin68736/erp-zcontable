import { useMemo } from 'react';
import { isCashPosMethod, POS_PAYMENT_METHODS, type PosPaymentMethod } from '../../constants/posPayments';
import { resolveBackendUrl } from '../../api/client';

export type PosPaymentRow = {
  key: string;
  method: PosPaymentMethod;
  amount: string;
  operationNumber: string;
  proofUrl?: string;
  proofFile?: File | null;
  proofUploading?: boolean;
};

type Props = {
  rows: PosPaymentRow[];
  saleTotal: number;
  onChange: (rows: PosPaymentRow[]) => void;
  onUploadProof: (key: string, file: File) => Promise<void>;
};

const PosPaymentSplit = ({ rows, saleTotal, onChange, onUploadProof }: Props) => {
  const paidSum = useMemo(() => {
    let s = 0;
    for (const r of rows) {
      const n = Number(String(r.amount).replace(',', '.'));
      if (Number.isFinite(n) && n > 0) s += Math.round(n * 100) / 100;
    }
    return Math.round(s * 100) / 100;
  }, [rows]);

  const diff = Math.round((saleTotal - paidSum) * 100) / 100;
  const paymentsMatch = saleTotal > 0 && Math.abs(diff) < 0.02;

  const updateRow = (key: string, patch: Partial<PosPaymentRow>) => {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const remainder = Math.max(0, Math.round((saleTotal - paidSum) * 100) / 100);
    onChange([
      ...rows,
      {
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        method: remainder > 0 ? 'transferencia' : 'efectivo',
        amount: remainder > 0 ? remainder.toFixed(2) : '',
        operationNumber: '',
      },
    ]);
  };

  const removeRow = (key: string) => {
    if (rows.length <= 1) return;
    onChange(rows.filter((r) => r.key !== key));
  };

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">Pagos</span>
        <button
          type="button"
          onClick={addRow}
          className="text-xs font-medium text-primary-700 hover:text-primary-800"
        >
          + Otro método
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row, idx) => {
          const needsExtra = !isCashPosMethod(row.method);
          return (
            <div key={row.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">Pago {idx + 1}</span>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Método</label>
                  <select
                    className="w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                    value={row.method}
                    onChange={(e) =>
                      updateRow(row.key, { method: e.target.value as PosPaymentMethod, operationNumber: '' })
                    }
                  >
                    {POS_PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Monto (S/)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="w-full border rounded-lg px-2 py-1.5 text-sm bg-white text-right tabular-nums"
                    value={row.amount}
                    onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                  />
                </div>
              </div>
              {needsExtra ? (
                <div className="space-y-2 pt-1">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">N.º operación / transacción</label>
                    <input
                      className="w-full border rounded-lg px-2 py-1.5 text-sm bg-white"
                      placeholder="Ej. 00123456"
                      value={row.operationNumber}
                      onChange={(e) => updateRow(row.key, { operationNumber: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Comprobante de pago</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-300 bg-white text-xs font-medium cursor-pointer hover:bg-slate-50">
                        <i className={`fas ${row.proofUploading ? 'fa-spinner fa-spin' : 'fa-paperclip'}`} />
                        {row.proofUploading ? 'Subiendo…' : 'Adjuntar'}
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          disabled={row.proofUploading}
                          onChange={(ev) => {
                            const f = ev.target.files?.[0];
                            if (f) void onUploadProof(row.key, f);
                            ev.currentTarget.value = '';
                          }}
                        />
                      </label>
                      {row.proofUrl ? (
                        <a
                          href={resolveBackendUrl(row.proofUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary-700 font-medium"
                        >
                          Ver adjunto
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">Opcional</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        className={`rounded-lg px-3 py-2 text-sm ${
          paymentsMatch
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
            : 'bg-amber-50 text-amber-900 border border-amber-200'
        }`}
      >
        <div className="flex justify-between tabular-nums">
          <span>Pagado</span>
          <span>S/ {paidSum.toFixed(2)}</span>
        </div>
        <div className="flex justify-between tabular-nums font-medium">
          <span>Total venta</span>
          <span>S/ {saleTotal.toFixed(2)}</span>
        </div>
        {!paymentsMatch && saleTotal > 0 ? (
          <p className="text-xs mt-1">
            {diff > 0 ? `Faltan S/ ${diff.toFixed(2)}` : `Sobran S/ ${Math.abs(diff).toFixed(2)}`} para cuadrar el total.
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default PosPaymentSplit;
