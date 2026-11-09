import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import { sunatBuzonService, type BuzonApiError, type BuzonDetail, type BuzonFilters, type BuzonSync } from '../../../services/sunatBuzon';
import { Card, Spinner } from '../sire/SireShared';
import { INPUT_CLS, SELECT_CLS } from '../sire/sireUi';
import { ETIQUETA_BADGE, buzonBadge, fmtDateTime, timeAgo } from './buzonUi';
import Alert from '../../../components/ui/Alert';
import { notify } from '../../../utils/notify';
import LongTaskPanel from '../../../components/LongTaskPanel';
import { failTask, finishTask, startTask, taskKey } from '../../../utils/longTasks';
import { useTask, useTaskSettled } from '../../../utils/useLongTasks';

const PER_PAGE = 25;

function BuzonError({ error }: { error: BuzonApiError }) {
  const [detail, setDetail] = useState(false);
  const fixCreds = error.code === 'credenciales_rechazadas' || error.code === 'sin_clave';
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-medium">{error.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {fixCreds ? (
          <Link to="/finance/claves-sol" className="font-semibold text-red-900 underline">
            Ir a Claves SOL
          </Link>
        ) : null}
        {error.detail ? (
          <button type="button" onClick={() => setDetail((v) => !v)} className="text-red-700 underline">
            {detail ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
          </button>
        ) : null}
      </div>
      {detail && error.detail ? <p className="mt-2 break-words rounded-md bg-white/70 px-2 py-1.5 font-mono text-2xs text-slate-700">{error.detail}</p> : null}
    </div>
  );
}

/**
 * Herramientas → Notificaciones SUNAT → una empresa. Lo primero que se ve es lo ya guardado de la última
 * sincronización; «Sincronizar» entra a SUNAT con la clave de la empresa y actualiza el buzón (una empresa a la vez).
 */
const BuzonCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  const [detail, setDetail] = useState<BuzonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<BuzonApiError | null>(null);
  // La sincronización con SUNAT la sigue el registro global (utils/longTasks): sobrevive a un cambio de pantalla.
  const task = useTask(taskKey('buzon', companyId));
  const syncing = task?.status === 'running';
  const ownTask = useRef<number | null>(null);
  const [syncError, setSyncError] = useState<BuzonApiError | null>(null);
  const [filters, setFilters] = useState<BuzonFilters>({ tipo: 0, page: 1, per_page: PER_PAGE });
  const [qInput, setQInput] = useState('');

  useEffect(() => {
    if (!Number.isFinite(companyId) || companyId <= 0) return;
    let alive = true;
    companyAccessCredentialsService
      .get(companyId)
      .then((r) => {
        if (alive) setCompany(r);
      })
      .catch(() => {
        if (alive) setCompanyError('No se pudo cargar la empresa (¿no está en su alcance?).');
      });
    return () => {
      alive = false;
    };
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      setDetail(await sunatBuzonService.get(companyId, filters));
    } catch (e) {
      setListError(e as BuzonApiError);
    } finally {
      setLoading(false);
    }
  }, [companyId, filters]);

  useEffect(() => {
    if (!Number.isFinite(companyId) || companyId <= 0) return;
    void load();
  }, [companyId, load]);

  const state: BuzonSync | null = detail?.state ?? null;
  const hasKey = company?.sol_configurado ?? false;
  const blocked = !!state?.blocked;
  const otherRunning = !!detail && detail.running !== 0 && detail.running !== companyId;

  const sync = async () => {
    setSyncError(null);
    const t = startTask({
      tool: 'buzon',
      toolLabel: 'Buzón SOL',
      companyId,
      companyName: company?.business_name || `Empresa ${companyId}`,
      detail: 'Sincronización del buzón',
      href: `/tools/notificaciones-sunat/${companyId}`,
    });
    ownTask.current = t.id;
    try {
      const st = await sunatBuzonService.sync(companyId);
      finishTask(t.id, {
        summary: st.nuevos > 0 ? `${st.nuevos} ${st.nuevos === 1 ? 'novedad' : 'novedades'} en el buzón` : 'Buzón sincronizado, sin novedades',
      });
      setFilters((f) => ({ ...f, page: 1 }));
      await load();
    } catch (e) {
      failTask(t.id, e);
      setSyncError(e as BuzonApiError);
      await load();
    }
  };

  // Salió de la pantalla durante la sincronización y volvió: lo sincronizado ya está guardado en el servidor.
  useTaskSettled(taskKey('buzon', companyId), ownTask, (done) => {
    if (done.status === 'error') setSyncError({ message: done.errorMessage ?? 'SUNAT no respondió. Intente de nuevo.' } as BuzonApiError);
    else void notify.success('Buzón sincronizado');
    setFilters((f) => ({ ...f, page: 1 }));
    void load();
  });

  const markSeen = async () => {
    try {
      await sunatBuzonService.markSeen(companyId);
      void notify.success('Novedades marcadas como vistas');
      await load();
    } catch (e) {
      setListError(e as BuzonApiError);
    }
  };

  const setFilter = (patch: Partial<BuzonFilters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;
  }

  const badge = company ? buzonBadge(company, state ?? undefined) : null;
  const total = detail?.messages.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = filters.page ?? 1;
  const neverSynced = !!detail && !state?.last_success_at;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Link to="/tools/notificaciones-sunat" title="Volver a la lista" aria-label="Volver a la lista" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary-700">
            <i className="fas fa-arrow-left text-xs" aria-hidden />
          </Link>
          <PageHeading>{company?.business_name || 'Notificaciones SUNAT'}</PageHeading>
          <p className="text-sm font-medium text-slate-500">{company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}</p>
        </div>
      </div>

      {companyError ? <Alert variant="error">{companyError}</Alert> : null}

      {company ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <span className="block text-[10px] font-semibold uppercase text-slate-400">Estado</span>
            {badge ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span> : null}
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase text-slate-400">Última sincronización</span>
            <span className="text-sm font-medium text-slate-800" title={fmtDateTime(state?.last_success_at)}>
              {state?.last_success_at ? timeAgo(state.last_success_at) : 'nunca'}
            </span>
            {state?.last_success_at ? <span className="ml-1 text-xs text-slate-500">({state.source === 'nocturna' ? 'nocturna' : 'manual'})</span> : null}
          </div>
          {[
            ['Notificaciones', state?.notificaciones],
            ['Mensajes', state?.mensajes],
            ['No leídas', state?.no_leidas],
            ['Urgentes sin leer', state?.urgentes],
            ['Nuevas', state?.nuevos],
          ].map(([label, v]) => (
            <div key={label as string}>
              <span className="block text-[10px] font-semibold uppercase text-slate-400">{label}</span>
              <span className="text-sm font-bold text-slate-800">{state?.last_success_at ? (v as number) : '—'}</span>
            </div>
          ))}
          <Button className="ml-auto" disabled={syncing || !hasKey || blocked || otherRunning} onClick={() => void sync()} title={!hasKey ? 'La empresa no tiene clave SOL' : undefined}>
            <i className={`fas ${syncing ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1.5`} aria-hidden />
            {syncing ? 'Sincronizando…' : 'Sincronizar'}
          </Button>
        </div>
      ) : null}

      {company && !hasKey ? (
        <Alert variant="warning">
          <strong>Sin clave:</strong> la empresa no tiene usuario o clave SOL cargados, así que no se puede sincronizar. Complételos en{' '}
          <Link to="/finance/claves-sol" className="font-semibold underline">
            Claves SOL
          </Link>{' '}
          (botón Editar).
        </Alert>
      ) : null}
      {blocked ? (
        <BuzonError
          error={{
            message: state?.error_message || 'SUNAT rechazó el usuario o la clave SOL de esta empresa. Corríjalos en Claves SOL (Editar) para volver a sincronizar.',
            code: 'credenciales_rechazadas',
          }}
        />
      ) : null}
      {otherRunning ? (
        <Alert variant="info">
          Se está sincronizando otra empresa. Espere a que termine para sincronizar esta.
        </Alert>
      ) : null}
      <LongTaskPanel task={task} title="Sincronizando el buzón con SUNAT" hint="Entra a SOL con la clave de la empresa y lee el buzón. Puede seguir usando el sistema." />
      {syncError ? <BuzonError error={syncError} /> : null}
      {!syncError && !blocked && state?.status === 'error' && state.error_message ? (
        <Alert variant="warning">
          El último intento ({timeAgo(state.last_attempt_at)}) falló: {state.error_message}
        </Alert>
      ) : null}
      {hasKey && !syncing ? (
        <p className="text-xs text-slate-500">
          Al sincronizar se inicia sesión en SUNAT con la clave de esta empresa. Si alguien tiene esta empresa abierta en SUNAT en este momento, esa sesión se cerrará.
        </p>
      ) : null}

      {detail && !neverSynced ? (
        <Card
          title="Buzón guardado"
          subtitle="Es lo que había en SUNAT al sincronizar. No se abre ningún mensaje, así que no se marcan como leídos en SUNAT."
          actions={
            (state?.nuevos ?? 0) > 0 ? (
              <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => void markSeen()}>
                <i className="fas fa-check-double mr-1.5" aria-hidden />
                Marcar nuevas como vistas
              </Button>
            ) : undefined
          }
        >
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Tipo">
              {(
                [
                  [0, 'Todo'],
                  [2, 'Notificaciones'],
                  [1, 'Mensajes'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={(filters.tipo ?? 0) === v}
                  onClick={() => setFilter({ tipo: v })}
                  className={`px-3 py-1.5 text-sm font-semibold ${(filters.tipo ?? 0) === v ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="text-xs text-slate-600">
              <span className="mb-0.5 block">Etiqueta</span>
              <select value={filters.etiqueta ?? ''} onChange={(e) => setFilter({ etiqueta: e.target.value })} className={`${SELECT_CLS} !py-1.5`}>
                <option value="">Todas</option>
                {Object.entries(detail.etiquetas)
                  .filter(([code]) => code !== '00')
                  .map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
              </select>
            </label>
            {(
              [
                ['no_leidas', 'No leídas'],
                ['urgentes', 'Urgentes'],
                ['nuevos', 'Nuevas'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={!!filters[key]} onChange={(e) => setFilter({ [key]: e.target.checked })} />
                {label}
              </label>
            ))}
            <form
              className="ml-auto"
              onSubmit={(e) => {
                e.preventDefault();
                setFilter({ q: qInput });
              }}
            >
              <label className="text-xs text-slate-600">
                <span className="mb-0.5 block">Buscar en el asunto</span>
                <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Ej.: orden de pago" className={`${INPUT_CLS} w-60 !py-1.5`} />
              </label>
            </form>
          </div>

          {listError ? <BuzonError error={listError} /> : null}
          <div className={`overflow-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="min-w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase">
                  {['Publicada', 'Tipo', 'Asunto', 'Etiqueta', 'Adj.', 'Estado'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-slate-200 px-2 py-1.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.messages.rows.map((m) => (
                  <tr key={m.id} className={`border-b border-slate-100 align-top ${m.es_nuevo ? 'bg-red-50/50' : ''}`}>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-600">{m.fec_publica_texto}</td>
                    <td className="whitespace-nowrap px-2 py-2">{m.tipo === 2 ? 'Notificación' : 'Mensaje'}</td>
                    <td className={`px-2 py-2 ${m.leido ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>
                      {m.es_nuevo ? <span className="mr-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Nuevo</span> : null}
                      {m.urgente ? <i className="fas fa-flag mr-1 text-red-600" title="Urgente" aria-label="Urgente" /> : null}
                      {m.asunto}
                    </td>
                    <td className="px-2 py-2">
                      {m.cod_etiqueta && m.cod_etiqueta !== '00' ? (
                        <span className={`whitespace-nowrap rounded px-1.5 py-0.5 font-medium ${ETIQUETA_BADGE[m.cod_etiqueta] ?? 'bg-slate-100 text-slate-700'}`}>
                          {detail.etiquetas[m.cod_etiqueta] ?? m.cod_etiqueta}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">{m.adjuntos > 0 ? <i className="fas fa-paperclip text-slate-500" title={`${m.adjuntos} adjunto(s)`} /> : ''}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${m.leido ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>{m.leido ? 'Leído' : 'No leído'}</span>
                    </td>
                  </tr>
                ))}
                {detail.messages.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-8 text-center text-slate-500">
                      Nada coincide con los filtros.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {pages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
              <span>
                Página {page} de {pages} · {total} en total
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" className="!px-3 !py-1" disabled={page <= 1 || loading} onClick={() => setFilters((f) => ({ ...f, page: page - 1 }))}>
                  Anterior
                </Button>
                <Button variant="secondary" className="!px-3 !py-1" disabled={page >= pages || loading} onClick={() => setFilters((f) => ({ ...f, page: page + 1 }))}>
                  Siguiente
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {detail && neverSynced && hasKey && !blocked ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Esta empresa aún no se ha sincronizado. Pulse <strong>Sincronizar</strong> para traer su buzón de SUNAT (la sincronización nocturna lo hará sola a la 1:00 a. m.).
        </div>
      ) : null}
      {loading && !detail ? <Spinner label="Cargando lo guardado…" /> : null}
      {listError && !detail ? <BuzonError error={listError} /> : null}
    </div>
  );
};

export default BuzonCompany;
