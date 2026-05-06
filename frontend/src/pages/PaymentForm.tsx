import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { dateInputToRFC3339MidnightPeru, peruDateInputFromApiDate } from '../utils/peruDates';
import { companiesService } from '../services/companies';
import { documentsService } from '../services/documents';
import { paymentsService, type PaymentTukifacIssuePayload, type PaymentUpsertInput } from '../services/payments';
import { taxSettlementsService, type SettlementPaymentSuggestion } from '../services/taxSettlements';
import { auth } from '../services/auth';
import {
  ensureTukifacSeriesCached,
  getCachedDocumentSeries,
  getCachedSaleNoteSeries,
  pickDefaultSeries,
} from '../services/tukifacSeriesCache';
import type { Company, Document } from '../types/dashboard';
import SearchableSelect from '../components/SearchableSelect';
import TukifacIssueLinksDialog from '../components/TukifacIssueLinksDialog';
import { resolveBackendUrl } from '../api/client';
import { parseTukifacReceiptViewLinks, type TukifacReceiptViewLinks } from '../utils/tukifacReceiptLinks';

function getErrorMessage(e: unknown): string {
  if (!e || typeof e !== 'object') return 'Error al guardar el pago';
  if (!('response' in e)) return 'Error al guardar el pago';
  const maybe = e as { response?: { data?: unknown } };
  const data = maybe.response?.data;
  if (data && typeof data === 'object' && 'error' in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return 'Error al guardar el pago';
}

function getTukifacErrorMessage(e: unknown): string {
  if (!e || typeof e !== 'object') return 'Error al enviar el comprobante a Tukifac';
  if (!('response' in e)) return 'Error al enviar el comprobante a Tukifac';
  const maybe = e as { response?: { data?: unknown } };
  const data = maybe.response?.data;
  if (data && typeof data === 'object' && 'error' in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return 'Error al enviar el comprobante a Tukifac';
}

function newManualAllocKey(): string {
  return `alloc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function truncateText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Etiqueta en selects de deuda: descripción, monto y estado (pendiente/parcial, etc.).
 * No incluye número ni external_id (códigos); esos sí entran en searchText para buscar.
 */
function debtSelectLabel(d: Document): string {
  const descRaw = (d.description ?? '').trim();
  const desc = descRaw ? truncateText(descRaw, 80) : 'Sin descripción';
  const amt = Number.isFinite(d.total_amount) ? d.total_amount.toFixed(2) : '0.00';
  const status = (d.status ?? '').trim();
  const vcto = d.due_date && d.due_date.length >= 10 ? d.due_date.slice(0, 10) : '';
  const parts: string[] = [desc, `S/ ${amt}`];
  if (status) parts.push(status);
  if (vcto) parts.push(`vcto ${vcto}`);
  return parts.join(' · ');
}

function debtSelectSearchText(d: Document): string {
  return [d.number, d.external_id, d.description, d.type, d.status, d.due_date].filter(Boolean).join(' ');
}

/** Misma idea que `debtSelectLabel`, para filas sugeridas antes de que el documento aparezca en `documents`. */
function debtSelectLabelFromSuggestion(l: Pick<SettlementPaymentSuggestion, 'concept' | 'amount'>): string {
  const descRaw = (l.concept ?? '').trim();
  const desc = descRaw ? truncateText(descRaw, 80) : 'Sin descripción';
  const amt = Number.isFinite(l.amount) ? l.amount.toFixed(2) : '0.00';
  return [desc, `S/ ${amt}`, 'pendiente'].join(' · ');
}

function debtSelectSearchTextFromSuggestion(l: SettlementPaymentSuggestion): string {
  return [l.document_number, l.concept, String(l.document_id)].filter(Boolean).join(' ');
}

type ManualAllocRow = { key: string; doc: string; amt: string };

/** Tipo de pago inferido en altas: según FIFO, deuda única o líneas manuales con monto. */
function derivePaymentType(
  applyMode: 'single' | 'fifo' | 'manual',
  documentId: string,
  manualAlloc: ManualAllocRow[],
): 'applied' | 'on_account' {
  if (applyMode === 'fifo') return 'applied';
  if (applyMode === 'single') {
    const n = Number(documentId);
    return Number.isFinite(n) && n > 0 ? 'applied' : 'on_account';
  }
  const lines = manualAlloc.filter((l) => l.doc.trim() && Number(l.amt) > 0);
  return lines.length > 0 ? 'applied' : 'on_account';
}

const PaymentForm = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const paymentId = params.id ? Number(params.id) : null;
  const isEdit = Boolean(paymentId);
  const taxSettlementIdFromUrl = searchParams.get('tax_settlement_id');

  const role = auth.getRole() ?? '';
  const canCreate = useMemo(
    () => role === 'Administrador' || role === 'Supervisor' || role === 'Contador' || role === 'Asistente',
    [role],
  );
  const canEdit = useMemo(() => role === 'Administrador' || role === 'Supervisor' || role === 'Contador', [role]);
  const canUpsert = isEdit ? canEdit : canCreate;
  const canIssueTukifac = useMemo(
    () => role === 'Administrador' || role === 'Supervisor' || role === 'Contador',
    [role],
  );

  const peruvianToday = useMemo(() => formatInTimeZone(new Date(), 'America/Lima', 'yyyy-MM-dd'), []);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [editLocked, setEditLocked] = useState(false);

  const [companyId, setCompanyId] = useState(searchParams.get('company_id') ?? '');
  const [documentId, setDocumentId] = useState(searchParams.get('document_id') ?? '');
  /** Solo edición: tipo guardado en servidor (en altas se usa derivePaymentType). */
  const [loadedPaymentType, setLoadedPaymentType] = useState<'applied' | 'on_account' | null>(null);
  const [date, setDate] = useState(() => (isEdit ? '' : peruvianToday));
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [attachment, setAttachment] = useState('');
  const [notes, setNotes] = useState('');
  const [applyMode, setApplyMode] = useState<'single' | 'fifo' | 'manual'>('single');
  const [manualAlloc, setManualAlloc] = useState<ManualAllocRow[]>([{ key: newManualAllocKey(), doc: '', amt: '' }]);
  /** Pago vinculado a liquidación emitida (precarga imputaciones; se anula si cambia la empresa). */
  const [settlementLink, setSettlementLink] = useState<{ id: number; companyId: number; number: string } | null>(null);
  const [settlementLoadError, setSettlementLoadError] = useState('');
  /** Opciones extra para selects de deuda (id → etiqueta) cuando el listado aún no incluye ese document_id. */
  const [allocDocHints, setAllocDocHints] = useState<Array<{ id: number; label: string; searchText: string }>>([]);
  const settlementLoadedRef = useRef(false);
  const lastSettlementParamRef = useRef<string | null>(null);

  const [tukifacKind, setTukifacKind] = useState<'boleta' | 'factura' | 'sale_note'>('sale_note');
  const [tukifacSerie, setTukifacSerie] = useState('');
  const [tukifacSaleNoteSeriesId, setTukifacSaleNoteSeriesId] = useState('');
  const [seriesRefresh, setSeriesRefresh] = useState(0);
  /** Tras emitir Tukifac desde este formulario, enlaces ticket / PDF antes de ir al listado. */
  const [tukifacPostSaveLinks, setTukifacPostSaveLinks] = useState<TukifacReceiptViewLinks | null>(null);

  const effectivePaymentType: 'applied' | 'on_account' = isEdit
    ? (loadedPaymentType ?? 'on_account')
    : derivePaymentType(applyMode, documentId, manualAlloc);

  /** Nuevo pago desde liquidación emitida: siempre se emite comprobante en Tukifac tras guardar el pago. */
  const showComprobanteTukifac =
    !isEdit && Boolean(settlementLink) && effectivePaymentType === 'applied' && canIssueTukifac;

  const isFromTaxSettlement = Boolean((taxSettlementIdFromUrl ?? '').trim());
  const hideCompanyField = isFromTaxSettlement && !isEdit;

  const settlementCompanyDisplay = useMemo(() => {
    const id = Number(companyId);
    if (!Number.isFinite(id) || id <= 0) return '—';
    const c = companies.find((x) => x.id === id);
    return c?.business_name?.trim() || `ID ${id}`;
  }, [companies, companyId]);

  const singleDebtSelectOptions = useMemo(() => {
    const fromDocs = documents.map((d) => ({
      value: String(d.id),
      label: debtSelectLabel(d),
      searchText: debtSelectSearchText(d),
    }));
    const seen = new Set(fromDocs.map((o) => o.value));
    const fromHints = allocDocHints
      .filter((h) => !seen.has(String(h.id)))
      .map((h) => ({
        value: String(h.id),
        label: h.label,
        searchText: h.searchText,
      }));
    return [{ value: '', label: 'Selecciona una deuda…' }, ...fromDocs, ...fromHints];
  }, [documents, allocDocHints]);

  const manualDebtSelectOptions = useMemo(() => {
    const fromDocs = documents.map((d) => ({
      value: String(d.id),
      label: debtSelectLabel(d),
      searchText: debtSelectSearchText(d),
    }));
    const seen = new Set(fromDocs.map((o) => o.value));
    const fromHints = allocDocHints
      .filter((h) => !seen.has(String(h.id)))
      .map((h) => ({
        value: String(h.id),
        label: h.label,
        searchText: h.searchText,
      }));
    return [{ value: '', label: '—' }, ...fromDocs, ...fromHints];
  }, [documents, allocDocHints]);

  const methodOptions = useMemo(() => {
    const base = [
      { value: 'Efectivo', label: 'Efectivo' },
      { value: 'Yape', label: 'Yape' },
      { value: 'Plin', label: 'Plin' },
      { value: 'Transferencia', label: 'Transferencia' },
    ];

    const hasCurrent = method.trim() && base.some((o) => o.value === method.trim());
    return [
      { value: '', label: 'Selecciona…' },
      ...(hasCurrent ? [] : method.trim() ? [{ value: method.trim(), label: method.trim() }] : []),
      ...base,
    ];
  }, [method]);

  const manualImputationSum = useMemo(
    () =>
      manualAlloc.reduce((s, l) => {
        const a = Number(l.amt);
        return s + (Number.isFinite(a) && a > 0 ? a : 0);
      }, 0),
    [manualAlloc],
  );

  const amountNumForSummary = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) ? n : 0;
  }, [amount]);

  const selectedDebtTotal = useMemo(() => {
    if (applyMode !== 'single' || !documentId) return null;
    const d = documents.find((x) => String(x.id) === documentId);
    if (!d || !Number.isFinite(d.total_amount)) return null;
    return d.total_amount;
  }, [applyMode, documentId, documents]);

  const handleAttachmentFileChange = async (file: File | null) => {
    if (!file) return;
    if (!canUpsert) {
      setError('No tienes permisos para realizar esta acción');
      return;
    }
    try {
      setUploading(true);
      setError('');
      const url = await paymentsService.uploadAttachment(file);
      setAttachment(url);
    } catch (e) {
      console.error(e);
      setError(getErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError('');

        const [comps, pay] = await Promise.all([
          companiesService.list(),
          isEdit && paymentId ? paymentsService.get(paymentId) : Promise.resolve(null),
        ]);

        setCompanies(comps);

        if (pay) {
          const normalizedType = (pay.type ?? '').toLowerCase().trim();
          const hasAlloc = Array.isArray(pay.allocations) && pay.allocations.length > 0;
          if (pay.document_id || normalizedType === 'applied' || hasAlloc) {
            setEditLocked(true);
            setError('No se puede editar un pago aplicado a deudas o con imputaciones');
            return;
          }
          setCompanyId(String(pay.company_id ?? ''));
          setDocumentId(pay.document_id ? String(pay.document_id) : '');
          setLoadedPaymentType(
            pay.type === 'applied' || pay.type === 'on_account' ? pay.type : pay.document_id ? 'applied' : 'on_account',
          );
          setDate(peruDateInputFromApiDate(pay.date));
          setAmount(Number.isFinite(pay.amount) ? pay.amount.toFixed(2) : '');
          setMethod(pay.method ?? '');
          setReference(pay.reference ?? '');
          setAttachment(pay.attachment ?? '');
          setNotes(pay.notes ?? '');
        }
      } catch (e) {
        console.error(e);
        setError(isEdit ? 'Error al cargar el pago' : 'Error al cargar datos');
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [isEdit, paymentId]);

  useEffect(() => {
    if (!isEdit) setLoadedPaymentType(null);
  }, [isEdit]);

  useEffect(() => {
    const companyIdNum = Number(companyId);
    if (!Number.isFinite(companyIdNum) || companyIdNum <= 0) {
      setDocuments([]);
      return;
    }

    const run = async () => {
      try {
        const list = await documentsService.list({ company_id: String(companyIdNum) });
        setDocuments(list.filter((d) => d.status !== 'pagado' && d.status !== 'anulado'));
      } catch (e) {
        console.error(e);
        setDocuments([]);
      }
    };

    run();
  }, [companyId]);

  useEffect(() => {
    if (isEdit) return;
    const param = taxSettlementIdFromUrl?.trim() ?? '';
    if (lastSettlementParamRef.current !== param) {
      settlementLoadedRef.current = false;
      lastSettlementParamRef.current = param || null;
    }
    if (!param) {
      setAllocDocHints([]);
      setSettlementLoadError('');
      settlementLoadedRef.current = false;
      return;
    }
    if (settlementLoadedRef.current) return;
    const sid = Number(param);
    if (!Number.isFinite(sid) || sid <= 0) return;
    let cancelled = false;
    void (async () => {
      try {
        setSettlementLoadError('');
        const st = await taxSettlementsService.get(sid);
        if (cancelled) return;
        if (st.status !== 'emitida') {
          settlementLoadedRef.current = true;
          window.dispatchEvent(
            new CustomEvent('miweb:toast', {
              detail: {
                type: 'warning',
                message:
                  'No se pueden registrar pagos vinculados a una liquidación en borrador. Emítala primero; puede registrar un pago para la empresa sin ese vínculo.',
              },
            }),
          );
          navigate(`/payments/new?company_id=${st.company_id}`, { replace: true });
          return;
        }
        const sug = await taxSettlementsService.paymentSuggestions(sid);
        if (cancelled) return;
        settlementLoadedRef.current = true;
        setCompanyId(String(sug.company_id));
        setApplyMode('manual');
        setSettlementLink({
          id: sid,
          companyId: sug.company_id,
          number: sug.settlement_number?.trim() ?? '',
        });
        if (sug.lines.length > 0) {
          const hintMap = new Map<number, { id: number; label: string; searchText: string }>();
          for (const l of sug.lines) {
            hintMap.set(l.document_id, {
              id: l.document_id,
              label: debtSelectLabelFromSuggestion(l),
              searchText: debtSelectSearchTextFromSuggestion(l),
            });
          }
          setAllocDocHints([...hintMap.values()]);
          setManualAlloc(
            sug.lines.map((l) => ({
              key: newManualAllocKey(),
              doc: String(l.document_id),
              amt: l.amount.toFixed(2),
            })),
          );
          setAmount(sug.suggested_total.toFixed(2));
          setSettlementLoadError('');
        } else {
          setAllocDocHints([]);
          setManualAlloc([{ key: newManualAllocKey(), doc: '', amt: '' }]);
          setAmount('');
          setSettlementLoadError(
            'No hay saldo pendiente en las deudas de esta liquidación. Agregue imputaciones manualmente si corresponde.',
          );
        }
        const refLabel = sug.settlement_number?.trim() ? `Liquidación ${sug.settlement_number.trim()}` : `Liquidación #${sid}`;
        setNotes((n) => (n.trim() ? n : refLabel));
      } catch {
        if (!cancelled) {
          setAllocDocHints([]);
          setSettlementLoadError('No se pudieron cargar las imputaciones desde la liquidación.');
          settlementLoadedRef.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, taxSettlementIdFromUrl, navigate]);

  useEffect(() => {
    if (!settlementLink) return;
    const cid = Number(companyId);
    // No limpiar si aún no hay empresa en el formulario (evita carrera tras precarga desde liquidación).
    if (!Number.isFinite(cid) || cid <= 0) return;
    if (cid !== settlementLink.companyId) {
      setSettlementLink(null);
      setAllocDocHints([]);
    }
  }, [companyId, settlementLink]);

  useEffect(() => {
    if (!settlementLink || !canIssueTukifac || isEdit) return;
    let cancelled = false;
    void ensureTukifacSeriesCached()
      .then(() => {
        if (!cancelled) setSeriesRefresh((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) setSeriesRefresh((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [settlementLink, canIssueTukifac, isEdit]);

  useEffect(() => {
    if (!settlementLink || isEdit || !canIssueTukifac || effectivePaymentType !== 'applied') return;
    if (tukifacKind === 'sale_note') {
      const rows = getCachedSaleNoteSeries();
      const d = pickDefaultSeries(rows);
      setTukifacSaleNoteSeriesId((prev) => {
        if (prev && rows.some((r) => String(r.id) === prev)) return prev;
        return d ? String(d.id) : '';
      });
      return;
    }
    const sunat = tukifacKind === 'factura' ? '01' : '03';
    const rows = getCachedDocumentSeries().filter((r) => (r.document_type_id ?? '').trim() === sunat);
    const d = pickDefaultSeries(rows);
    setTukifacSerie((prev) => {
      const ok = rows.some((r) => r.number === prev);
      if (ok) return prev;
      return d?.number ?? '';
    });
  }, [settlementLink, isEdit, canIssueTukifac, tukifacKind, seriesRefresh, effectivePaymentType]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isEdit && editLocked) {
      setError('No se puede editar un pago aplicado a una deuda');
      return;
    }
    if (!canUpsert) {
      setError('No tienes permisos para realizar esta acción');
      return;
    }

    const companyIdNum = Number(companyId);
    const documentIdNum = Number(documentId);
    const amountNum = Number(amount);

    if (!companyIdNum) {
      setError('La empresa es requerida');
      return;
    }

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('El monto debe ser mayor a 0');
      return;
    }

    if (
      settlementLink &&
      Number(companyId) === settlementLink.companyId &&
      effectivePaymentType === 'on_account'
    ) {
      setError('Este pago está vinculado a una liquidación: debe imputar montos a las deudas (una deuda, FIFO o manual).');
      return;
    }

    if (effectivePaymentType === 'applied') {
      if (applyMode === 'single') {
        if (!documentId || !Number.isFinite(documentIdNum) || documentIdNum <= 0) {
          setError('Seleccione la deuda o use FIFO / manual');
          return;
        }
      }
      if (applyMode === 'manual') {
        const lines = manualAlloc
          .filter((l) => l.doc && Number(l.amt) > 0)
          .map((l) => ({ document_id: Number(l.doc), amount: Number(l.amt) }));
        if (lines.length === 0) {
          setError('Indique al menos una línea de imputación manual');
          return;
        }
        const sum = lines.reduce((a, l) => a + l.amount, 0);
        if (Math.abs(sum - amountNum) > 0.02) {
          setError('La suma de imputaciones debe coincidir con el monto del pago');
          return;
        }
      }
    }

    const tryTukifacAfterCreate = showComprobanteTukifac;
    if (tryTukifacAfterCreate && tukifacKind === 'sale_note') {
      const sid = Number(tukifacSaleNoteSeriesId);
      const nvRows = getCachedSaleNoteSeries();
      if (!Number.isFinite(sid) || sid <= 0) {
        setError(
          nvRows.length
            ? 'Seleccione la serie de nota de venta.'
            : 'No hay series de nota de venta disponibles en Tukifac para este usuario.',
        );
        return;
      }
    }
    if (tryTukifacAfterCreate && (tukifacKind === 'boleta' || tukifacKind === 'factura')) {
      const sunat = tukifacKind === 'factura' ? '01' : '03';
      const fbRows = getCachedDocumentSeries().filter((r) => (r.document_type_id ?? '').trim() === sunat);
      if (fbRows.length > 0 && !tukifacSerie.trim()) {
        setError('Seleccione la serie del comprobante (factura o boleta).');
        return;
      }
    }

    const payload: PaymentUpsertInput = {
      company_id: companyIdNum,
      amount: amountNum,
      type: effectivePaymentType,
      date: dateInputToRFC3339MidnightPeru(date),
      method: method.trim() ? method.trim() : undefined,
      reference: reference.trim() ? reference.trim() : undefined,
      attachment: attachment.trim() ? attachment.trim() : undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    };

    if (effectivePaymentType === 'applied') {
      if (applyMode === 'fifo') {
        payload.allocation_mode = 'fifo';
      } else if (applyMode === 'manual') {
        payload.allocation_mode = 'manual';
        payload.allocations = manualAlloc
          .filter((l) => l.doc && Number(l.amt) > 0)
          .map((l) => ({ document_id: Number(l.doc), amount: Number(l.amt) }));
      } else if (documentId && Number.isFinite(documentIdNum) && documentIdNum > 0) {
        payload.document_id = documentIdNum;
      }
      if (settlementLink && Number(companyId) === settlementLink.companyId) {
        payload.tax_settlement_id = settlementLink.id;
      }
    }

    try {
      setSaving(true);
      setError('');
      if (isEdit && paymentId) {
        await paymentsService.update(paymentId, payload);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'success', message: 'Pago actualizado correctamente.' },
          }),
        );
      } else {
        const created = await paymentsService.create(payload);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'success', message: 'Pago registrado correctamente.' },
          }),
        );
        if (tryTukifacAfterCreate) {
          try {
            const tukBody: PaymentTukifacIssuePayload = {
              kind: tukifacKind,
              serie_documento: tukifacSerie.trim() || undefined,
              sale_note_series_id:
                tukifacKind === 'sale_note' ? Number(tukifacSaleNoteSeriesId) : undefined,
              /** SUNAT efectivo en Tukifac; el método real del pago queda guardado en el pago del sistema. */
              payment_method_type_id: '01',
              payment_destination_id: 'cash',
              payment_reference: method.trim() || reference.trim() || 'Caja',
            };
            const issueOut = await paymentsService.issueTukifacFromPayment(created.id, tukBody);
            window.dispatchEvent(
              new CustomEvent('miweb:toast', {
                detail: { type: 'success', message: 'Comprobante enviado a Tukifac correctamente.' },
              }),
            );
            const viewLinks = parseTukifacReceiptViewLinks(issueOut.receipt);
            if (viewLinks) {
              setTukifacPostSaveLinks(viewLinks);
              return;
            }
          } catch (te) {
            console.error(te);
            window.dispatchEvent(
              new CustomEvent('miweb:toast', {
                detail: {
                  type: 'error',
                  message: `Pago guardado. No se pudo emitir en Tukifac: ${getTukifacErrorMessage(te)}`,
                },
              }),
            );
          }
        }
      }
      navigate('/payments', { replace: true });
    } catch (e2) {
      console.error(e2);
      setError(getErrorMessage(e2));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 w-full min-w-0 max-w-full">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4 w-full min-w-0 max-w-full">
      <TukifacIssueLinksDialog
        open={Boolean(tukifacPostSaveLinks)}
        links={tukifacPostSaveLinks}
        onContinue={() => {
          setTukifacPostSaveLinks(null);
          navigate('/payments', { replace: true });
        }}
        continueLabel="Ir al listado de pagos"
      />
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 pr-1">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-800">{isEdit ? 'Editar pago' : 'Nuevo pago'}</h2>
          {hideCompanyField ? (
            <p className="text-sm font-medium text-slate-800 mt-2">{settlementCompanyDisplay}</p>
          ) : null}
        </div>
        <Link
          to="/payments"
          className="shrink-0 self-start sm:self-auto inline-flex items-center gap-2 px-3 py-2 sm:py-1.5 rounded-full border border-slate-300 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 min-h-[44px] sm:min-h-0"
        >
          <i className="fas fa-arrow-left text-xs"></i> Volver al listado
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {settlementLoadError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">{settlementLoadError}</div>
      ) : null}

      {isEdit && editLocked ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
          Este pago está aplicado a una deuda. Puedes eliminarlo desde el listado de pagos.
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:gap-5">
        {showComprobanteTukifac ? (
          <section className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-3 py-4 sm:p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-3 sm:gap-x-4 items-start">
                <div className="min-w-0">
                  <label htmlFor="tukifac_kind" className="block text-sm font-medium text-slate-700 mb-1">
                    Tipo de comprobante
                  </label>
                  <select
                    id="tukifac_kind"
                    value={tukifacKind}
                    onChange={(ev) => setTukifacKind(ev.target.value as 'boleta' | 'factura' | 'sale_note')}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  >
                    <option value="sale_note">Nota de venta</option>
                    <option value="boleta">Boleta</option>
                    <option value="factura">Factura</option>
                  </select>
                </div>
                {tukifacKind === 'sale_note' ? (
                  <div className="min-w-0">
                    <label htmlFor="tukifac_nv_series" className="block text-sm font-medium text-slate-700 mb-1">
                      Serie
                    </label>
                    <select
                      id="tukifac_nv_series"
                      value={tukifacSaleNoteSeriesId}
                      onChange={(ev) => setTukifacSaleNoteSeriesId(ev.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    >
                      <option value="">Seleccione…</option>
                      {getCachedSaleNoteSeries().map((r) => (
                        <option key={r.id} value={String(r.id)}>
                          {r.number}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <label htmlFor="tukifac_serie" className="block text-sm font-medium text-slate-700 mb-1">
                      Serie
                    </label>
                    <select
                      id="tukifac_serie"
                      value={tukifacSerie}
                      onChange={(ev) => setTukifacSerie(ev.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    >
                      <option value="">
                        {getCachedDocumentSeries().filter(
                          (r) => (r.document_type_id ?? '').trim() === (tukifacKind === 'factura' ? '01' : '03'),
                        ).length
                          ? 'Seleccione…'
                          : 'Sin series en caché (Tukifac)'}
                      </option>
                      {getCachedDocumentSeries()
                        .filter((r) => (r.document_type_id ?? '').trim() === (tukifacKind === 'factura' ? '01' : '03'))
                        .map((r) => (
                          <option key={r.id} value={r.number}>
                            {r.number}
                          </option>
                        ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">El correlativo lo asigna Tukifac.</p>
                  </div>
                )}
                <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                  <label htmlFor="date" className="block text-sm font-medium text-slate-700 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    id="date"
                    name="date"
                    value={date}
                    onChange={(ev) => setDate(ev.target.value)}
                    className="w-full max-w-full min-w-0 px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {!hideCompanyField ? (
          <section className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-3 py-4 sm:p-5 max-w-xl">
              <SearchableSelect
                id="company_id"
                name="company_id"
                required
                value={companyId}
                onChange={setCompanyId}
                placeholder="Selecciona una empresa…"
                searchPlaceholder="Buscar empresa..."
                options={companies.map((c) => ({ value: String(c.id), label: c.business_name }))}
              />
            </div>
          </section>
        ) : null}

        <div className="flex flex-col gap-3 sm:gap-4 lg:grid lg:grid-cols-12 lg:gap-6 lg:items-stretch">
          <section className="lg:col-span-6 rounded-xl sm:rounded-2xl border border-slate-200 bg-white shadow-sm overflow-visible flex flex-col min-w-0">
            <div className="px-3 py-4 sm:p-5 space-y-3 sm:space-y-4 flex-1 flex flex-col">
              <div className="flex flex-wrap gap-x-3 gap-y-2 text-sm">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" className="text-primary-600" checked={applyMode === 'single'} onChange={() => setApplyMode('single')} />
                  Una deuda
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" className="text-primary-600" checked={applyMode === 'fifo'} onChange={() => setApplyMode('fifo')} />
                  FIFO
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" className="text-primary-600" checked={applyMode === 'manual'} onChange={() => setApplyMode('manual')} />
                  Manual
                </label>
              </div>
              {applyMode === 'fifo' ? (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  Se aplicará el monto pagado a las deudas más antiguas hasta agotar el importe.
                </p>
              ) : null}
              {applyMode === 'single' ? (
                <div className="min-w-0">
                  <label htmlFor="document_id" className="block text-sm font-medium text-slate-700 mb-1">
                    Deuda
                  </label>
                  <SearchableSelect
                    id="document_id"
                    name="document_id"
                    value={documentId}
                    disabled={!companyId}
                    onChange={setDocumentId}
                    placeholder="Selecciona una deuda…"
                    searchPlaceholder="Buscar deuda..."
                    options={singleDebtSelectOptions}
                  />
                </div>
              ) : null}
              {applyMode === 'manual' ? (
                <div className="space-y-2">
                  {manualAlloc.map((row, idx) => (
                    <div
                      key={row.key}
                      className="grid grid-cols-[1fr_2.75rem] gap-x-2 gap-y-2 items-end md:grid-cols-[minmax(0,1fr)_7.5rem_auto]"
                    >
                      <div className="col-span-2 min-w-0 md:col-span-1">
                      <SearchableSelect
                        value={row.doc}
                        onChange={(v) => {
                          const n = [...manualAlloc];
                          n[idx] = { ...n[idx], doc: v };
                          setManualAlloc(n);
                        }}
                        placeholder="Deuda"
                        options={manualDebtSelectOptions}
                      />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Monto a imputar"
                        value={row.amt}
                        onChange={(ev) => {
                          const n = [...manualAlloc];
                          n[idx] = { ...n[idx], amt: ev.target.value };
                          setManualAlloc(n);
                        }}
                        className="w-full min-w-0 px-2 py-2.5 md:py-2 rounded-lg border border-slate-300 text-sm text-right tabular-nums"
                      />
                      <button
                        type="button"
                        title="Quitar línea"
                        aria-label="Quitar línea de imputación"
                        disabled={manualAlloc.length <= 1}
                        onClick={() => {
                          if (manualAlloc.length <= 1) return;
                          setManualAlloc(manualAlloc.filter((_, i) => i !== idx));
                        }}
                        className="inline-flex h-11 w-11 md:h-10 md:w-10 shrink-0 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                      >
                        <i className="fas fa-times text-sm" aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-xs font-medium text-primary-700 hover:text-primary-800"
                    onClick={() => setManualAlloc([...manualAlloc, { key: newManualAllocKey(), doc: '', amt: '' }])}
                  >
                    + Añadir línea
                  </button>
                </div>
              ) : null}

              {!isEdit && effectivePaymentType === 'applied' ? (
                <div className="mt-auto pt-3 border-t border-slate-200">
                  <dl className="space-y-2 text-sm">
                    {applyMode === 'manual' ? (
                      <>
                        <div className="flex flex-wrap justify-between gap-2 py-1.5 border-b border-slate-100">
                          <dt className="text-slate-600">Suma de líneas</dt>
                          <dd className="font-semibold tabular-nums text-slate-900">S/ {manualImputationSum.toFixed(2)}</dd>
                        </div>
                        <div className="flex flex-wrap justify-between gap-2 py-1.5 border-b border-slate-100">
                          <dt className="text-slate-600">Monto del pago</dt>
                          <dd className="font-semibold tabular-nums text-slate-900">S/ {amountNumForSummary.toFixed(2)}</dd>
                        </div>
                        {Math.abs(manualImputationSum - amountNumForSummary) > 0.02 ? (
                          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200/80 rounded-lg px-3 py-2">
                            Ajuste las líneas o el monto del pago para que ambos importes coincidan antes de guardar.
                          </p>
                        ) : manualImputationSum > 0 ? (
                          <p className="text-xs text-emerald-800">Importes alineados.</p>
                        ) : null}
                      </>
                    ) : null}
                    {applyMode === 'single' && selectedDebtTotal != null ? (
                      <div className="flex flex-wrap justify-between gap-2 py-1.5 border-b border-slate-100">
                        <dt className="text-slate-600">Total deuda seleccionada</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">S/ {selectedDebtTotal.toFixed(2)}</dd>
                      </div>
                    ) : null}
                    {applyMode === 'single' ? (
                      <div className="flex flex-wrap justify-between gap-2 py-1.5 border-b border-slate-100">
                        <dt className="text-slate-600">Este pago</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">S/ {amountNumForSummary.toFixed(2)}</dd>
                      </div>
                    ) : null}
                    {applyMode === 'fifo' ? (
                      <div className="flex flex-wrap justify-between gap-2 py-1.5">
                        <dt className="text-slate-600">Monto a distribuir (FIFO)</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">S/ {amountNumForSummary.toFixed(2)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              ) : null}
            </div>
          </section>

          <section className="lg:col-span-6 rounded-xl sm:rounded-2xl border border-slate-200 bg-white shadow-sm overflow-visible flex flex-col min-w-0">
            <div className="px-3 py-4 sm:p-5 space-y-3 sm:space-y-4 flex-1 flex flex-col">
              {!showComprobanteTukifac ? (
                <div>
                  <label htmlFor="date" className="block text-sm font-medium text-slate-700 mb-1">
                    Fecha del pago
                  </label>
                  <input
                    type="date"
                    id="date"
                    name="date"
                    value={date}
                    onChange={(ev) => setDate(ev.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-3 sm:gap-x-4">
                <div className="min-w-0">
                  <label htmlFor="amount" className="block text-sm font-medium text-slate-700 mb-1">
                    Monto pagado
                  </label>
                  <div className="flex items-center rounded-lg border border-slate-300 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
                    <span className="px-3 text-slate-500 text-sm shrink-0">S/</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      id="amount"
                      name="amount"
                      required
                      value={amount}
                      onChange={(ev) => setAmount(ev.target.value)}
                      className="w-full min-w-0 px-2 py-2.5 rounded-r-lg outline-none text-sm tabular-nums"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
                    En manual, la suma de líneas debe coincidir con este importe.
                  </p>
                </div>
                <div className="min-w-0">
                  <label htmlFor="method" className="block text-sm font-medium text-slate-700 mb-1">
                    Método
                  </label>
                  <SearchableSelect
                    id="method"
                    name="method"
                    value={method}
                    onChange={setMethod}
                    placeholder="Selecciona…"
                    options={methodOptions}
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="reference" className="block text-sm font-medium text-slate-700 mb-1">
                    Referencia
                  </label>
                  <input
                    type="text"
                    id="reference"
                    name="reference"
                    value={reference}
                    onChange={(ev) => setReference(ev.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    placeholder="Operación, recibo…"
                  />
                </div>
              </div>

              <div className="pt-3 mt-0.5 border-t border-slate-100">
                <label htmlFor="attachment" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Comprobante del pago (imagen o PDF)
                </label>
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={uploading || saving || !canUpsert}
                    onChange={(ev) => handleAttachmentFileChange(ev.target.files?.[0] ?? null)}
                    className="w-full min-w-0 text-sm text-slate-700 file:mr-2 sm:file:mr-4 file:rounded-full file:border-0 file:bg-primary-50 file:px-3 file:py-2.5 sm:file:px-4 sm:file:py-2 file:text-xs sm:file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
                  />
                  <input type="hidden" id="attachment" name="attachment" value={attachment} />
                  {uploading ? (
                    <div className="text-xs text-slate-500">
                      <i className="fas fa-spinner fa-spin mr-2"></i> Subiendo…
                    </div>
                  ) : null}
                  {attachment ? (
                    <a
                      href={resolveBackendUrl(attachment)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center text-xs font-medium text-primary-700 hover:text-primary-800"
                    >
                      <i className="fas fa-paperclip mr-2"></i> Ver adjunto
                    </a>
                  ) : null}
                </div>
              </div>

              {!isEdit && effectivePaymentType === 'on_account' ? (
                <div className="mt-auto pt-3 border-t border-slate-200">
                  <div className="flex justify-between gap-2 text-sm py-1.5 rounded-lg bg-slate-50 px-3 border border-slate-100">
                    <span className="text-slate-600">Anticipo / a cuenta</span>
                    <span className="font-semibold tabular-nums">S/ {amountNumForSummary.toFixed(2)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <section className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-3 py-4 sm:p-5">
            <label htmlFor="notes" className="sr-only">
              Notas
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              value={notes}
              onChange={(ev) => setNotes(ev.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none min-h-[5.5rem]"
              placeholder="Notas sobre el pago…"
            />
          </div>
        </section>

        <footer className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 pt-4 border-t border-slate-200">
          <button
            type="submit"
            disabled={saving || uploading || !canUpsert}
            className="inline-flex w-full sm:w-auto items-center justify-center px-6 py-3 sm:py-2.5 min-h-[48px] sm:min-h-0 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary-500 disabled:opacity-60"
          >
            <i className="fas fa-save mr-2 text-xs"></i>
            {saving ? 'Guardando...' : uploading ? 'Subiendo...' : isEdit ? 'Guardar cambios' : 'Registrar pago'}
          </button>
        </footer>
      </form>
      )}
    </div>
  );
};

export default PaymentForm;
