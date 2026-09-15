import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Company, VoidedPayment } from '../types/dashboard';
import { paymentsService } from '../services/payments';
import type { PaginationMeta as ApiPaginationMeta } from '../services/payments';
import { companiesService } from '../services/companies';
import SearchableSelect from '../components/SearchableSelect';
import Pagination from '../components/Pagination';

// Fase 7 (docs/diseno-fase7-paso2-ui-reportes-2026-09-15.md D.2): vía de auditoría de pagos anulados.
// Pantalla de SOLO LECTURA, con ruta propia — deliberadamente NUNCA comparte tabla/estado con
// Payments.tsx (el listado activo). No ofrece ninguna acción de pago activo (editar, eliminar,
// aplicar, emitir comprobante): cada fila ya está anulada y es historial, no un registro operable.

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return '—';
  return `${day}/${m}/${y}`;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return formatDate(iso);
  }
}

function purposeLabel(purpose?: string | null): string {
  if (purpose === 'deuda') return 'Deuda';
  if (purpose === 'servicio') return 'Servicio';
  return 'Sin clasificar';
}

function purposeClass(purpose?: string | null): string {
  if (purpose === 'deuda') return 'bg-primary-50 text-primary-700 border border-primary-200';
  if (purpose === 'servicio') return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
  return 'bg-slate-50 text-slate-500 border border-slate-200';
}

function debtOrSettlementInfo(p: VoidedPayment): string {
  const parts: string[] = [];
  if (p.document?.number) parts.push(`Deuda ${p.document.number}`);
  const allocDocs = (p.allocations ?? [])
    .map((a) => a.document?.number)
    .filter((n): n is string => Boolean(n));
  if (allocDocs.length > 0) parts.push(`Deuda(s) ${Array.from(new Set(allocDocs)).join(', ')}`);
  if (p.tax_settlement?.number) parts.push(`Liquidación ${p.tax_settlement.number}`);
  return parts.length > 0 ? parts.join(' · ') : 'Sin deuda/liquidación asociada';
}

const PaymentsVoided = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [payments, setPayments] = useState<VoidedPayment[]>([]);
  const [pagination, setPagination] = useState<ApiPaginationMeta>({ page: 1, per_page: 20, total: 0, total_pages: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    companiesService
      .list()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, []);

  const fetchVoided = async (page = 1, perPage = pagination.per_page) => {
    try {
      setLoading(true);
      setError('');
      const res = await paymentsService.listVoided({
        company_id: companyId || undefined,
        page,
        per_page: perPage,
      });
      setPayments(res.items);
      setPagination(res.pagination);
    } catch (e) {
      console.error(e);
      setError('Error al cargar los pagos anulados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVoided(1, pagination.per_page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const handlePageChange = (nextPage: number) => fetchVoided(nextPage, pagination.per_page);
  const handlePerPageChange = (nextPerPage: number) => fetchVoided(1, nextPerPage);

  const companyOptions = useMemo(
    () => [{ value: '', label: 'Todas' }, ...companies.map((c) => ({ value: String(c.id), label: c.business_name }))],
    [companies],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-800">Pagos anulados</h2>
          <p className="text-sm text-slate-500">
            Vía de auditoría de solo lectura. Estos pagos NO participan en ningún cálculo financiero ni
            aparecen en el listado normal de pagos.
          </p>
        </div>
        <Link
          to="/payments"
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <i className="fas fa-arrow-left text-xs"></i>
          <span>Volver a Pagos</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Empresa</label>
          <SearchableSelect
            value={companyId}
            onChange={setCompanyId}
            className="min-w-[220px]"
            searchPlaceholder="Buscar empresa..."
            options={companyOptions}
          />
        </div>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div> : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm text-left">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3 text-right">Monto</th>
              <th className="px-4 py-3">Fecha del pago</th>
              <th className="px-4 py-3">Fecha de anulación</th>
              <th className="px-4 py-3">Anulado por</th>
              <th className="px-4 py-3">Motivo</th>
              <th className="px-4 py-3">Propósito</th>
              <th className="px-4 py-3">Método / Referencia</th>
              <th className="px-4 py-3">Comprobante</th>
              <th className="px-4 py-3">Deuda / Liquidación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && payments.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-slate-500 text-sm">
                  <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
                </td>
              </tr>
            ) : payments.length > 0 ? (
              payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 align-top">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-white">
                      ANULADO
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-800 font-medium">{p.company?.business_name ?? '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700 line-through decoration-slate-400">
                    S/ {Number(p.amount ?? 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums whitespace-nowrap">{formatDate(p.date)}</td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums whitespace-nowrap">{formatDateTime(p.voided_at)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {p.voided_by_user?.name || (p.voided_by ? `Usuario #${p.voided_by}` : '—')}
                  </td>
                  <td className="px-4 py-3 text-slate-700 max-w-[240px]">
                    <span className="line-clamp-3">{p.void_reason || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${purposeClass(p.purpose)}`}>
                      {purposeLabel(p.purpose)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {p.method || '—'}
                    {p.reference ? <span className="text-xs text-slate-500 block">{p.reference}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 italic max-w-[180px]">
                    Se desvinculó al anular
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-xs max-w-[220px]">{debtOrSettlementInfo(p)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-slate-500 text-sm">
                  {loading ? 'Cargando...' : 'No hay pagos anulados para los filtros seleccionados.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-slate-100">
          <Pagination
            page={pagination.page || 1}
            perPage={pagination.per_page || 20}
            total={pagination.total ?? 0}
            onPageChange={handlePageChange}
            onPerPageChange={handlePerPageChange}
          />
        </div>
      </div>
    </div>
  );
};

export default PaymentsVoided;
