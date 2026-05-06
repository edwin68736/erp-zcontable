import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { planCategoriesService } from '../services/planCategories';
import { subscriptionPlansService } from '../services/subscriptionPlans';
import type { PlanCategory, PlanTier } from '../types/dashboard';
import { auth } from '../services/auth';

type TierRow = { min_billing: string; max_billing: string; monthly_price: string; sort_order: string };

const emptyTier = (): TierRow => ({ min_billing: '0', max_billing: '', monthly_price: '0', sort_order: '0' });

const SubscriptionPlanForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const canUpsert = auth.getRole() === 'Administrador' || auth.getRole() === 'Supervisor';

  const [categories, setCategories] = useState<PlanCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [billingBasis, setBillingBasis] = useState('manual');
  const [active, setActive] = useState(true);
  const [tiers, setTiers] = useState<TierRow[]>([emptyTier()]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void planCategoriesService.list().then((c) => {
      setCategories(c.filter((x) => x.active));
      if (c.length && !categoryId) setCategoryId(String(c[0].id));
    });
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!editId) {
        setLoading(false);
        return;
      }
      try {
        const p = await subscriptionPlansService.get(editId);
        setCategoryId(String(p.plan_category_id));
        setName(p.name);
        setDescription(p.description ?? '');
        setBillingBasis(p.billing_basis || 'manual');
        setActive(p.active);
        if (p.tiers?.length) {
          setTiers(
            p.tiers.map((t) => ({
              min_billing: String(t.min_billing),
              max_billing: t.max_billing != null ? String(t.max_billing) : '',
              monthly_price: String(t.monthly_price),
              sort_order: String(t.sort_order ?? 0),
            })),
          );
        }
      } catch {
        setError('Error al cargar plan');
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [editId]);

  const toTierPayload = (): PlanTier[] =>
    tiers.map((r, i) => ({
      min_billing: Number(r.min_billing) || 0,
      max_billing: r.max_billing.trim() === '' ? null : Number(r.max_billing),
      monthly_price: Number(r.monthly_price) || 0,
      sort_order: Number(r.sort_order) || i,
    }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canUpsert) return;
    const cid = Number(categoryId);
    if (!cid) {
      setError('Seleccione categoría');
      return;
    }
    const tierPayload = toTierPayload();
    try {
      setError('');
      if (editId) {
        await subscriptionPlansService.update(editId, {
          name: name.trim(),
          description: description.trim() || undefined,
          billing_basis: billingBasis,
          active,
        });
        await subscriptionPlansService.replaceTiers(editId, tierPayload);
      } else {
        await subscriptionPlansService.create({
          plan_category_id: cid,
          name: name.trim(),
          description: description.trim() || undefined,
          billing_basis: billingBasis,
          active,
          tiers: tierPayload,
        });
      }
      navigate('/subscription-plans', { replace: true });
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : 'Error al guardar';
      setError(typeof msg === 'string' ? msg : 'Error al guardar');
    }
  };

  if (loading) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">{editId ? 'Editar plan' : 'Nuevo plan'}</h2>
        <Link to="/subscription-plans" className="text-sm text-slate-600">
          Volver
        </Link>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <form onSubmit={handleSubmit} className="space-y-5 bg-white border border-slate-200 rounded-xl p-6">
        <div>
          <label className="block text-sm font-medium mb-1">Categoría</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={!!editId}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Nombre del plan</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Base para facturación del período (liquidación)</label>
          <select
            value={billingBasis}
            onChange={(e) => setBillingBasis(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          >
            <option value="manual">Manual (monto declarado en la empresa)</option>
            <option value="documents_month_sum">Suma de deudas manuales del mes de servicio</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pact" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <label htmlFor="pact" className="text-sm">
            Plan activo
          </label>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium">Tramos (facturación mín / máx / precio mensual)</label>
            <button
              type="button"
              className="text-xs text-primary-700"
              onClick={() => setTiers([...tiers, emptyTier()])}
            >
              + Tramo
            </button>
          </div>
          <div className="space-y-2">
            {tiers.map((row, idx) => (
              <div key={idx} className="grid grid-cols-4 gap-2 items-end">
                <div>
                  <span className="text-xs text-slate-500">Mín fact.</span>
                  <input
                    type="number"
                    step="0.01"
                    value={row.min_billing}
                    onChange={(e) => {
                      const n = [...tiers];
                      n[idx] = { ...n[idx], min_billing: e.target.value };
                      setTiers(n);
                    }}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <span className="text-xs text-slate-500">Máx (vacío=∞)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={row.max_billing}
                    onChange={(e) => {
                      const n = [...tiers];
                      n[idx] = { ...n[idx], max_billing: e.target.value };
                      setTiers(n);
                    }}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <span className="text-xs text-slate-500">Precio mes</span>
                  <input
                    type="number"
                    step="0.01"
                    value={row.monthly_price}
                    onChange={(e) => {
                      const n = [...tiers];
                      n[idx] = { ...n[idx], monthly_price: e.target.value };
                      setTiers(n);
                    }}
                    className="w-full px-2 py-1.5 rounded border border-slate-300 text-sm"
                  />
                </div>
                <div className="flex gap-1">
                  <input
                    type="number"
                    title="Orden"
                    value={row.sort_order}
                    onChange={(e) => {
                      const n = [...tiers];
                      n[idx] = { ...n[idx], sort_order: e.target.value };
                      setTiers(n);
                    }}
                    className="w-16 px-2 py-1.5 rounded border border-slate-300 text-sm"
                  />
                  {tiers.length > 1 ? (
                    <button
                      type="button"
                      className="text-red-500 text-xs px-2"
                      onClick={() => setTiers(tiers.filter((_, i) => i !== idx))}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={!canUpsert}
          className="px-5 py-2 rounded-full bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
        >
          Guardar
        </button>
      </form>
    </div>
  );
};

export default SubscriptionPlanForm;
