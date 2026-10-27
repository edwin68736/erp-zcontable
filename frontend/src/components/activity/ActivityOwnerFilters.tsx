import { useEffect, useMemo, useState } from 'react';
import { ownerFilterAccess } from '../../utils/activityOwnerAccess';
import { companyAccessCredentialsService, type CompanyAccessCredentialFilterFacets } from '../../services/companyAccessCredentials';

type Props = {
  assistantId: number | null;
  supervisorId: number | null;
  onAssistantChange: (id: number | null) => void;
  onSupervisorChange: (id: number | null) => void;
};

const SELECT_CLS =
  'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500';

// Las opciones salen de la misma consulta que usa Claves SOL (usuarios con empresas en el alcance del usuario). Se
// comparte entre los listados abiertos seguidos para no repetir la petición en cada cambio de pantalla.
let facetsCache: { at: number; promise: Promise<CompanyAccessCredentialFilterFacets> } | null = null;
function loadFacets(): Promise<CompanyAccessCredentialFilterFacets> {
  const now = Date.now();
  if (!facetsCache || now - facetsCache.at > 60_000) {
    const promise = companyAccessCredentialsService.filterFacets();
    promise.catch(() => {
      facetsCache = null;
    });
    facetsCache = { at: now, promise };
  }
  return facetsCache.promise;
}

/**
 * Filtros "Supervisor" y "Asistente" de los listados de actividades (Buzón SOL, Preliminar, Detracciones, PDT
 * 601/621, informes). El administrador ve ambos —sea en la vista de supervisores o la de asistentes—; el
 * supervisor ve solo el de asistente; el asistente no ve ninguno (solo tiene sus empresas).
 */
export default function ActivityOwnerFilters({ assistantId, supervisorId, onAssistantChange, onSupervisorChange }: Props) {
  const access = useMemo(() => ownerFilterAccess(), []);
  const [facets, setFacets] = useState<CompanyAccessCredentialFilterFacets | null>(null);

  useEffect(() => {
    if (!access.assistant && !access.supervisor) return;
    let cancelled = false;
    void loadFacets()
      .then((f) => {
        if (!cancelled) setFacets(f);
      })
      .catch(() => {
        if (!cancelled) setFacets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [access]);

  if (!access.assistant && !access.supervisor) return null;

  return (
    <>
      {access.supervisor ? (
        <div className="min-w-[10rem]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Supervisor</label>
          <select
            value={supervisorId ?? ''}
            onChange={(e) => onSupervisorChange(e.target.value ? Number(e.target.value) : null)}
            className={SELECT_CLS}
          >
            <option value="">Todos</option>
            {(facets?.supervisors ?? []).map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.username}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {access.assistant ? (
        <div className="min-w-[10rem]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Asistente</label>
          <select
            value={assistantId ?? ''}
            onChange={(e) => onAssistantChange(e.target.value ? Number(e.target.value) : null)}
            className={SELECT_CLS}
          >
            <option value="">Todos</option>
            {(facets?.assistants ?? []).map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.username}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}
