import { Link } from 'react-router-dom';

type Crumb = {
  label: string;
  to?: string;
};

type Props = {
  items: Crumb[];
};

export default function ActivityTemplatesBreadcrumb({ items }: Props) {
  return (
    <nav className="text-sm text-slate-500 mb-1 flex flex-wrap items-center gap-1" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 ? <span className="text-slate-300" aria-hidden>/</span> : null}
            {item.to && !isLast ? (
              <Link to={item.to} className="hover:text-primary-700 transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-slate-700 font-medium' : undefined}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
