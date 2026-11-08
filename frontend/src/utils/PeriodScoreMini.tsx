import { periodScoreBarStyle, periodScoreBarTitle } from './periodDebtScore';

export function PeriodScoreMini({ maxLag, compact = false }: { maxLag: number; compact?: boolean }) {
  return (
    <div
      className={`${compact ? 'w-11' : 'w-14 sm:w-20'} shrink-0`}
      title={compact ? `Score · ${periodScoreBarTitle(maxLag)}` : periodScoreBarTitle(maxLag)}
    >
      {!compact ? (
        <p className="text-3xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5 text-center">Score</p>
      ) : null}
      <div className={`${compact ? 'h-1.5' : 'h-2'} w-full rounded-full bg-slate-200 overflow-hidden ring-1 ring-slate-100`}>
        <div className="h-full w-full rounded-full transition-all" style={periodScoreBarStyle(maxLag)} />
      </div>
    </div>
  );
}
