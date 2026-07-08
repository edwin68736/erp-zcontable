import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { ActivityWorkspace } from '../../navigation/activityRoutes';

type LegacyDetraccionesRedirectProps = {
  workspace: ActivityWorkspace;
};

/** Redirige rutas legacy F4 /activities/distractions → /activities/detracciones (una versión). */
export function LegacyDetraccionesRedirect({ workspace }: LegacyDetraccionesRedirectProps) {
  const { companyId } = useParams();
  const [searchParams] = useSearchParams();
  const base =
    workspace === 'assistant' ? '/assistant/activities/detracciones' : '/supervisors/activities/detracciones';
  const q = searchParams.toString();
  const suffix = companyId ? `/${companyId}` : '';
  const query = q ? `?${q}` : '';
  return <Navigate to={`${base}${suffix}${query}`} replace />;
}
