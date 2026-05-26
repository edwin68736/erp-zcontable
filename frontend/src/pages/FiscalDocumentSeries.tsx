import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fiscalDocumentSeriesService,
  type FiscalSeriesInput,
  type FiscalSeriesItem,
} from '../services/fiscalDocumentSeries';
import { auth } from '../services/auth';
import { P } from '../rbac/codes';

const SUNAT_LABELS: Record<string, string> = {
  '00': 'Nota de venta (no SUNAT)',
  '01': 'Factura',
  '03': 'Boleta',
};

const emptyForm = (): FiscalSeriesInput => ({
  name: '',
  sunat_code: '03',
  series: '',
  current_number: 0,
  active: true,
  description: '',
});

const FiscalDocumentSeries = () => {
  const canView = auth.hasPermission(P.fiscalSeriesView);
  const canManage = auth.hasPermission(P.fiscalSeriesManage);
  const [list, setList] = useState<FiscalSeriesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FiscalSeriesItem | null>(null);
  const [form, setForm] = useState<FiscalSeriesInput>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setList(await fiscalDocumentSeriesService.list());
    } catch (e) {
      console.error(e);
      setError('No se pudieron cargar las series');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    void load();
  }, [canView, load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(t) ||
        r.series.toLowerCase().includes(t) ||
        r.sunat_code.includes(t),
    );
  }, [list, q]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
    setError('');
  };

  const openEdit = (row: FiscalSeriesItem) => {
    setEditing(row);
    setForm({
      name: row.name,
      sunat_code: row.sunat_code,
      series: row.series,
      current_number: row.current_number,
      active: row.active,
      description: row.description ?? '',
    });
    setModalOpen(true);
    setError('');
  };

  const duplicateInForm = useMemo(() => {
    const serie = form.series.trim().toUpperCase();
    const sunat = form.sunat_code.trim();
    if (!serie || !sunat) return false;
    return list.some(
      (r) =>
        r.sunat_code === sunat &&
        r.series.toUpperCase() === serie &&
        (!editing || r.id !== editing.id),
    );
  }, [list, form.series, form.sunat_code, editing]);

  const submit = async () => {
    if (!canManage) return;
    if (duplicateInForm) {
      setError(`Ya existe la serie ${form.series.trim().toUpperCase()} para este tipo de comprobante.`);
      return;
    }
    try {
      setSaving(true);
      setError('');
      if (editing) {
        await fiscalDocumentSeriesService.update(editing.id, form);
      } else {
        await fiscalDocumentSeriesService.create(form);
      }
      setModalOpen(false);
      await load();
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Serie guardada.' } }),
      );
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      const msg =
        err.response?.data?.error ??
        (e instanceof Error ? e.message : 'Error al guardar');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: FiscalSeriesItem) => {
    if (!canManage) return;
    try {
      await fiscalDocumentSeriesService.update(row.id, { active: !row.active });
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  if (!canView) {
    return <p className="text-sm text-slate-600">No tienes permiso para ver series y correlativos.</p>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Series y correlativos</h2>
          <p className="text-sm text-slate-500">
            Control local de numeración. El siguiente comprobante usará el correlativo indicado como próximo.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium"
          >
            <i className="fas fa-plus text-xs" aria-hidden />
            Nueva serie
          </button>
        ) : null}
      </div>

      <div className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o serie…"
          className="flex-1 max-w-md px-3 py-2 rounded-lg border border-slate-300 text-sm"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">SUNAT</th>
                <th className="text-left px-4 py-3">Serie</th>
                <th className="text-right px-4 py-3">Último nº</th>
                <th className="text-right px-4 py-3">Próximo</th>
                <th className="text-center px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className={!r.active ? 'opacity-60' : undefined}>
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{SUNAT_LABELS[r.sunat_code] ?? r.sunat_code}</td>
                  <td className="px-4 py-3 font-mono">{r.series}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.current_number}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-primary-700">{r.next_number}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs border ${
                        r.active ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {r.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {canManage ? (
                      <>
                        <button type="button" className="text-primary-700 text-xs font-medium" onClick={() => openEdit(r)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="text-slate-600 text-xs font-medium"
                          onClick={() => void toggleActive(r)}
                        >
                          {r.active ? 'Desactivar' : 'Activar'}
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">Sin resultados.</p>
          ) : null}
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-5 space-y-4">
            <h3 className="text-lg font-semibold text-slate-800">
              {editing ? 'Editar serie' : 'Nueva serie'}
            </h3>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="grid gap-3">
              <label className="block text-sm">
                <span className="text-slate-700">Nombre</span>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Código SUNAT</span>
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.sunat_code}
                  onChange={(e) => setForm((f) => ({ ...f, sunat_code: e.target.value }))}
                >
                  <option value="00">00 — Nota de venta</option>
                  <option value="03">03 — Boleta</option>
                  <option value="01">01 — Factura</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Serie (ej. B001)</span>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2 font-mono uppercase"
                  value={form.series}
                  onChange={(e) => setForm((f) => ({ ...f, series: e.target.value.toUpperCase() }))}
                />
                {duplicateInForm ? (
                  <p className="text-xs text-red-600 mt-1">
                    Esta serie ya está registrada para el mismo tipo de comprobante.
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">
                    La combinación tipo SUNAT + serie debe ser única (p. ej. dos boletas no pueden usar B001).
                  </p>
                )}
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Número actual (último emitido)</span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.current_number ?? 0}
                  onChange={(e) => setForm((f) => ({ ...f, current_number: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active ?? true}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Activo
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Descripción (opcional)</span>
                <textarea
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  rows={2}
                  value={form.description ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-4 py-2 text-sm rounded-lg border" onClick={() => setModalOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || duplicateInForm}
                className="px-4 py-2 text-sm rounded-full bg-primary-600 text-white disabled:opacity-50"
                onClick={() => void submit()}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FiscalDocumentSeries;
