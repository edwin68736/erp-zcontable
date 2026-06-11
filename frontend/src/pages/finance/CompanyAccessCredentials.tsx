import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { auth } from '../../services/auth';
import { P } from '../../rbac/codes';
import Pagination from '../../components/Pagination';
import { PAGE_WORKSPACE_CLASS } from '../../constants/pageLayout';
import {
  companyAccessCredentialsService,
  type CompanyAccessCredentialFilterFacets,
  type CompanyAccessCredentialRow,
  type CompanyAccessCredentialUpdateInput,
  type CredentialFilterUserOption,
  type CredentialImportRowError,
} from '../../services/companyAccessCredentials';
import {
  CLAVES_SOL_DIGIT_KEYS,
  getDigRowClass,
  getPaletteSwatch,
  parseDigColorMap,
  type ClavesSolPaletteId,
} from '../../utils/clavesSolDigColors';

function maskSecret(value: string): string {
  const v = (value ?? '').trim();
  if (!v) return '—';
  return '••••••';
}

/** Celda con valor copiable al portapapeles (clic). */
function CopyableCredentialCell({
  value,
  cellClass,
  secret = false,
  showSecrets = false,
  mono = false,
  linkStyle = false,
}: {
  value: string;
  cellClass: string;
  secret?: boolean;
  showSecrets?: boolean;
  mono?: boolean;
  linkStyle?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const raw = (value ?? '').trim();

  if (!raw) {
    return <td className={cellClass}>—</td>;
  }

  const display = secret && !showSecrets ? maskSecret(raw) : raw;

  const handleCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'success', message: 'Copiado al portapapeles.' } }),
      );
    } catch {
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'No se pudo copiar.' } }),
      );
    }
  };

  return (
    <td className={cellClass}>
      <button
        type="button"
        onClick={(e) => void handleCopy(e)}
        title="Clic para copiar"
        className={`group/copy inline-flex max-w-full items-center gap-1 rounded px-0.5 -mx-0.5 text-left transition-colors hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60 ${
          mono ? 'font-mono' : ''
        } ${linkStyle ? 'text-indigo-700' : 'text-slate-700'}`}
      >
        <span className="truncate">{copied ? 'Copiado' : display}</span>
        <i
          className={`fas shrink-0 text-[10px] ${
            copied ? 'fa-check text-emerald-600' : 'fa-copy text-slate-400 opacity-0 group-hover/copy:opacity-100'
          }`}
          aria-hidden
        />
      </button>
    </td>
  );
}

function emptyForm(): CompanyAccessCredentialUpdateInput {
  return {
    dig: '',
    sol_usuario: '',
    sol_clave: '',
    bnl_cuenta: '',
    bnl_dni: '',
    bnl_clave_detracciones: '',
    afp_usuario: '',
    afp_clave: '',
    rnp_clave: '',
    facturador_link: '',
    facturador_usuario: '',
    facturador_contrasena: '',
  };
}

function rowToForm(row: CompanyAccessCredentialRow): CompanyAccessCredentialUpdateInput {
  return {
    dig: row.dig ?? '',
    sol_usuario: row.sol_usuario ?? '',
    sol_clave: row.sol_clave ?? '',
    bnl_cuenta: row.bnl_cuenta ?? '',
    bnl_dni: row.bnl_dni ?? '',
    bnl_clave_detracciones: row.bnl_clave_detracciones ?? '',
    afp_usuario: row.afp_usuario ?? '',
    afp_clave: row.afp_clave ?? '',
    rnp_clave: row.rnp_clave ?? '',
    facturador_link: row.facturador_link ?? '',
    facturador_usuario: row.facturador_usuario ?? '',
    facturador_contrasena: row.facturador_contrasena ?? '',
  };
}

const TH_GROUP =
  'px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-white bg-blue-900 border-b border-blue-800';
const TH_COL =
  'px-2 py-2 text-center text-[10px] font-semibold uppercase whitespace-nowrap text-white bg-blue-900 border-b border-blue-800';
const TD =
  'px-2 py-2 text-xs text-slate-700 border-b border-slate-100/90 align-top max-w-[10rem] truncate';
const TD_ACTIONS =
  'px-2 py-2 text-xs border-b border-slate-100/90 align-top text-right sticky right-0 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]';

const FILTER_SECTION =
  'rounded-lg border border-slate-200 bg-slate-50/50 min-w-0 flex flex-col overflow-hidden';

const FILTER_SECTION_TITLE = 'text-[10px] font-medium uppercase tracking-wide text-slate-500 px-2 pt-1.5 mb-1 shrink-0';

const FILTER_SECTION_BODY = 'px-2 pb-1.5';

function filterChipClass(active: boolean, variant: 'default' | 'user' = 'default'): string {
  if (variant === 'user') {
    return [
      'w-full px-1.5 py-0.5 rounded border text-[10px] font-normal leading-snug',
      'text-left whitespace-normal break-words',
      active
        ? 'border-primary-400 bg-primary-50 text-primary-800'
        : 'border-slate-200/90 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
    ].join(' ');
  }
  return [
    'min-h-[2.25rem] px-2.5 py-1.5 rounded-md border text-xs font-medium transition',
    'text-center break-words leading-snug',
    active
      ? 'border-primary-500 bg-primary-50 text-primary-900 ring-2 ring-primary-400/50'
      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
  ].join(' ');
}

function FilterUserGrid({
  title,
  users,
  selectedId,
  onSelect,
}: {
  title: string;
  users: CredentialFilterUserOption[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  return (
    <div className={`${FILTER_SECTION} flex-1`}>
      <p className={FILTER_SECTION_TITLE}>{title}</p>
      {users.length === 0 ? (
        <p className={`text-[10px] text-slate-400 ${FILTER_SECTION_BODY}`}>Sin asignaciones</p>
      ) : (
        <div className={`grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1 ${FILTER_SECTION_BODY}`}>
          {users.map((u) => {
            const active = selectedId === u.user_id;
            const label = (u.username || '').trim() || `#${u.user_id}`;
            return (
              <button
                key={u.user_id}
                type="button"
                className={filterChipClass(active, 'user')}
                onClick={() => onSelect(active ? null : u.user_id)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CompanyAccessCredentials = () => {
  const canView = useMemo(() => auth.hasPermission(P.companyCredentialsView), []);
  const canManage = useMemo(() => auth.hasPermission(P.companyCredentialsManage), []);
  const canImport = useMemo(() => auth.hasPermission(P.companyCredentialsImport), []);

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [filterAssistantId, setFilterAssistantId] = useState<number | null>(null);
  const [filterSupervisorId, setFilterSupervisorId] = useState<number | null>(null);
  const [filterDig, setFilterDig] = useState<string | null>(null);
  const [facets, setFacets] = useState<CompanyAccessCredentialFilterFacets | null>(null);
  const [facetsLoading, setFacetsLoading] = useState(true);
  const [digColorMap, setDigColorMap] = useState<Record<string, ClavesSolPaletteId>>(() => parseDigColorMap());
  const [rows, setRows] = useState<CompanyAccessCredentialRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<CompanyAccessCredentialRow | null>(null);
  const [form, setForm] = useState<CompanyAccessCredentialUpdateInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importErrors, setImportErrors] = useState<CredentialImportRowError[]>([]);
  const [importUnmatched, setImportUnmatched] = useState<string[]>([]);
  const [importValidatedOk, setImportValidatedOk] = useState(false);
  const [importRowCount, setImportRowCount] = useState(0);
  const [importBanner, setImportBanner] = useState('');
  const [importBannerKind, setImportBannerKind] = useState<'info' | 'success' | 'warning' | 'error'>('info');
  const [importValidateLoading, setImportValidateLoading] = useState(false);
  const [importCommitLoading, setImportCommitLoading] = useState(false);
  const [listNotice, setListNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const importBannerClass =
    importBannerKind === 'success'
      ? 'text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg'
      : importBannerKind === 'error'
        ? 'text-sm text-red-900 bg-red-50 border border-red-200 px-3 py-2 rounded-lg'
        : importBannerKind === 'warning'
          ? 'text-sm text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg'
          : 'text-sm text-slate-700 bg-slate-50 border border-slate-200 px-3 py-2 rounded-lg';

  const hasActiveFilters =
    filterAssistantId != null || filterSupervisorId != null || filterDig != null;

  const loadFacets = useCallback(async () => {
    if (!canView) return;
    try {
      setFacetsLoading(true);
      const data = await companyAccessCredentialsService.filterFacets();
      setFacets(data);
      setDigColorMap(parseDigColorMap(data.claves_sol_dig_colors_json));
    } catch (e) {
      console.error(e);
    } finally {
      setFacetsLoading(false);
    }
  }, [canView]);

  const load = useCallback(async (opts?: { page?: number }) => {
    if (!canView) return;
    const targetPage = opts?.page ?? page;
    try {
      setLoading(true);
      setError('');
      const res = await companyAccessCredentialsService.list({
        q: q.trim().length >= 2 ? q.trim() : undefined,
        page: targetPage,
        per_page: perPage,
        assistant_user_id: filterAssistantId ?? undefined,
        supervisor_user_id: filterSupervisorId ?? undefined,
        dig: filterDig ?? undefined,
      });
      setRows(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      console.error(e);
      setError('No se pudo cargar el listado de claves.');
    } finally {
      setLoading(false);
    }
  }, [canView, q, page, perPage, filterAssistantId, filterSupervisorId, filterDig]);

  const clearFilters = () => {
    setFilterAssistantId(null);
    setFilterSupervisorId(null);
    setFilterDig(null);
    setPage(1);
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
  };

  const handlePerPageChange = (nextPerPage: number) => {
    setPerPage(nextPerPage);
    setPage(1);
  };

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (row: CompanyAccessCredentialRow) => {
    setEditRow(row);
    setForm(rowToForm(row));
    setShowSecrets(false);
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditRow(null);
    setForm(emptyForm());
  };

  const handleSave = async () => {
    if (!editRow || !canManage) return;
    try {
      setSaving(true);
      await companyAccessCredentialsService.update(editRow.company_id, form);
      showToast('success', 'Credenciales guardadas.');
      closeEdit();
      void load();
    } catch (e) {
      console.error(e);
      window.dispatchEvent(
        new CustomEvent('miweb:toast', { detail: { type: 'error', message: 'No se pudo guardar.' } }),
      );
    } finally {
      setSaving(false);
    }
  };

  const closeImportModal = () => {
    setImportOpen(false);
    setImportFile(null);
    setImportErrors([]);
    setImportUnmatched([]);
    setImportValidatedOk(false);
    setImportRowCount(0);
    setImportBanner('');
    setImportBannerKind('info');
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('miweb:toast', { detail: { type, message } }));
    }, 150);
  };

  useEffect(() => {
    if (!editOpen && !importOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (editOpen) closeEdit();
      else if (importOpen) closeImportModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editOpen, importOpen]);

  const handleDownloadTemplate = async () => {
    try {
      await companyAccessCredentialsService.downloadImportTemplate();
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
      setImportBannerKind('warning');
      setImportBanner('Seleccione un archivo Excel (.xlsx).');
      return;
    }
    if (!importFile.name.toLowerCase().endsWith('.xlsx')) {
      setImportBannerKind('warning');
      setImportBanner('El archivo debe ser Excel .xlsx.');
      return;
    }
    try {
      setImportValidateLoading(true);
      setImportBanner('');
      setImportValidatedOk(false);
      const res = await companyAccessCredentialsService.importValidate(importFile);
      setImportRowCount(res.row_count ?? 0);
      setImportErrors(res.errors ?? []);
      setImportUnmatched(res.unmatched_rucs ?? []);
      if (res.ok) {
        setImportValidatedOk(true);
        const unmatchedN = res.unmatched_count ?? res.unmatched_rucs?.length ?? 0;
        const matched = Math.max(0, (res.row_count ?? 0) - unmatchedN);
        if (matched === 0 && (res.row_count ?? 0) > 0) {
          setImportBannerKind('warning');
          setImportBanner(
            'Ningún RUC del archivo coincide con empresas del estudio. Revise los RUC o elimine la fila de ejemplo de la plantilla.',
          );
        } else {
          setImportBannerKind('success');
          setImportBanner(
            `Validación correcta: ${matched} empresa(s) se actualizarán al importar.${
              unmatchedN > 0 ? ` ${unmatchedN} RUC no registrado(s) se omitirán.` : ''
            }`,
          );
        }
      } else {
        setImportBannerKind('error');
        setImportBanner('Hay errores en el archivo. Corríjalos y vuelva a validar.');
      }
    } catch (e: unknown) {
      console.error(e);
      setImportValidatedOk(false);
      const ax = e as { response?: { data?: { error?: string; errors?: CredentialImportRowError[] } } };
      if (ax.response?.data?.errors?.length) setImportErrors(ax.response.data.errors);
      setImportBannerKind('error');
      setImportBanner(ax.response?.data?.error ?? 'No se pudo validar el archivo.');
    } finally {
      setImportValidateLoading(false);
    }
  };

  const handleCommitImport = async () => {
    if (!importFile || !importValidatedOk) return;
    try {
      setImportCommitLoading(true);
      setImportBanner('');
      const res = await companyAccessCredentialsService.importCommit(importFile);
      const unmatched = res.unmatched_rucs ?? [];
      const updated = res.updated ?? 0;
      setImportUnmatched(unmatched);

      if (updated === 0) {
        setImportBannerKind('warning');
        setImportBanner(
          unmatched.length > 0
            ? 'No se actualizó ninguna empresa: todos los RUC del archivo no están registrados en el estudio.'
            : 'No se actualizó ninguna empresa. Verifique el archivo y que la hoja se llame «Claves».',
        );
        return;
      }

      closeImportModal();
      setPage(1);
      await load({ page: 1 });
      const msg = `Se actualizaron ${updated} empresa(s).${
        unmatched.length > 0 ? ` ${unmatched.length} RUC no registrado(s) se omitieron.` : ''
      }`;
      setListNotice({ kind: 'success', message: msg });
      showToast('success', msg);
    } catch (e: unknown) {
      console.error(e);
      const ax = e as { response?: { data?: { error?: string; errors?: CredentialImportRowError[] } } };
      if (ax.response?.data?.errors?.length) {
        setImportErrors(ax.response.data.errors);
        setImportValidatedOk(false);
      }
      setImportBannerKind('error');
      setImportBanner(ax.response?.data?.error ?? 'No se pudo importar.');
    } finally {
      setImportCommitLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className={PAGE_WORKSPACE_CLASS}>
        <p className="text-sm text-slate-600">No tiene permiso para ver esta vista.</p>
      </div>
    );
  }

  return (
    <div className={`${PAGE_WORKSPACE_CLASS} !space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Claves sol y accesos</h2>
        {canImport ? (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-full border border-emerald-300 bg-white text-emerald-800 text-sm font-medium shadow-sm hover:bg-emerald-50"
          >
            <i className="fas fa-file-excel text-xs" aria-hidden />
            Importar Excel
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden">
        {hasActiveFilters ? (
          <div className="flex justify-end px-2 pt-1.5">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium text-primary-700 hover:text-primary-900 hover:underline"
            >
              Limpiar filtros
            </button>
          </div>
        ) : null}
        {facetsLoading ? (
          <p className="text-xs text-slate-500 px-2 py-2">
            <i className="fas fa-spinner fa-spin mr-1" aria-hidden />
            Cargando filtros…
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-stretch">
            <FilterUserGrid
              title="Asistentes"
              users={facets?.assistants ?? []}
              selectedId={filterAssistantId}
              onSelect={(id) => {
                setFilterAssistantId(id);
                setPage(1);
              }}
            />
            <FilterUserGrid
              title="Supervisores"
              users={facets?.supervisors ?? []}
              selectedId={filterSupervisorId}
              onSelect={(id) => {
                setFilterSupervisorId(id);
                setPage(1);
              }}
            />
            <div className={`${FILTER_SECTION} w-full sm:w-[11rem] shrink-0`}>
              <p className={FILTER_SECTION_TITLE}>Dígitos</p>
              <div className={`grid grid-cols-5 gap-1 ${FILTER_SECTION_BODY}`}>
                {CLAVES_SOL_DIGIT_KEYS.map((key) => {
                  const active = filterDig === key;
                  const swatch = getPaletteSwatch(digColorMap[key] ?? 'slate');
                  return (
                    <button
                      key={key}
                      type="button"
                      title={`Dígito ${key}`}
                      className={[
                        'flex h-7 w-full items-center justify-center rounded border text-[10px] font-bold font-mono text-slate-800',
                        swatch,
                        active
                          ? 'ring-2 ring-primary-500 ring-offset-1 border-primary-500'
                          : 'border-slate-300/70 hover:brightness-95',
                      ].join(' ')}
                      onClick={() => {
                        setFilterDig(active ? null : key);
                        setPage(1);
                      }}
                    >
                      {key}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Buscar</label>
          <input
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="RUC, razón social o código (mín. 2 caracteres)…"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={showSecrets}
            onChange={(e) => setShowSecrets(e.target.checked)}
            className="rounded border-slate-300 text-primary-600"
          />
          Mostrar contraseñas
        </label>
        <div
          className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-1 shrink-0 min-w-[9.5rem]"
          aria-live="polite"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Empresas</p>
          <p className="text-lg font-semibold text-slate-800 tabular-nums leading-tight mt-0.5">
            {loading ? '—' : total}
          </p>
        </div>
      </div>

      {error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      ) : null}

      {listNotice ? (
        <div
          className={`p-4 rounded-xl text-sm flex items-start justify-between gap-3 ${
            listNotice.kind === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
              : 'bg-red-50 border border-red-200 text-red-900'
          }`}
          role="status"
        >
          <span>
            <i
              className={`fas ${listNotice.kind === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2`}
              aria-hidden
            />
            {listNotice.message}
          </span>
          <button
            type="button"
            className="shrink-0 text-slate-500 hover:text-slate-800"
            aria-label="Cerrar aviso"
            onClick={() => setListNotice(null)}
          >
            <i className="fas fa-times" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1400px] w-full text-left border-collapse">
            <thead>
              <tr>
                <th colSpan={3} className={TH_GROUP}>
                  Columnas generales
                </th>
                <th colSpan={6} className={TH_GROUP}>
                  Claves SOL
                </th>
                <th colSpan={3} className={TH_GROUP}>
                  Banco de la Nación (detracciones)
                </th>
                <th colSpan={2} className={TH_GROUP}>
                  AFP Net
                </th>
                <th colSpan={1} className={TH_GROUP}>
                  RNP
                </th>
                <th colSpan={3} className={TH_GROUP}>
                  Facturador
                </th>
                <th rowSpan={2} className={`${TH_COL} sticky right-0 bg-blue-900 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]`}>
                  Acciones
                </th>
              </tr>
              <tr>
                <th className={TH_COL}>N°</th>
                <th className={TH_COL}>Cod</th>
                <th className={TH_COL}>Dig</th>
                <th className={TH_COL}>Razón social</th>
                <th className={TH_COL}>RUC</th>
                <th className={TH_COL}>Usuario</th>
                <th className={TH_COL}>Clave</th>
                <th className={TH_COL}>Asistente</th>
                <th className={TH_COL}>Supervisor</th>
                <th className={TH_COL}>Cta</th>
                <th className={TH_COL}>DNI</th>
                <th className={TH_COL}>Clave detr.</th>
                <th className={TH_COL}>Usuario</th>
                <th className={TH_COL}>Clave AFP</th>
                <th className={TH_COL}>Clave RNP</th>
                <th className={TH_COL}>Link</th>
                <th className={TH_COL}>Usuario</th>
                <th className={TH_COL}>Contraseña</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={19} className="px-4 py-8 text-center text-slate-500 text-sm">
                    <i className="fas fa-spinner fa-spin mr-2" aria-hidden />
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={19} className="px-4 py-8 text-center text-slate-500 text-sm">
                    No hay empresas para mostrar.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const rowBg = getDigRowClass(row.dig, digColorMap);
                  const rowNum = (page - 1) * perPage + index + 1;
                  return (
                  <tr key={row.company_id} className={`group ${rowBg}`}>
                    <td className={`${TD} text-center text-slate-500 tabular-nums w-10`}>{rowNum}</td>
                    <td className={`${TD} font-mono`}>{row.code || '—'}</td>
                    <td className={TD}>{row.dig || '—'}</td>
                    <td className={`${TD} max-w-[12rem] font-medium`} title={row.business_name}>
                      {row.business_name || '—'}
                    </td>
                    <CopyableCredentialCell value={row.ruc} cellClass={`${TD} whitespace-nowrap`} mono />
                    <CopyableCredentialCell value={row.sol_usuario} cellClass={TD} />
                    <CopyableCredentialCell
                      value={row.sol_clave}
                      cellClass={TD}
                      secret
                      showSecrets={showSecrets}
                    />
                    <td className={`${TD} text-center`}>{row.assistant_username || '—'}</td>
                    <td className={`${TD} text-center`}>{row.supervisor_username || '—'}</td>
                    <CopyableCredentialCell value={row.bnl_cuenta} cellClass={TD} mono />
                    <CopyableCredentialCell value={row.bnl_dni} cellClass={TD} mono />
                    <CopyableCredentialCell
                      value={row.bnl_clave_detracciones}
                      cellClass={TD}
                      secret
                      showSecrets={showSecrets}
                    />
                    <CopyableCredentialCell value={row.afp_usuario} cellClass={TD} />
                    <CopyableCredentialCell
                      value={row.afp_clave}
                      cellClass={TD}
                      secret
                      showSecrets={showSecrets}
                    />
                    <CopyableCredentialCell
                      value={row.rnp_clave}
                      cellClass={TD}
                      secret
                      showSecrets={showSecrets}
                    />
                    <CopyableCredentialCell
                      value={row.facturador_link}
                      cellClass={TD}
                      linkStyle
                    />
                    <CopyableCredentialCell value={row.facturador_usuario} cellClass={TD} />
                    <CopyableCredentialCell
                      value={row.facturador_contrasena}
                      cellClass={TD}
                      secret
                      showSecrets={showSecrets}
                    />
                    <td className={`${TD_ACTIONS} ${rowBg}`}>
                      <button
                        type="button"
                        title={canManage ? 'Editar credenciales' : 'Ver credenciales'}
                        onClick={() => openEdit(row)}
                        className="inline-flex items-center px-2.5 py-1 rounded-full border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <i className={`fas ${canManage ? 'fa-pen' : 'fa-eye'} mr-1`} aria-hidden />
                        {canManage ? 'Editar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 sm:px-6 py-4 border-t border-slate-100">
          <Pagination
            page={page}
            perPage={perPage}
            total={total}
            onPageChange={handlePageChange}
            onPerPageChange={handlePerPageChange}
          />
        </div>
      </div>

      {editOpen && editRow
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={closeEdit}
                aria-label="Cerrar"
              />
              <div
                role="dialog"
                aria-modal="true"
                className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[min(90vh,100dvh)] overflow-y-auto flex flex-col"
              >
            <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  {canManage ? 'Editar' : 'Ver'} credenciales
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {editRow.business_name} · <span className="font-mono">{editRow.ruc}</span> · Cod{' '}
                  {editRow.code}
                </p>
              </div>
              <button type="button" onClick={closeEdit} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
                <i className="fas fa-times" aria-hidden />
              </button>
            </div>
            <div className="px-6 py-4 space-y-6">
              <fieldset className="space-y-3">
                <legend className="text-xs font-bold uppercase text-slate-500">Columnas generales</legend>
                <label className="block text-sm">
                  <span className="text-slate-600">Dig</span>
                  <input
                    type="text"
                    disabled={!canManage}
                    value={form.dig}
                    onChange={(e) => setForm((f) => ({ ...f, dig: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                  />
                </label>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-xs font-bold uppercase text-slate-500">Claves SOL</legend>
                <p className="text-xs text-slate-500">
                  Asistente: {editRow.assistant_username || '—'} · Supervisor: {editRow.supervisor_username || '—'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm sm:col-span-2">
                    <span className="text-slate-600">Usuario SOL</span>
                    <input
                      type="text"
                      disabled={!canManage}
                      value={form.sol_usuario}
                      onChange={(e) => setForm((f) => ({ ...f, sol_usuario: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="text-slate-600">Clave SOL</span>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      disabled={!canManage}
                      value={form.sol_clave}
                      onChange={(e) => setForm((f) => ({ ...f, sol_clave: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-xs font-bold uppercase text-slate-500">Banco de la Nación (detracciones)</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-slate-600">Cta</span>
                    <input
                      type="text"
                      disabled={!canManage}
                      value={form.bnl_cuenta}
                      onChange={(e) => setForm((f) => ({ ...f, bnl_cuenta: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-slate-600">DNI</span>
                    <input
                      type="text"
                      disabled={!canManage}
                      value={form.bnl_dni}
                      onChange={(e) => setForm((f) => ({ ...f, bnl_dni: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm sm:col-span-2">
                    <span className="text-slate-600">Clave detracciones</span>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      disabled={!canManage}
                      value={form.bnl_clave_detracciones}
                      onChange={(e) => setForm((f) => ({ ...f, bnl_clave_detracciones: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-xs font-bold uppercase text-slate-500">AFP Net</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-slate-600">Usuario</span>
                    <input
                      type="text"
                      disabled={!canManage}
                      value={form.afp_usuario}
                      onChange={(e) => setForm((f) => ({ ...f, afp_usuario: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-slate-600">Clave AFP</span>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      disabled={!canManage}
                      value={form.afp_clave}
                      onChange={(e) => setForm((f) => ({ ...f, afp_clave: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-xs font-bold uppercase text-slate-500">RNP</legend>
                <label className="block text-sm">
                  <span className="text-slate-600">Clave RNP</span>
                  <input
                    type={showSecrets ? 'text' : 'password'}
                    disabled={!canManage}
                    value={form.rnp_clave}
                    onChange={(e) => setForm((f) => ({ ...f, rnp_clave: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                  />
                </label>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-xs font-bold uppercase text-slate-500">Facturador</legend>
                <label className="block text-sm">
                  <span className="text-slate-600">Link</span>
                  <input
                    type="url"
                    disabled={!canManage}
                    value={form.facturador_link}
                    onChange={(e) => setForm((f) => ({ ...f, facturador_link: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-sm">
                    <span className="text-slate-600">Usuario</span>
                    <input
                      type="text"
                      disabled={!canManage}
                      value={form.facturador_usuario}
                      onChange={(e) => setForm((f) => ({ ...f, facturador_usuario: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-slate-600">Contraseña</span>
                    <input
                      type={showSecrets ? 'text' : 'password'}
                      disabled={!canManage}
                      value={form.facturador_contrasena}
                      onChange={(e) => setForm((f) => ({ ...f, facturador_contrasena: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-50"
                    />
                  </label>
                </div>
              </fieldset>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                className="px-4 py-2 rounded-full border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {canManage ? 'Cancelar' : 'Cerrar'}
              </button>
              {canManage ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              ) : null}
            </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {importOpen
        ? createPortal(
            <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={closeImportModal}
                aria-label="Cerrar"
              />
              <div
                role="dialog"
                aria-modal="true"
                className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full max-h-[min(90vh,100dvh)] overflow-y-auto p-6 space-y-4"
              >
            <h3 className="text-lg font-semibold text-slate-800">Importar claves desde Excel</h3>
            <p className="text-sm text-slate-600">
              Descargue la plantilla, complete una fila por RUC y cargue el archivo. Solo se actualizan empresas ya
              registradas; los RUC no encontrados se listan al final sin modificar datos. Elimine la fila de ejemplo
              antes de importar.
            </p>
            {importBanner ? <p className={importBannerClass}>{importBanner}</p> : null}
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              className="text-sm font-medium text-primary-700 hover:underline"
            >
              Descargar plantilla (.xlsx)
            </button>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Archivo .xlsx</label>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] ?? null);
                  setImportValidatedOk(false);
                  setImportErrors([]);
                  setImportUnmatched([]);
                }}
                className="block w-full text-sm"
              />
            </div>
            {importErrors.length > 0 ? (
              <ul className="text-xs text-red-700 max-h-32 overflow-y-auto space-y-1">
                {importErrors.map((er, i) => (
                  <li key={`${er.row}-${i}`}>
                    Fila {er.row}: {er.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {importUnmatched.length > 0 ? (
              <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="font-semibold mb-1">RUC no registrados ({importUnmatched.length}):</p>
                <p className="font-mono break-all">{importUnmatched.join(', ')}</p>
              </div>
            ) : null}
            {importValidatedOk && importRowCount > 0 && !importBanner ? (
              <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-lg">
                {importRowCount} fila(s) en el archivo. Pulse Importar para guardar.
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeImportModal}
                className="px-4 py-2 rounded-full border border-slate-200 text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!importFile || importValidateLoading}
                onClick={() => void handleValidateImport()}
                className="px-4 py-2 rounded-full border border-emerald-300 text-emerald-800 text-sm font-medium disabled:opacity-50"
              >
                {importValidateLoading ? 'Validando…' : 'Validar'}
              </button>
              <button
                type="button"
                disabled={!importValidatedOk || importCommitLoading}
                onClick={() => void handleCommitImport()}
                className="px-4 py-2 rounded-full bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {importCommitLoading ? 'Importando…' : 'Importar'}
              </button>
            </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default CompanyAccessCredentials;
