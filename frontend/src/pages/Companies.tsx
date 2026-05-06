import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { companiesService, type CompanyUpsertInput } from '../services/companies';
import type { PaginationMeta as ApiPaginationMeta } from '../services/companies';
import { usersService } from '../services/users';
import { auth } from '../services/auth';
import { formatUserPickLabel } from '../utils/userLabel';
import { Company, User } from '../types/dashboard';
import SearchableSelect from '../components/SearchableSelect';
import Pagination from '../components/Pagination';

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i <= 0) return fallback;
  return i;
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const Companies = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const initialStatus = searchParams.get('status') ?? '';
  const initialPage = parsePositiveInt(searchParams.get('page'), 1);
  const initialPerPage = parsePositiveInt(searchParams.get('per_page'), 20);
  /** Orden por código (URL). */
  const codeOrderSort: 'asc' | 'desc' = searchParams.get('code_order') === 'desc' ? 'desc' : 'asc';
  /** Cadena estable: al mutar URLSearchParams a veces no cambia la referencia; así el listado se refresca siempre. */
  const searchKey = searchParams.toString();
  const success = searchParams.get('success') ?? '';

  const [query, setQuery] = useState(() => initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const debouncedQuery = useDebouncedValue(query, 400);
  const lastPushedQueryKey = useRef<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<ApiPaginationMeta>({
    page: initialPage,
    per_page: initialPerPage,
    total: 0,
    total_pages: 0,
  });
  const role = auth.getRole() ?? '';
  const isAdmin = role === 'Administrador';
  const canUpsert = role === 'Administrador' || role === 'Supervisor';
  const canDelete = role === 'Administrador';

  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamCompany, setTeamCompany] = useState<Company | null>(null);
  const [teamUsers, setTeamUsers] = useState<User[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [teamSupervisorId, setTeamSupervisorId] = useState('');
  const [teamAssistantId, setTeamAssistantId] = useState('');
  const [teamAccountantId, setTeamAccountantId] = useState('');
  const [statusUpdatingId, setStatusUpdatingId] = useState<number | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importValidateLoading, setImportValidateLoading] = useState(false);
  const [importCommitLoading, setImportCommitLoading] = useState(false);
  const [importErrors, setImportErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [importRowCount, setImportRowCount] = useState(0);
  const [importValidatedOk, setImportValidatedOk] = useState(false);
  const [importBanner, setImportBanner] = useState('');

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    const qApplied = trimmed.length >= 3 ? trimmed : '';
    const key = qApplied;
    if (lastPushedQueryKey.current === key) return;
    lastPushedQueryKey.current = key;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (qApplied) next.set('q', qApplied);
        else next.delete('q');
        next.set('page', '1');
        if (next.get('per_page') == null) next.set('per_page', String(initialPerPage));
        next.delete('success');
        return next;
      },
      { replace: true },
    );
  }, [debouncedQuery, initialPerPage, setSearchParams]);

  useEffect(() => {
    if (!success) return;
    const message =
      success === 'created'
        ? 'Empresa creada correctamente.'
        : success === 'updated'
          ? 'Empresa actualizada correctamente.'
          : success === 'deleted'
            ? 'Empresa eliminada correctamente.'
            : '';
    if (message) {
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'success', message } }));
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('success');
      return next;
    }, { replace: true });
  }, [setSearchParams, success]);

  const handleCompanyStatusChange = async (company: Company, next: 'activo' | 'inactivo') => {
    if (company.status === next) return;
    try {
      setStatusUpdatingId(company.id);
      await companiesService.patchStatus(company.id, next);
      setCompanies((prev) => prev.map((c) => (c.id === company.id ? { ...c, status: next } : c)));
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Estado de la empresa actualizado.' } }),
      );
    } catch (e) {
      console.error(e);
      const ax = e as { response?: { data?: { error?: string } } };
      const msg = ax.response?.data?.error ?? 'No se pudo actualizar el estado';
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type: 'error', message: msg } }));
      void reloadCompanies();
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const reloadCompanies = useCallback(async () => {
    const sp = new URLSearchParams(searchKey);
    const qRaw = (sp.get('q') ?? '').trim();
    const stRaw = (sp.get('status') ?? '').trim();
    try {
      setLoading(true);
      const res = await companiesService.listPaged({
        q: qRaw || undefined,
        status: stRaw || undefined,
        code_order: sp.get('code_order') === 'desc' ? 'desc' : 'asc',
        page: parsePositiveInt(sp.get('page'), 1),
        per_page: parsePositiveInt(sp.get('per_page'), 20),
      });
      setCompanies(res.items);
      setPagination(res.pagination);
    } catch (error) {
      console.error('Error fetching companies:', error);
    } finally {
      setLoading(false);
    }
  }, [searchKey]);

  useEffect(() => {
    void reloadCompanies();
  }, [reloadCompanies]);

  const openTeamModal = async (company: Company) => {
    setTeamModalOpen(true);
    setTeamCompany(null);
    setTeamUsers([]);
    setTeamError('');
    setTeamSupervisorId(company.supervisor_user_id ? String(company.supervisor_user_id) : '');
    setTeamAssistantId(company.assistant_user_id ? String(company.assistant_user_id) : '');
    setTeamAccountantId(company.accountant_user_id ? String(company.accountant_user_id) : '');

    try {
      setTeamLoading(true);
      const [c, list] = await Promise.all([
        companiesService.get(company.id),
        isAdmin ? usersService.list() : Promise.resolve([] as User[]),
      ]);
      setTeamCompany(c);
      setTeamUsers(list);
      setTeamSupervisorId(c.supervisor_user_id ? String(c.supervisor_user_id) : '');
      setTeamAssistantId(c.assistant_user_id ? String(c.assistant_user_id) : '');
      setTeamAccountantId(c.accountant_user_id ? String(c.accountant_user_id) : '');
    } catch (e) {
      console.error(e);
      setTeamError('Error al cargar el equipo contable');
    } finally {
      setTeamLoading(false);
    }
  };

  const closeTeamModal = () => {
    setTeamModalOpen(false);
    setTeamCompany(null);
    setTeamUsers([]);
    setTeamError('');
  };

  const handleSaveTeam = async () => {
    if (!teamCompany) return;

    const supervisorNum = Number(teamSupervisorId);
    const assistantNum = Number(teamAssistantId);
    const accountantNum = Number(teamAccountantId);

    const payload: CompanyUpsertInput = {
      ruc: teamCompany.ruc,
      business_name: teamCompany.business_name,
      code: teamCompany.code,
      status: teamCompany.status,
      trade_name: teamCompany.trade_name || undefined,
      address: teamCompany.address || undefined,
      phone: teamCompany.phone || undefined,
      email: teamCompany.email || undefined,
      service_start_at: teamCompany.service_start_at || undefined,
      supervisor_user_id: Number.isFinite(supervisorNum) && supervisorNum > 0 ? supervisorNum : 0,
      assistant_user_id: Number.isFinite(assistantNum) && assistantNum > 0 ? assistantNum : 0,
      accountant_user_id: Number.isFinite(accountantNum) && accountantNum > 0 ? accountantNum : 0,
    };

    try {
      setTeamSaving(true);
      setTeamError('');
      const updated = await companiesService.update(teamCompany.id, payload);
      setTeamCompany(updated);
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === updated.id
            ? {
                ...c,
                supervisor_user_id: updated.supervisor_user_id ?? null,
                assistant_user_id: updated.assistant_user_id ?? null,
                accountant_user_id: updated.accountant_user_id ?? null,
              }
            : c,
        ),
      );
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Equipo contable actualizado.' } }),
      );
      closeTeamModal();
    } catch (e) {
      console.error(e);
      setTeamError('Error al guardar el equipo contable');
    } finally {
      setTeamSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('¿Eliminar esta empresa?')) {
      try {
        await companiesService.delete(id);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Empresa eliminada correctamente.' } }),
        );
        void reloadCompanies();
      } catch (error) {
        console.error('Error deleting company:', error);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'Error al eliminar la empresa' } }),
        );
      }
    }
  };

  const handleStatusChange = (nextStatus: string) => {
    setStatus(nextStatus);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextStatus) next.set('status', nextStatus);
      else next.delete('status');
      next.set('page', '1');
      if (next.get('per_page') == null) next.set('per_page', String(initialPerPage));
      next.delete('success');
      return next;
    });
  };

  const handlePageChange = (nextPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      if (next.get('per_page') == null) next.set('per_page', String(initialPerPage));
      return next;
    });
  };

  const handlePerPageChange = (nextPerPage: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('per_page', String(nextPerPage));
      next.set('page', '1');
      return next;
    });
  };

  const toggleCodeOrder = () => {
    const next = codeOrderSort === 'asc' ? 'desc' : 'asc';
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      if (next === 'asc') {
        sp.delete('code_order');
      } else {
        sp.set('code_order', 'desc');
      }
      sp.set('page', '1');
      sp.delete('success');
      return sp;
    });
  };

  const openImportModal = () => {
    setImportOpen(true);
    setImportFile(null);
    setImportErrors([]);
    setImportRowCount(0);
    setImportValidatedOk(false);
    setImportBanner('');
  };

  const closeImportModal = () => {
    setImportOpen(false);
    setImportFile(null);
    setImportErrors([]);
    setImportRowCount(0);
    setImportValidatedOk(false);
    setImportBanner('');
  };

  const handleDownloadTemplate = async () => {
    try {
      setImportBanner('');
      await companiesService.downloadImportTemplate();
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Plantilla descargada.' } }),
      );
    } catch (e) {
      console.error(e);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'No se pudo descargar la plantilla.' } }),
      );
    }
  };

  const handleValidateImport = async () => {
    if (!importFile) {
      setImportBanner('Seleccione un archivo Excel (.xlsx).');
      return;
    }
    const name = importFile.name.toLowerCase();
    if (!name.endsWith('.xlsx')) {
      setImportBanner('El archivo debe ser Excel .xlsx (no CSV).');
      return;
    }
    try {
      setImportValidateLoading(true);
      setImportBanner('');
      setImportValidatedOk(false);
      const res = await companiesService.importCompaniesValidate(importFile);
      setImportRowCount(res.row_count ?? 0);
      setImportErrors(res.errors ?? []);
      if (res.ok) {
        setImportValidatedOk(true);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'success', message: `Validación correcta: ${res.row_count} fila(s) lista(s) para importar.` },
          }),
        );
      } else {
        setImportValidatedOk(false);
        window.dispatchEvent(
          new CustomEvent('miweb:toast', {
            detail: { type: 'error', message: 'Hay errores en el archivo. Corrígelos y vuelve a validar.' },
          }),
        );
      }
    } catch (e: unknown) {
      console.error(e);
      setImportValidatedOk(false);
      const ax = e as { response?: { data?: { error?: string; errors?: Array<{ row: number; message: string }> } } };
      const data = ax.response?.data;
      if (data?.errors?.length) {
        setImportErrors(data.errors);
        setImportRowCount(0);
      }
      setImportBanner(data?.error ?? 'No se pudo validar el archivo.');
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: data?.error ?? 'Error al validar' } }),
      );
    } finally {
      setImportValidateLoading(false);
    }
  };

  const handleCommitImport = async () => {
    if (!importFile || !importValidatedOk) return;
    try {
      setImportCommitLoading(true);
      setImportBanner('');
      const res = await companiesService.importCompaniesCommit(importFile);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', {
          detail: { type: 'success', message: `Se importaron ${res.created} empresa(s).` },
        }),
      );
      closeImportModal();
      void reloadCompanies();
    } catch (e: unknown) {
      console.error(e);
      const ax = e as { response?: { data?: { error?: string; errors?: Array<{ row: number; message: string }> } } };
      const data = ax.response?.data;
      if (data?.errors?.length) {
        setImportErrors(data.errors);
        setImportValidatedOk(false);
      }
      setImportBanner(data?.error ?? 'No se pudo completar la importación.');
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: data?.error ?? 'Error al importar' } }),
      );
    } finally {
      setImportCommitLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-slate-800">Empresas</h2>
          <p className="text-sm text-slate-500">Gestión de clientes del estudio contable.</p>
        </div>
        {canUpsert ? (
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={openImportModal}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 rounded-full border border-emerald-300 bg-white text-emerald-800 text-sm font-medium shadow-sm hover:bg-emerald-50 transition"
            >
              <i className="fas fa-file-excel text-xs"></i>
              <span>Importar Excel</span>
            </button>
            <Link
              to="/companies/new"
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 transition"
            >
              <i className="fas fa-plus text-xs"></i>
              <span>Nueva empresa</span>
            </Link>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Buscar</label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            placeholder="RUC, razón social o código (mín. 3 caracteres)…"
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
          <SearchableSelect
            value={status}
            onChange={handleStatusChange}
            className="min-w-[160px]"
            options={[
              { value: '', label: 'Todos' },
              { value: 'activo', label: 'Activo' },
              { value: 'inactivo', label: 'Inactivo' },
            ]}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleCodeOrder()}
                    className="inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 -mx-1 -my-0.5 text-left font-semibold uppercase tracking-wide text-slate-500 hover:text-primary-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    title={
                      codeOrderSort === 'asc'
                        ? 'Código: menor a mayor. Clic para ordenar mayor a menor.'
                        : 'Código: mayor a menor. Clic para ordenar menor a mayor.'
                    }
                    aria-sort={codeOrderSort === 'asc' ? 'ascending' : 'descending'}
                  >
                    Código
                    <i
                      className={`fas text-[0.65rem] opacity-80 ${codeOrderSort === 'asc' ? 'fa-sort-amount-up' : 'fa-sort-amount-down'}`}
                      aria-hidden
                    />
                  </button>
                </th>
                <th className="px-4 py-3">RUC</th>
                <th className="px-4 py-3">Razón social</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Equipo</th>
                <th className="px-4 py-3 text-right">Deudas</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                 <tr>
                   <td colSpan={7} className="px-4 py-6 text-center text-slate-500 text-sm">
                     <i className="fas fa-spinner fa-spin mr-2"></i> Cargando empresas...
                   </td>
                 </tr>
              ) : companies.length > 0 ? (
                companies.map((company) => (
                  <tr key={company.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">{company.code}</td>
                    <td className="px-4 py-3 text-slate-700">{company.ruc}</td>
                    <td className="px-4 py-3 font-medium">
                      <Link
                        to={`/companies/${company.id}/statement`}
                        className="text-primary-700 hover:text-primary-900 hover:underline"
                        title="Estado de cuenta y perfil de la empresa"
                      >
                        {company.business_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {canUpsert ? (
                        <select
                          value={company.status}
                          disabled={statusUpdatingId === company.id}
                          onChange={(e) => {
                            const v = e.target.value as 'activo' | 'inactivo';
                            void handleCompanyStatusChange(company, v);
                          }}
                          className={`max-w-[9.5rem] w-full text-xs font-medium rounded-lg border px-2 py-1.5 outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer disabled:opacity-60 ${
                            company.status === 'activo'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-slate-100 text-slate-700'
                          }`}
                          aria-label="Estado de la empresa"
                        >
                          <option value="activo">Activo</option>
                          <option value="inactivo">Inactivo</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            company.status === 'activo'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          {company.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openTeamModal(company)}
                        className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <i
                          className={`fas fa-users mr-1 ${
                            company.supervisor_user_id || company.assistant_user_id || company.accountant_user_id
                              ? 'text-slate-600'
                              : 'text-amber-600'
                          }`}
                        ></i>

                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {Math.max(0, Number(company.balance ?? 0)) > 0 ? (
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-red-50 text-red-700 border border-red-100 text-xs font-semibold">
                          S/ {Math.max(0, Number(company.balance ?? 0)).toFixed(2)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-100 text-xs font-semibold">
                          S/ 0.00
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link to={`/documents/new?company_id=${company.id}`}
                           className="inline-flex items-center px-3 py-1.5 rounded-full border border-emerald-200 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                          <i className="fas fa-file-invoice-dollar mr-1"></i> Cargo
                        </Link>
                        <Link to={`/companies/${company.id}/contacts`}
                           className="inline-flex items-center px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-100">
                          <i className="fas fa-address-book mr-1"></i>
                        </Link>
                        {canUpsert ? (
                          <Link
                            to={`/companies/${company.id}/edit`}
                            className="inline-flex items-center px-3 py-1.5 rounded-full border border-amber-300 text-xs font-medium text-amber-700 hover:bg-amber-50"
                          >
                            <i className="fas fa-pen mr-1"></i>
                          </Link>
                        ) : null}
                        {canDelete ? (
                          <button 
                            type="button"
                            onClick={() => handleDelete(company.id)}
                            className="inline-flex items-center px-3 py-1.5 rounded-full border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50">
                            <i className="fas fa-trash mr-1"></i>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500 text-sm">
                    No hay empresas registradas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 sm:px-6 py-4 border-t border-slate-100">
          <Pagination
            page={pagination.page || initialPage}
            perPage={pagination.per_page || initialPerPage}
            total={pagination.total ?? 0}
            onPageChange={handlePageChange}
            onPerPageChange={handlePerPageChange}
          />
        </div>
      </div>

      {importOpen ? (
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <button type="button" className="absolute inset-0 bg-slate-900/40" onClick={closeImportModal} aria-label="Cerrar" />

            <div className="relative w-full max-w-lg bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Importación masiva</div>
                  <div className="text-sm font-semibold text-slate-800">Empresas desde Excel (.xlsx)</div>
                </div>
                <button
                  type="button"
                  onClick={closeImportModal}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  <i className="fas fa-times text-sm"></i>
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto text-sm text-slate-700">
                <p className="text-slate-600">
                  Descargue la plantilla actualizada: columna plan_nombre con el nombre exacto de un plan activo (véase hoja
                  Referencia); documento_contador, documento_supervisor y documento_asistente con el DNI del usuario. Si no hay
                  usuario con ese documento, el puesto queda vacío. Opcionalmente hasta tres contactos por fila. Solo .xlsx.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  <i className="fas fa-download text-xs"></i>
                  Descargar plantilla
                </button>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Archivo .xlsx</label>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-primary-50 file:text-primary-800"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0] ?? null;
                      setImportFile(f);
                      setImportValidatedOk(false);
                      setImportErrors([]);
                      setImportRowCount(0);
                      setImportBanner('');
                    }}
                  />
                </div>

                {importBanner ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {importBanner}
                  </div>
                ) : null}

                {importErrors.length > 0 ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 max-h-40 overflow-y-auto">
                    <div className="text-xs font-semibold text-red-800 mb-1">Errores por fila</div>
                    <ul className="text-xs text-red-800 space-y-1 list-disc pl-4">
                      {importErrors.map((er, idx) => (
                        <li key={`${er.row}-${idx}`}>
                          Fila {er.row}: {er.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {importValidatedOk ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    Listo para importar: {importRowCount} fila(s). Pulse «Importar» para guardar en la base de datos.
                  </div>
                ) : null}
              </div>

              <div className="px-5 py-4 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 bg-slate-50 shrink-0">
                <button
                  type="button"
                  onClick={closeImportModal}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-white"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  disabled={!importFile || importValidateLoading}
                  onClick={() => void handleValidateImport()}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-emerald-400 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {importValidateLoading ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-2 text-xs"></i> Validando…
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check-double mr-2 text-xs"></i> Validar sin guardar
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={!importFile || !importValidatedOk || importCommitLoading}
                  onClick={() => void handleCommitImport()}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 disabled:opacity-50"
                >
                  {importCommitLoading ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-2 text-xs"></i> Importando…
                    </>
                  ) : (
                    <>
                      <i className="fas fa-save mr-2 text-xs"></i> Importar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}

      {teamModalOpen ? (
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <button type="button" className="absolute inset-0 bg-slate-900/40" onClick={closeTeamModal} aria-label="Cerrar" />

            <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-xl border border-slate-200 overflow-visible">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Equipo contable</div>
                  <div className="text-sm font-semibold text-slate-800">{teamCompany?.business_name ?? '—'}</div>
                </div>
                <button
                  type="button"
                  onClick={closeTeamModal}
                  className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  <i className="fas fa-times text-sm"></i>
                </button>
              </div>

              <div className="p-5 space-y-4">
                {teamError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {teamError}
                  </div>
                ) : null}

                {teamLoading ? (
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
                    <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
                  </div>
                ) : teamCompany ? (
                  isAdmin ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Supervisor</label>
                        <SearchableSelect
                          value={teamSupervisorId}
                          onChange={setTeamSupervisorId}
                          options={[
                            { value: '', label: 'Sin asignar' },
                            ...teamUsers
                              .filter((u) => u.role === 'Supervisor' || u.role === 'Administrador')
                              .map((u) => ({
                                value: String(u.id),
                                label: formatUserPickLabel(u),
                                searchText: `${u.name} ${u.username} ${u.email ?? ''}`,
                              })),
                          ]}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Asistente</label>
                        <SearchableSelect
                          value={teamAssistantId}
                          onChange={setTeamAssistantId}
                          options={[
                            { value: '', label: 'Sin asignar' },
                            ...teamUsers
                              .filter((u) => u.role === 'Asistente' || u.role === 'Administrador')
                              .map((u) => ({
                                value: String(u.id),
                                label: formatUserPickLabel(u),
                                searchText: `${u.name} ${u.username} ${u.email ?? ''}`,
                              })),
                          ]}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Contador general</label>
                        <SearchableSelect
                          value={teamAccountantId}
                          onChange={setTeamAccountantId}
                          options={[
                            { value: '', label: 'Sin asignar' },
                            ...teamUsers
                              .filter((u) => u.role === 'Contador' || u.role === 'Administrador')
                              .map((u) => ({
                                value: String(u.id),
                                label: formatUserPickLabel(u),
                                searchText: `${u.name} ${u.username} ${u.email ?? ''}`,
                              })),
                          ]}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-xs font-medium text-slate-500">Supervisor</div>
                        <div className="text-slate-800">
                          {teamCompany.supervisor ? formatUserPickLabel(teamCompany.supervisor) : '—'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-xs font-medium text-slate-500">Asistente</div>
                        <div className="text-slate-800">
                          {teamCompany.assistant ? formatUserPickLabel(teamCompany.assistant) : '—'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <div className="text-xs font-medium text-slate-500">Contador general</div>
                        <div className="text-slate-800">
                          {teamCompany.accountant ? formatUserPickLabel(teamCompany.accountant) : '—'}
                        </div>
                      </div>
                    </div>
                  )
                ) : null}
              </div>

              <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
                <button
                  type="button"
                  onClick={closeTeamModal}
                  className="inline-flex items-center px-4 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-700 hover:bg-white"
                >
                  Cerrar
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    disabled={teamSaving}
                    onClick={handleSaveTeam}
                    className="inline-flex items-center px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium shadow-sm hover:bg-primary-700 disabled:opacity-60"
                  >
                    <i className="fas fa-save mr-2 text-xs"></i>
                    Guardar
                  </button>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      ) : null}
    </div>
  );
};

export default Companies;
