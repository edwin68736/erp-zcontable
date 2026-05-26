import { Navigate, useSearchParams } from 'react-router-dom';

/** Redirige la ruta legacy al listado unificado de comprobantes. */
const FiscalReceipts = () => {
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  if (!next.get('status')) {
    next.set('status', 'pendiente_vincular');
  }
  const q = next.toString();
  return <Navigate to={q ? `/comprobantes?${q}` : '/comprobantes?status=pendiente_vincular'} replace />;
};

export default FiscalReceipts;
