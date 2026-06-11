import type { Document } from '../types/dashboard';
import { debtCollectionBadge } from '../utils/documentDebtUi';

type Props = { doc: Document; className?: string };

const DocumentDebtBadge = ({ doc, className = '' }: Props) => {
  const badge = debtCollectionBadge(doc);
  return (
    <div className={`flex flex-col items-start gap-0.5 ${className}`}>
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${badge.className}`}
      >
        {badge.label}
      </span>
      {badge.subLabel ? (
        <span className="text-[10px] text-slate-500 leading-tight">({badge.subLabel})</span>
      ) : null}
    </div>
  );
};

export default DocumentDebtBadge;
