import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { planCategoriesService } from '../services/planCategories';
import { auth } from '../services/auth';

const PlanCategoryForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const canUpsert = auth.getRole() === 'Administrador' || auth.getRole() === 'Supervisor';

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(!!editId);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editId) return;
    void planCategoriesService
      .get(editId)
      .then((c) => {
        setCode(c.code);
        setName(c.name);
        setDescription(c.description ?? '');
        setSortOrder(String(c.sort_order ?? 0));
        setActive(c.active);
      })
      .catch(() => setError('Error al cargar'))
      .finally(() => setLoading(false));
  }, [editId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canUpsert) return;
    try {
      setError('');
      if (editId) {
        await planCategoriesService.update(editId, {
          code: code.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          sort_order: Number(sortOrder) || 0,
          active,
        });
      } else {
        await planCategoriesService.create({
          code: code.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          sort_order: Number(sortOrder) || 0,
          active,
        });
      }
      navigate('/plan-categories', { replace: true });
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
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">{editId ? 'Editar categoría' : 'Nueva categoría'}</h2>
        <Link to="/plan-categories" className="text-sm text-slate-600">
          Volver
        </Link>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-slate-200 rounded-xl p-6">
        <div>
          <label className="block text-sm font-medium mb-1">Código</label>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Nombre</label>
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
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Orden</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input type="checkbox" id="act" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <label htmlFor="act" className="text-sm">
              Activa
            </label>
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

export default PlanCategoryForm;
