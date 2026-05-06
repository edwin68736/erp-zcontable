import type { CSSProperties } from 'react';

/** Estilo de barra tipo semáforo según meses de atraso del periodo contable del cargo. */
export function periodScoreBarStyle(maxPeriodLagMonths: number): CSSProperties {
  const m = Math.max(0, maxPeriodLagMonths);
  if (m === 0) {
    return { background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)' };
  }
  if (m === 1) {
    return { background: 'linear-gradient(90deg, #10b981 0%, #22c55e 40%, #eab308 100%)' };
  }
  if (m === 2) {
    return { background: 'linear-gradient(90deg, #10b981 0%, #84cc16 28%, #f59e0b 52%, #fb923c 100%)' };
  }
  return { background: 'linear-gradient(90deg, #fb923c 0%, #f97316 32%, #ef4444 78%, #dc2626 100%)' };
}

export function periodScoreBarTitle(maxPeriodLagMonths: number): string {
  if (maxPeriodLagMonths <= 0) return 'Score: al día respecto al periodo de la deuda';
  return `Score: ~${maxPeriodLagMonths} mes(es) de atraso respecto al periodo del cargo`;
}

export function periodScoreExportLabel(maxPeriodLagMonths: number): string {
  if (maxPeriodLagMonths <= 0) return 'Verde (al día)';
  if (maxPeriodLagMonths === 1) return 'Verde → amarillo';
  if (maxPeriodLagMonths === 2) return 'Verde → naranja';
  return 'Naranja → rojo';
}

/** Color único para PDF (react-pdf no aplica gradientes CSS como el navegador). */
export function periodScoreSolidColor(maxPeriodLagMonths: number): string {
  if (maxPeriodLagMonths <= 0) return '#10b981';
  if (maxPeriodLagMonths === 1) return '#65a30d';
  if (maxPeriodLagMonths === 2) return '#ea580c';
  return '#dc2626';
}

export function periodDebtMoraBadge(maxPeriodLagMonths: number, hasPeriodBehind: boolean): { label: string; cls: string } {
  if (!hasPeriodBehind || maxPeriodLagMonths <= 0) {
    return {
      label: 'Periodo al día',
      cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    };
  }
  if (maxPeriodLagMonths === 1) {
    return { label: '1 mes (periodo)', cls: 'bg-yellow-100 text-yellow-950 border border-yellow-400' };
  }
  if (maxPeriodLagMonths === 2) {
    return { label: '2 meses (periodo)', cls: 'bg-amber-100 text-amber-950 border border-amber-400' };
  }
  return {
    label: `${maxPeriodLagMonths} meses (periodo)`,
    cls: 'bg-red-100 text-red-900 border border-red-300',
  };
}

export function periodDebtMoraSemaforo(
  maxPeriodLagMonths: number,
  hasPeriodBehind: boolean,
): { label: string; cls: string; pdfColor: string } {
  if (!hasPeriodBehind || maxPeriodLagMonths <= 0) {
    return {
      label: 'Al día',
      cls: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
      pdfColor: '#047857',
    };
  }
  if (maxPeriodLagMonths === 1) {
    return {
      label: '1 mes',
      cls: 'bg-yellow-100 text-yellow-950 border border-yellow-400',
      pdfColor: '#a16207',
    };
  }
  if (maxPeriodLagMonths === 2) {
    return {
      label: '2 meses',
      cls: 'bg-amber-100 text-amber-950 border border-amber-400',
      pdfColor: '#b45309',
    };
  }
  return {
    label: `${maxPeriodLagMonths} meses`,
    cls: 'bg-red-100 text-red-900 border border-red-300',
    pdfColor: '#b91c1c',
  };
}

export function PeriodScoreMini({ maxLag, compact = false }: { maxLag: number; compact?: boolean }) {
  return (
    <div
      className={`${compact ? 'w-11' : 'w-14 sm:w-20'} shrink-0`}
      title={compact ? `Score · ${periodScoreBarTitle(maxLag)}` : periodScoreBarTitle(maxLag)}
    >
      {!compact ? (
        <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5 text-center">Score</p>
      ) : null}
      <div className={`${compact ? 'h-1.5' : 'h-2'} w-full rounded-full bg-slate-200 overflow-hidden ring-1 ring-slate-100`}>
        <div className="h-full w-full rounded-full transition-all" style={periodScoreBarStyle(maxLag)} />
      </div>
    </div>
  );
}
