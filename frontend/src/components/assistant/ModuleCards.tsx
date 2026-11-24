import type { AssistantModuleProgress } from '../../services/supervisors';

/**
 * Las tarjetas de actividades (módulos) con su avance: tareas completadas de las que aplican. Al pulsar una se abre el modal con el
 * consolidado por último dígito del RUC y la lista de empresas. Las usan el panel del asistente y el dashboard del supervisor.
 */
const ModuleCards = ({ modules, onOpen }: { modules: AssistantModuleProgress[]; onOpen: (m: AssistantModuleProgress) => void }) => (
  <div className="mt-3 flex flex-wrap gap-x-[22px] gap-y-[10px]">
    {modules.map((m) => {
      const left = m.total - m.completed;
      return (
        <button
          key={m.key}
          type="button"
          onClick={() => onOpen(m)}
          className="block min-w-0 cursor-pointer rounded-xl border border-[#EAF1ED] bg-transparent px-3 py-[10px] text-left text-inherit hover:bg-slate-50/60"
          style={{ flex: '1 1 280px' }}
          aria-label={`${m.label}: ver las empresas con tareas por hacer`}
        >
          <div className="mb-[6px] flex items-center justify-between gap-2">
            <strong className="text-[12.5px]">
              {m.label}
              {m.owner === 'supervisor' ? <span className="ml-2 rounded-md bg-violet-50 px-[6px] py-px text-[10px] font-bold text-violet-800">Supervisor</span> : null}
            </strong>
            <span className="flex items-center gap-2">
              {left > 0 ? <span className="rounded-[7px] bg-amber-100 px-[7px] py-px text-[10.5px] font-extrabold text-amber-800">{left.toLocaleString('es-PE')} por hacer</span> : null}
              <span className="text-[11px] font-bold text-[#0A5A3A]">Ver pendientes →</span>
            </span>
          </div>
          <div className="flex items-center gap-[10px]">
            <div className="h-2 flex-1 overflow-hidden rounded bg-[#EEF3F0]">
              <div className="h-full rounded" style={{ width: `${m.pct}%`, background: m.pct >= 75 ? '#12A150' : m.pct >= 50 ? '#F59E0B' : '#DC2626' }} />
            </div>
            <span className="w-[112px] text-right text-[11.5px] font-extrabold tabular-nums">
              {m.completed.toLocaleString('es-PE')} / {m.total.toLocaleString('es-PE')} · {Math.round(m.pct)}%
            </span>
          </div>
          {m.planilla && m.planilla.workers > 0 ? (
            <p className="m-0 mt-[6px] text-[11px] text-slate-500">
              <i className="fas fa-users mr-1 text-slate-400" aria-hidden />
              <strong className="text-slate-700">{m.planilla.workers.toLocaleString('es-PE')}</strong> trabajadores en {m.planilla.companies.toLocaleString('es-PE')} empresas
              {m.planilla.by_assistant.length > 1 ? (
                <span>
                  {' '}
                  · mayor carga: <strong className="text-slate-700">{m.planilla.by_assistant[0].name}</strong> ({m.planilla.by_assistant[0].workers.toLocaleString('es-PE')})
                </span>
              ) : null}
            </p>
          ) : null}
        </button>
      );
    })}
  </div>
);

export default ModuleCards;
