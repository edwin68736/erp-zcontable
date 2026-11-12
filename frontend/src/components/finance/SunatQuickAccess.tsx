import { useEffect, useMemo, useState } from 'react';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../services/companyAccessCredentials';
import { SUNAT_TARGETS, solAccessMissing, type SunatAccessTarget } from '../../utils/sunatSol';
import { notify } from '../../utils/notify';
import SunatAccessModal from './SunatAccessModal';

/** Por defecto SUNAT y Pagos (los dos del Menú SOL); SUNAFIL no se ofrece aquí. */
const DEFAULT_TARGETS: SunatAccessTarget[] = ['sunat', 'pagos'];

/**
 * Acceso directo a SUNAT de UNA empresa, con los mismos botones y el mismo flujo que la pantalla de Claves SOL: genera el enlace de
 * ingreso en el servidor y lo abre en una pestaña nueva. Se pone arriba de las pantallas de trabajo de la empresa para no tener que ir
 * a Claves SOL. Solo se muestra a quien puede ver claves SOL; si falta el usuario o la clave, los botones salen apagados.
 */
export default function SunatQuickAccess({ companyId, targets = DEFAULT_TARGETS }: { companyId: number; targets?: SunatAccessTarget[] }) {
  const canView = useMemo(() => auth.hasPermission(P.companyCredentialsView), []);
  const [row, setRow] = useState<CompanyAccessCredentialRow | null>(null);
  const [failed, setFailed] = useState(false);
  const [modalTarget, setModalTarget] = useState<SunatAccessTarget | null>(null);

  useEffect(() => {
    if (!canView || !Number.isFinite(companyId) || companyId <= 0) return;
    let alive = true;
    setFailed(false);
    companyAccessCredentialsService
      .get(companyId)
      .then((r) => {
        if (alive) setRow(r);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [canView, companyId]);

  if (!canView || failed) return null;

  const missing = row ? solAccessMissing(row) : '';

  const open = (t: SunatAccessTarget) => {
    if (!row) return;
    if (missing) {
      notify.warning('Faltan datos', `${row.business_name || 'La empresa'} no tiene ${missing} cargado: complételo en Claves SOL.`);
      return;
    }
    setModalTarget(t);
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Acceso directo a SUNAT">
        <span className="text-xs font-semibold text-slate-500">Acceso directo</span>
        {targets.map((t) => {
          const { label, image, imageWidth } = SUNAT_TARGETS[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => open(t)}
              disabled={!row || Boolean(missing)}
              title={!row ? 'Cargando…' : missing ? `Falta ${missing}: complételo en Claves SOL` : `Ingresar a ${label} con la clave SOL de esta empresa (abre una pestaña nueva)`}
              aria-label={`Ingresar a ${label} como ${row?.business_name || 'la empresa'}`}
              className="inline-flex shrink-0 rounded-full bg-white ring-1 ring-slate-200 transition hover:shadow-sm hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale disabled:hover:shadow-none disabled:hover:brightness-100"
            >
              <img src={image} width={imageWidth} height={96} alt="" aria-hidden draggable={false} className="h-6 w-auto max-w-none shrink-0 select-none" />
            </button>
          );
        })}
      </div>
      {modalTarget && row ? <SunatAccessModal row={row} target={modalTarget} onClose={() => setModalTarget(null)} /> : null}
    </>
  );
}
