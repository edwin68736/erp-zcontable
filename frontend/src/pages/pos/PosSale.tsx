import { useCallback, useEffect, useMemo, useState } from 'react';

import { Link, Navigate } from 'react-router-dom';

import ProductPickerModal, { productLabel, productUnitPrice } from '../../components/ProductPickerModal';

import PosPaymentSplit, { type PosPaymentRow } from '../../components/pos/PosPaymentSplit';

import { isCashPosMethod } from '../../constants/posPayments';

import { posSalesService, type PosCartLine } from '../../services/posSales';

import type { Company } from '../../types/dashboard';

import type { FiscalSeriesItem } from '../../services/fiscalDocumentSeries';

import { auth } from '../../services/auth';

import { P } from '../../rbac/codes';

import PosReceiptModal from '../../components/pos/PosReceiptModal';
import PosQuickClientModal from '../../components/pos/PosQuickClientModal';

import { configService } from '../../services/config';

import type { PosSaleDetail } from '../../services/posSales';

import SearchableSelect from '../../components/SearchableSelect';

import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';



const newLineKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;



const newPaymentRow = (amount = ''): PosPaymentRow => ({

  key: newLineKey(),

  method: 'efectivo',

  amount,

  operationNumber: '',

});



const DEFAULT_KIND = 'sale_note' as const;



const PosSale = () => {

  const canEditPrice = auth.hasPermission(P.salesLinePriceEdit);

  const [companies, setCompanies] = useState<Company[]>([]);

  const [series, setSeries] = useState<FiscalSeriesItem[]>([]);

  const [companyId, setCompanyId] = useState('');

  const [kind, setKind] = useState<'sale_note' | 'boleta' | 'factura'>(DEFAULT_KIND);

  const [seriesId, setSeriesId] = useState('');

  const [lines, setLines] = useState<PosCartLine[]>([]);

  const [pickerOpen, setPickerOpen] = useState(false);

  const [manualDesc, setManualDesc] = useState('');

  const [manualPrice, setManualPrice] = useState('');

  const [manualQty, setManualQty] = useState('1');

  const [paymentRows, setPaymentRows] = useState<PosPaymentRow[]>(() => [newPaymentRow()]);

  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState('');

  const [issuedReceipt, setIssuedReceipt] = useState<PosSaleDetail | null>(null);

  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClientSeed, setQuickClientSeed] = useState('');
  const canAddClient = auth.hasPermission(P.salesCompaniesPick);
  const [firm, setFirm] = useState<{
    name?: string;
    ruc?: string;
    address?: string;
    phone?: string;
    email?: string;
    logo_url?: string;
    statement_bank_info?: string;
  }>({});



  const sunatForKind = kind === 'factura' ? '01' : kind === 'boleta' ? '03' : '00';



  const seriesForKind = useMemo(

    () => series.filter((s) => s.sunat_code === sunatForKind && s.active),

    [series, sunatForKind],

  );



  const showSeriesPicker = seriesForKind.length > 1;



  const totals = useMemo(() => {

    let sub = 0;

    let tax = 0;

    let tot = 0;

    for (const ln of lines) {

      const lineTot = Math.round(ln.quantity * ln.unitPrice * 100) / 100;

      const base = Math.round((lineTot / 1.18) * 100) / 100;

      const igv = Math.round((lineTot - base) * 100) / 100;

      sub += base;

      tax += igv;

      tot += lineTot;

    }

    return {

      subtotal: Math.round(sub * 100) / 100,

      tax: Math.round(tax * 100) / 100,

      total: Math.round(tot * 100) / 100,

    };

  }, [lines]);



  const paidSum = useMemo(() => {

    let s = 0;

    for (const r of paymentRows) {

      const n = Number(String(r.amount).replace(',', '.'));

      if (Number.isFinite(n) && n > 0) s += Math.round(n * 100) / 100;

    }

    return Math.round(s * 100) / 100;

  }, [paymentRows]);



  const paymentsMatch = totals.total > 0 && Math.abs(paidSum - totals.total) < 0.02;



  const resetSaleForm = useCallback(() => {

    setLines([]);

    setNotes('');

    setCompanyId('');

    setKind(DEFAULT_KIND);

    setPaymentRows([newPaymentRow()]);

    setError('');

  }, []);



  useEffect(() => {

    void Promise.all([

      posSalesService.listCompanies(),

      posSalesService.listSeries(),

      configService.getFirmBranding(),

    ])

      .then(([co, ser, branding]) => {

        setCompanies(co);

        setSeries(ser);

        setFirm({
          name: branding.name,
          ruc: branding.ruc,
          address: branding.address,
          phone: branding.phone,
          email: branding.email,
          logo_url: branding.logo_url,
          statement_bank_info: branding.statement_bank_info,
        });

      })

      .catch(() => setError('Error al cargar datos iniciales'));

  }, []);



  useEffect(() => {

    if (seriesForKind.length === 0) {

      setSeriesId('');

      return;

    }

    const match = seriesForKind.find((s) => String(s.id) === seriesId);

    if (!match) {

      setSeriesId(String(seriesForKind[0].id));

    }

  }, [seriesForKind, seriesId]);



  useEffect(() => {

    setPaymentRows((prev) => {

      if (prev.length !== 1) return prev;

      const amt = totals.total > 0 ? totals.total.toFixed(2) : '';

      if (prev[0].amount === amt) return prev;

      return [{ ...prev[0], amount: amt }];

    });

  }, [totals.total]);



  const handleUploadProof = async (key: string, file: File) => {

    setPaymentRows((prev) =>

      prev.map((r) => (r.key === key ? { ...r, proofUploading: true } : r)),

    );

    try {

      const url = await posSalesService.uploadPaymentProof(file);

      setPaymentRows((prev) =>

        prev.map((r) =>

          r.key === key ? { ...r, proofUrl: url, proofFile: file, proofUploading: false } : r,

        ),

      );

    } catch {

      setPaymentRows((prev) =>

        prev.map((r) => (r.key === key ? { ...r, proofUploading: false } : r)),

      );

      setError('No se pudo subir el comprobante de pago');

    }

  };



  const addProduct = (p: import('../../services/products').Product) => {

    const price = productUnitPrice(p);

    setLines((prev) => [

      ...prev,

      {

        key: newLineKey(),

        productId: p.id,

        description: productLabel(p),

        quantity: 1,

        unitPrice: price,

        isManual: false,

      },

    ]);

    setPickerOpen(false);

  };



  const addManual = () => {

    const desc = manualDesc.trim();

    const qty = Number(manualQty);

    const price = Number(manualPrice);

    if (!desc) {

      setError('Indique descripción del ítem manual');

      return;

    }

    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {

      setError('Cantidad y precio inválidos');

      return;

    }

    setLines((prev) => [

      ...prev,

      { key: newLineKey(), description: desc, quantity: qty, unitPrice: price, isManual: true },

    ]);

    setManualDesc('');

    setManualPrice('');

    setManualQty('1');

    setError('');

  };



  const updateLine = (key: string, patch: Partial<PosCartLine>) => {

    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  };



  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));



  const validatePayments = (): string | null => {

    if (paymentRows.length === 0) return 'Agregue al menos un método de pago';

    for (let i = 0; i < paymentRows.length; i++) {

      const r = paymentRows[i];

      const amt = Number(String(r.amount).replace(',', '.'));

      if (!Number.isFinite(amt) || amt <= 0) return `Pago ${i + 1}: monto inválido`;

      if (!isCashPosMethod(r.method) && !r.operationNumber.trim()) {

        return `Pago ${i + 1}: indique número de operación`;

      }

    }

    if (!paymentsMatch) {

      const diff = Math.round((totals.total - paidSum) * 100) / 100;

      return diff > 0

        ? `Faltan S/ ${diff.toFixed(2)} para igualar el total de la venta`

        : `Los pagos exceden el total en S/ ${Math.abs(diff).toFixed(2)}`;

    }

    return null;

  };



  const emit = async () => {

    const cid = Number(companyId);

    if (!cid) {

      setError('Seleccione el cliente');

      return;

    }

    if (lines.length === 0) {

      setError('Agregue al menos un ítem');

      return;

    }

    const payErr = validatePayments();

    if (payErr) {

      setError(payErr);

      return;

    }

    const sid = seriesForKind.length > 0 ? Number(seriesId || seriesForKind[0].id) : 0;

    if (!sid) {

      setError('No hay serie activa para este tipo de comprobante');

      return;

    }

    try {

      setSaving(true);

      setError('');

      const rec = await posSalesService.emit({

        kind,

        company_id: cid,

        series_id: sid,

        lines: lines.map((l) => ({

          product_id: l.productId,

          description: l.description,

          quantity: l.quantity,

          unit_price: l.unitPrice,

          is_manual: l.isManual,

        })),

        payments: paymentRows.map((r) => ({

          method: r.method,

          amount: Number(String(r.amount).replace(',', '.')),

          operation_number: r.operationNumber.trim() || undefined,

          proof_url: r.proofUrl,

        })),

        notes: notes.trim() || undefined,

      });

      const full = await posSalesService.getDetail(rec.id);

      setIssuedReceipt(full);

      resetSaleForm();

      window.dispatchEvent(

        new CustomEvent('miweb:toast', { detail: { type: 'success', message: `Emitido ${rec.number}` } }),

      );

    } catch (e: unknown) {

      const err = e as { response?: { data?: { error?: string } } };

      setError(err.response?.data?.error ?? 'No se pudo emitir el comprobante');

    } finally {

      setSaving(false);

    }

  };



  const companyOptions = useMemo(

    () =>

      companies.map((c) => ({

        value: String(c.id),

        label: `${c.business_name} (${c.ruc})`,

        searchText: `${c.business_name} ${c.ruc}`,

      })),

    [companies],

  );



  if (!auth.hasPermission(P.salesEmit)) {

    return <Navigate to="/pos/history" replace />;

  }



  return (

    <div className={PAGE_WORKSPACE_CLASS}>

      <div className="flex flex-wrap items-center justify-between gap-3">

        <div>

          <h1 className="text-xl font-semibold text-slate-800">Nueva venta</h1>

          <p className="text-sm text-slate-500">Emisión rápida de comprobantes</p>

        </div>

        <Link to="/pos/history" className="text-sm text-primary-700 font-medium">

          Ver historial →

        </Link>

      </div>



      {error ? <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div> : null}



      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 2xl:gap-8">

        <div className="space-y-4 xl:col-span-8 2xl:col-span-9 min-w-0">

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-3">

            <div className="flex flex-wrap gap-2">

              <button

                type="button"

                onClick={() => setPickerOpen(true)}

                className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium"

              >

                <i className="fas fa-search mr-1" /> Buscar producto

              </button>

            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 border-t pt-3">

              <input

                className="border rounded-lg px-3 py-2 text-sm lg:col-span-6"

                placeholder="Descripción manual"

                value={manualDesc}

                onChange={(e) => setManualDesc(e.target.value)}

              />

              <input

                className="border rounded-lg px-3 py-2 text-sm lg:col-span-2"

                placeholder="Cant."

                value={manualQty}

                onChange={(e) => setManualQty(e.target.value)}

              />

              <input

                className="border rounded-lg px-3 py-2 text-sm lg:col-span-2"

                placeholder="Precio"

                value={manualPrice}

                onChange={(e) => setManualPrice(e.target.value)}

              />

              <button

                type="button"

                onClick={addManual}

                className="px-3 py-2 rounded-lg border bg-primary-600 text-white text-sm font-medium lg:col-span-2"

              >

                + Agregar

              </button>

            </div>

          </section>



          <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">

            <table className="min-w-full w-full text-sm">

              <thead className="bg-slate-50 text-slate-600">

                <tr>

                  <th className="text-left px-3 py-2">Descripción</th>

                  <th className="text-right px-2 py-2 w-20">Cant.</th>

                  <th className="text-right px-2 py-2 w-24">Precio</th>

                  <th className="text-right px-3 py-2 w-24">Total</th>

                  <th className="w-10" />

                </tr>

              </thead>

              <tbody className="divide-y">

                {lines.map((ln) => (

                  <tr key={ln.key}>

                    <td className="px-3 py-2">

                      {ln.description}

                      {ln.isManual ? (

                        <span className="ml-1 text-[10px] text-amber-700 bg-amber-50 px-1 rounded">manual</span>

                      ) : null}

                    </td>

                    <td className="px-2 py-2">

                      <input

                        type="number"

                        min={0.01}

                        step="any"

                        className="w-full border rounded px-2 py-1 text-right text-xs"

                        value={ln.quantity}

                        onChange={(e) => updateLine(ln.key, { quantity: Number(e.target.value) || 0 })}

                      />

                    </td>

                    <td className="px-2 py-2">

                      <input

                        type="number"

                        min={0}

                        step="0.01"

                        disabled={!canEditPrice && !ln.isManual}

                        className="w-full border rounded px-2 py-1 text-right text-xs disabled:bg-slate-50"

                        value={ln.unitPrice}

                        onChange={(e) => updateLine(ln.key, { unitPrice: Number(e.target.value) || 0 })}

                      />

                    </td>

                    <td className="px-3 py-2 text-right tabular-nums">

                      {(ln.quantity * ln.unitPrice).toFixed(2)}

                    </td>

                    <td className="px-2 py-2">

                      <button type="button" className="text-red-600 text-xs" onClick={() => removeLine(ln.key)}>

                        ×

                      </button>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

            {lines.length === 0 ? (

              <p className="text-sm text-slate-500 text-center py-12 min-h-[200px] flex items-center justify-center">

                Carrito vacío — busque un producto o agregue un ítem manual

              </p>

            ) : null}

          </section>

        </div>



        <div className="space-y-4 xl:col-span-4 2xl:col-span-3 xl:sticky xl:top-4 xl:self-start min-w-0">

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-3">

            <label className="block text-sm font-medium text-slate-700">Cliente</label>

            <SearchableSelect

              value={companyId}

              onChange={setCompanyId}

              options={[{ value: '', label: 'Seleccione cliente…' }, ...companyOptions]}

              placeholder="Buscar cliente"

              onQueryChange={setClientSearchQuery}

              emptyStateAction={
                canAddClient && clientSearchQuery.trim().length >= 2
                  ? {
                      label: 'Agregar nuevo cliente',
                      onClick: () => {
                        setQuickClientSeed(clientSearchQuery.trim());
                        setQuickClientOpen(true);
                      },
                    }
                  : undefined
              }
            />
            {canAddClient ? (
              <button
                type="button"
                onClick={() => {
                  setQuickClientSeed('');
                  setQuickClientOpen(true);
                }}
                className="text-sm font-medium text-primary-700 hover:text-primary-800"
              >
                <i className="fas fa-user-plus mr-1 text-xs" />
                Agregar nuevo cliente
              </button>
            ) : null}

            <label className="block text-sm font-medium text-slate-700">Tipo de comprobante</label>

            <select

              className="w-full border rounded-lg px-3 py-2 text-sm"

              value={kind}

              onChange={(e) => setKind(e.target.value as typeof kind)}

            >

              <option value="sale_note">Nota de venta</option>

              <option value="boleta">Boleta</option>

              <option value="factura">Factura</option>

            </select>

            {showSeriesPicker ? (

              <>

                <label className="block text-sm font-medium text-slate-700">Serie</label>

                <select

                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"

                  value={seriesId}

                  onChange={(e) => setSeriesId(e.target.value)}

                >

                  {seriesForKind.map((s) => (

                    <option key={s.id} value={String(s.id)}>

                      {s.series} → próx. {s.next_number}

                    </option>

                  ))}

                </select>

              </>

            ) : seriesForKind.length === 0 ? (

              <p className="text-xs text-red-600">Sin serie activa para este tipo de comprobante</p>

            ) : null}



            <PosPaymentSplit

              rows={paymentRows}

              saleTotal={totals.total}

              onChange={setPaymentRows}

              onUploadProof={handleUploadProof}

            />



            <textarea

              className="w-full border rounded-lg px-3 py-2 text-sm"

              rows={2}

              placeholder="Notas (opcional)"

              value={notes}

              onChange={(e) => setNotes(e.target.value)}

            />

          </section>



          <section className="rounded-xl border border-primary-200 bg-primary-50/40 p-4 space-y-2">

            <div className="flex justify-between text-sm">

              <span>Subtotal</span>

              <span className="tabular-nums">S/ {totals.subtotal.toFixed(2)}</span>

            </div>

            <div className="flex justify-between text-sm">

              <span>IGV (18%)</span>

              <span className="tabular-nums">S/ {totals.tax.toFixed(2)}</span>

            </div>

            <div className="flex justify-between text-lg font-bold text-primary-800 border-t border-primary-200 pt-2">

              <span>Total</span>

              <span className="tabular-nums">S/ {totals.total.toFixed(2)}</span>

            </div>

            <button

              type="button"

              disabled={saving || lines.length === 0 || !paymentsMatch || totals.total <= 0}

              onClick={() => void emit()}

              className="w-full mt-2 py-3 rounded-full bg-primary-600 text-white font-semibold disabled:opacity-50"

            >

              {saving ? 'Emitiendo…' : 'Emitir comprobante'}

            </button>

          </section>

        </div>

      </div>



      <ProductPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addProduct} />



      <PosReceiptModal

        open={Boolean(issuedReceipt)}

        receipt={issuedReceipt}

        firm={firm}

        variant="post_sale"

        onClose={() => {

          setIssuedReceipt(null);

        }}

      />

      <PosQuickClientModal
        open={quickClientOpen}
        initialSearch={quickClientSeed}
        onClose={() => setQuickClientOpen(false)}
        onCreated={(c) => {
          setCompanies((prev) => {
            if (prev.some((x) => x.id === c.id)) return prev;
            return [...prev, c].sort((a, b) => a.business_name.localeCompare(b.business_name));
          });
          setCompanyId(String(c.id));
        }}
      />

    </div>

  );

};



export default PosSale;


