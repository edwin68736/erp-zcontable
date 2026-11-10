import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import RhConfirmPanel from './RhConfirmPanel';
import RhSolPanel from './RhSolPanel';

const TABS = [
  { key: 'recibidos', label: 'Recibos recibidos', hint: 'Todos los recibos por honorarios emitidos a la empresa (SUNAT Operaciones en Línea)' },
  { key: 'confirmacion', label: 'Pendientes de confirmación', hint: 'Plataforma de confirmación del RHE y de la FE (API de SUNAT): solo comprobantes pendientes, subsanados o disconformes' },
] as const;

/**
 * Herramientas → RH → una empresa. Dos fuentes de SUNAT, en pestañas:
 *  - «Recibos recibidos» (por defecto): lee en SOL la consulta de receptor, con todos los recibos por honorarios.
 *  - «Pendientes de confirmación»: la API de la plataforma de confirmación del RHE y de la FE (estados de confirmación).
 */
const RhCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'confirmacion' ? 'confirmacion' : 'recibidos';
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');

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

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="pt-4 text-sm text-red-700">Empresa no válida.</p>;
  }

  const selectTab = (key: (typeof TABS)[number]['key']) => {
    const next = new URLSearchParams(params);
    if (key === 'recibidos') next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Link to="/tools/rh" title="Volver a la lista" aria-label="Volver a la lista" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-primary-700">
            <i className="fas fa-arrow-left text-xs" aria-hidden />
          </Link>
          <PageHeading>{company?.business_name || 'RH'}</PageHeading>
          <p className="text-sm font-medium text-slate-500">{company ? `RUC ${company.ruc} · Cod ${company.code}` : companyError || 'Cargando empresa…'}</p>
        </div>
      </div>

      {companyError ? <Alert variant="error">{companyError}</Alert> : null}

      <div role="tablist" aria-label="Fuente de los recibos" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            title={t.hint}
            onClick={() => selectTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'recibidos' ? <RhSolPanel companyId={companyId} company={company} /> : <RhConfirmPanel companyId={companyId} company={company} />}
    </div>
  );
};

export default RhCompany;
