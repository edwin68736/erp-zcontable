import { resolvePdt601DueDate } from '../components/activity/pdt601Config';
import {
  supervisorsService,
  type SupervisorDeclaration,
  type SupervisorMonthlyControl,
} from '../services/supervisors';
import { declarationStatusLabel, declarationTypeLabel } from './supervisorLabels';

export const PDT_TYPES = ['pdt_601', 'pdt_621'] as const;
export type PdtDeclarationType = (typeof PDT_TYPES)[number];

const PENDING_DECL_STATUSES = new Set(['pendiente', 'en_elaboracion', 'en_revision']);
const COMPLETE_DECL_STATUSES = new Set(['aprobado', 'presentado', 'cerrado']);

export type PdtTypeSummary = {
  pendiente: number;
  observado: number;
  vencido: number;
  completado: number;
  total: number;
};

export type PdtAggregationMetrics = {
  /** GET /supervisors/controls */
  listControlsCalls: number;
  /** GET /supervisors/controls/:id/declarations */
  listDeclarationsCalls: number;
  controlsFetched: number;
  controlsTotalReported: number;
  isPartialSample: boolean;
};

export type PdtWorkspaceRow = {
  controlId: number;
  companyName: string;
  companyRuc?: string;
  declarationType: PdtDeclarationType;
  declarationId: number;
  status: string;
  progressPct: number;
  dueDate?: string;
  isOverdue: boolean;
};

export type PdtWorkspaceData = {
  controls: SupervisorMonthlyControl[];
  summaryByType: Record<PdtDeclarationType, PdtTypeSummary>;
  actionRows: PdtWorkspaceRow[];
  metrics: PdtAggregationMetrics;
};

function emptySummary(): PdtTypeSummary {
  return { pendiente: 0, observado: 0, vencido: 0, completado: 0, total: 0 };
}

function startOfTodayLocal(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function isPdtOverdue(status: string, dueDate: string | undefined, today: Date): boolean {
  if (COMPLETE_DECL_STATUSES.has(status) || status === 'observado') return false;
  if (!dueDate) return false;
  const d = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return d < today;
}

function classifyDeclaration(
  decl: SupervisorDeclaration,
  controlDueDate: string | undefined,
  today: Date,
): 'pendiente' | 'observado' | 'vencido' | 'completado' | null {
  if (!PDT_TYPES.includes(decl.declaration_type as PdtDeclarationType)) return null;
  if (decl.status === 'observado') return 'observado';
  if (COMPLETE_DECL_STATUSES.has(decl.status)) return 'completado';
  const resolvedDue = resolvePdt601DueDate(decl.due_date, controlDueDate);
  if (isPdtOverdue(decl.status, resolvedDue, today)) return 'vencido';
  if (PENDING_DECL_STATUSES.has(decl.status)) return 'pendiente';
  return 'pendiente';
}

function isPdtActionRow(decl: SupervisorDeclaration, controlDueDate: string | undefined, today: Date): boolean {
  const bucket = classifyDeclaration(decl, controlDueDate, today);
  return bucket === 'pendiente' || bucket === 'observado' || bucket === 'vencido';
}

/**
 * Agrega PDT 601/621 desde APIs existentes (1 listControls + N listDeclarations).
 * Documentar metrics para evaluar N+1 antes de proponer cambios de backend.
 */
export async function fetchPdtWorkspaceData(periodYm: string): Promise<PdtWorkspaceData> {
  const metrics: PdtAggregationMetrics = {
    listControlsCalls: 0,
    listDeclarationsCalls: 0,
    controlsFetched: 0,
    controlsTotalReported: 0,
    isPartialSample: false,
  };

  const summaryByType: Record<PdtDeclarationType, PdtTypeSummary> = {
    pdt_601: emptySummary(),
    pdt_621: emptySummary(),
  };
  const actionRows: PdtWorkspaceRow[] = [];
  const today = startOfTodayLocal();

  let controls: SupervisorMonthlyControl[] = [];
  try {
    metrics.listControlsCalls += 1;
    const res = await supervisorsService.listControls({
      period_ym: periodYm,
      per_page: 200,
      page: 1,
    });
    controls = Array.isArray(res.items) ? res.items : [];
    metrics.controlsFetched = controls.length;
    metrics.controlsTotalReported = res.pagination?.total ?? controls.length;
    metrics.isPartialSample = metrics.controlsTotalReported > metrics.controlsFetched;
  } catch {
    return { controls: [], summaryByType, actionRows, metrics };
  }

  if (controls.length === 0) {
    return { controls, summaryByType, actionRows, metrics };
  }

  const declarationLists = await Promise.all(
    controls.map(async (ctrl) => {
      metrics.listDeclarationsCalls += 1;
      try {
        return await supervisorsService.listDeclarations(ctrl.id);
      } catch {
        return [] as SupervisorDeclaration[];
      }
    }),
  );

  for (let i = 0; i < controls.length; i++) {
    const ctrl = controls[i];
    const decls = declarationLists[i] ?? [];
    const companyName = ctrl.company?.business_name ?? `Empresa #${ctrl.company_id}`;
    const controlDue = ctrl.due_date?.slice(0, 10);

    for (const decl of decls) {
      const bucket = classifyDeclaration(decl, controlDue, today);
      if (!bucket) continue;

      const type = decl.declaration_type as PdtDeclarationType;
      if (!PDT_TYPES.includes(type)) continue;

      summaryByType[type][bucket] += 1;
      summaryByType[type].total += 1;

      const resolvedDue = resolvePdt601DueDate(decl.due_date, controlDue);

      if (isPdtActionRow(decl, controlDue, today)) {
        actionRows.push({
          controlId: ctrl.id,
          companyName,
          companyRuc: ctrl.company?.ruc,
          declarationType: type,
          declarationId: decl.id,
          status: decl.status,
          progressPct: decl.progress_pct ?? 0,
          dueDate: resolvedDue,
          isOverdue: bucket === 'vencido',
        });
      }
    }
  }

  actionRows.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.declarationType !== b.declarationType) return a.declarationType.localeCompare(b.declarationType);
    return a.companyName.localeCompare(b.companyName);
  });

  return { controls, summaryByType, actionRows, metrics };
}

export function formatPdtMetricsLine(metrics: PdtAggregationMetrics): string {
  const total = metrics.listControlsCalls + metrics.listDeclarationsCalls;
  return `${total} llamadas API (${metrics.listControlsCalls} listControls + ${metrics.listDeclarationsCalls} listDeclarations) · ${metrics.controlsFetched}/${metrics.controlsTotalReported} controles`;
}

export function pdtRowStatusLabel(status: string): string {
  return declarationStatusLabel(status);
}

export function pdtRowTypeLabel(type: PdtDeclarationType): string {
  return declarationTypeLabel(type);
}
