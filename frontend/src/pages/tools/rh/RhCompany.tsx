import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import PageHeading from '../../../components/ui/PageHeading';
import { companyAccessCredentialsService, type CompanyAccessCredentialRow } from '../../../services/companyAccessCredentials';
import RhSolPanel from './RhSolPanel';

/**
 * Herramientas → RH → una empresa: lee en SOL la consulta de receptor (o la de emisor, solo personas naturales con RUC 10,
 * que se elige en el formulario) y arma el PDF y el Excel de los recibos por honorarios.
 */
const RhCompany = () => {
  const { companyId: rawId } = useParams();
  const companyId = Number(rawId);
  const [params] = useSearchParams();
  const [company, setCompany] = useState<CompanyAccessCredentialRow | null>(null);
  const [companyError, setCompanyError] = useState('');
  // Los avisos y enlaces de consultas de recibos emitidos (?tab=emitidos) abren el formulario ya en «Emisor».
  const initialLado = params.get('tab') === 'emitidos' && (company?.ruc ?? '').startsWith('10') ? 'emisor' : 'receptor';

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

      <RhSolPanel key={`recibos-${initialLado}`} companyId={companyId} company={company} initialLado={initialLado} />
    </div>
  );
};

export default RhCompany;
