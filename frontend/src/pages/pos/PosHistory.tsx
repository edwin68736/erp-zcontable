import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import PosReceiptModal from '../../components/pos/PosReceiptModal';
import { posSalesService, type PosSaleDetail } from '../../services/posSales';
import type { TukifacFiscalReceipt } from '../../types/dashboard';
import Pagination from '../../components/Pagination';
import { configService } from '../../services/config';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';

const PosHistory = () => {
  const [list, setList] = useState<TukifacFiscalReceipt[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [pagination, setPagination] = useState({ page: 1, per_page: 20, total: 0, total_pages: 0 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<PosSaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [firm, setFirm] = useState<{
    name?: string;
    ruc?: string;
    address?: string;
    phone?: string;
    email?: string;
    logo_url?: string;
    statement_bank_info?: string;
  }>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await posSalesService.listHistory(page, perPage);
      setList(res.items);
      setPagination(res.pagination);
    } finally {
      setLoading(false);
    }
  }, [page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void configService.getFirmBranding().then((f) =>
      setFirm({
        name: f.name,
        ruc: f.ruc,
        address: f.address,
        phone: f.phone,
        email: f.email,
        logo_url: f.logo_url,
        statement_bank_info: f.statement_bank_info,
      }),
    );
  }, []);

  const openReceipt = async (id: number) => {
    setDetailLoading(true);
    try {
      const full = await posSalesService.getDetail(id);
      setDetail(full);
    } finally {
      setDetailLoading(false);
    }
  };

  if (!auth.hasPermission(P.salesHistory)) {
    return <Navigate to="/pos" replace />;
  }

  return (
    <div className={PAGE_WORKSPACE_CLASS}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Mis comprobantes</h1>
          <p className="text-sm text-slate-500">Ventas emitidas desde el punto de venta</p>
        </div>
        <Link
          to="/pos"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        >
          <i className="fas fa-plus text-xs" />
          Nueva venta
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            <i className="fas fa-spinner fa-spin mr-2" />
            Cargando comprobantes…
          </p>
        ) : list.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-slate-500">
            Aún no hay comprobantes emitidos desde el POS.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Número</th>
                    <th className="text-left px-4 py-3 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 font-medium">Fecha</th>
                    <th className="text-right px-4 py-3 font-medium">Total</th>
                    <th className="text-right px-4 py-3 font-medium w-36">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-mono text-xs text-slate-800">{r.number}</td>
                      <td className="px-4 py-3 text-slate-800">{r.customer_name}</td>
                      <td className="px-4 py-3 text-slate-600">{(r.issue_date ?? '').slice(0, 10)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-800">
                        S/ {Number(r.total).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={detailLoading}
                          className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-800 hover:bg-primary-100 disabled:opacity-50"
                          onClick={() => void openReceipt(r.id)}
                        >
                          <i className="fas fa-eye" />
                          Ver / imprimir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-2 py-2">
              <Pagination
                page={pagination.page || page}
                perPage={pagination.per_page || perPage}
                total={pagination.total ?? 0}
                onPageChange={setPage}
                onPerPageChange={(n) => {
                  setPerPage(n);
                  setPage(1);
                }}
              />
            </div>
          </>
        )}
      </div>

      <PosReceiptModal
        open={Boolean(detail)}
        receipt={detail}
        firm={firm}
        variant="history"
        onClose={() => setDetail(null)}
      />
    </div>
  );
};

export default PosHistory;
