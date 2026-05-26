import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supervisorsService, type SupervisorNotification } from '../../services/supervisors';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';

const SupervisorNotifications = () => {
  const allowed = useMemo(() => auth.hasPermission(P.supervisorsNotificationsView), []);
  const [items, setItems] = useState<SupervisorNotification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setItems(await supervisorsService.listNotifications(unreadOnly));
    } catch {
      setError('No se pudieron cargar las notificaciones');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const markRead = async (id: number) => {
    await supervisorsService.markNotificationRead(id);
    void load();
  };

  if (!allowed) {
    return <p className="p-6 text-center text-slate-600">Sin permiso para ver notificaciones de supervisores.</p>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Notificaciones</h2>
          <p className="text-sm text-slate-500">Alertas automáticas del módulo de supervisores.</p>
        </div>
        <label className="text-sm text-slate-600 flex items-center gap-2">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="rounded border-slate-300"
          />
          Solo no leídas
        </label>
      </div>

      {loading ? <p className="text-sm text-slate-500">Cargando…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!loading && !error ? (
        <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {items.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-slate-500">No hay notificaciones.</li>
          ) : (
            items.map((n) => (
              <li key={n.id} className={`px-4 py-4 ${n.read_at ? 'bg-white' : 'bg-primary-50/30'}`}>
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 text-sm">{n.title}</p>
                    <p className="text-sm text-slate-600 mt-1">{n.message}</p>
                    <p className="text-xs text-slate-400 mt-2">
                      {new Date(n.created_at).toLocaleString()}
                      {n.period_ym ? ` · ${n.period_ym}` : ''}
                    </p>
                    {n.monthly_control_id ? (
                      <Link
                        to={`/supervisors/controls/${n.monthly_control_id}`}
                        className="text-xs text-primary-700 font-medium mt-1 inline-block"
                      >
                        Ver control →
                      </Link>
                    ) : null}
                  </div>
                  {!n.read_at ? (
                    <button
                      type="button"
                      onClick={() => void markRead(n.id)}
                      className="shrink-0 text-xs text-primary-700 font-medium hover:underline"
                    >
                      Marcar leída
                    </button>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
};

export default SupervisorNotifications;
