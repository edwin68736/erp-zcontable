import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { DashboardData } from '../types/dashboard';
import { auth } from '../services/auth';
import { PeriodScoreMini, periodDebtMoraBadge } from '../utils/periodDebtScore';

const Dashboard = () => {
  const [activeCard, setActiveCard] = useState<number>(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [debtListRefreshing, setDebtListRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [debtOverdueFilter, setDebtOverdueFilter] = useState<string>('');
  const dashboardLoadedOnceRef = useRef(false);

  useEffect(() => {
    const fetchData = async () => {
      const firstLoad = !dashboardLoadedOnceRef.current;
      try {
        if (firstLoad) setLoading(true);
        else setDebtListRefreshing(true);
        const params =
          debtOverdueFilter === '' ? {} : { params: { min_overdue_months: Number(debtOverdueFilter) } };
        const response = await client.get<DashboardData>('/dashboard', params);
        setData(response.data);
        setError('');
        dashboardLoadedOnceRef.current = true;
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError('Error al cargar datos del dashboard');
      } finally {
        setLoading(false);
        setDebtListRefreshing(false);
      }
    };

    void fetchData();
  }, [debtOverdueFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-emerald-700 font-medium animate-pulse flex items-center gap-2">
          <i className="fas fa-spinner fa-spin"></i> Cargando dashboard...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-center">
        <p className="font-bold mb-2">Error</p>
        <p>{error || 'No se pudieron cargar los datos'}</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-white border border-red-200 rounded-full text-sm font-semibold hover:bg-red-50 transition"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const role = auth.getRole() ?? '';
  const isAdmin = role === 'Administrador';
  const yearPercent = Math.max(0, Math.min(100, Number(data.YearCollectionPercent) || 0));
  const yearPercentText = `${data.YearCollectionPercentStr}%`;

  const cards = [
    {
      id: 0,
      title: 'Empresas',
      value: data.CompaniesCount,
      icon: 'fas fa-layer-group',
      badgeDotColor: 'bg-emerald-200',
      badgeText: 'Clientes del estudio',
      activeBadgeDotColor: 'bg-emerald-500',
      description: 'Clientes del estudio'
    },
    {
      id: 1,
      title: 'Deudas registradas',
      value: data.DocumentsCount,
      icon: 'fas fa-file-invoice-dollar',
      badgeDotColor: 'bg-emerald-500',
      badgeText: 'Cargos en cuentas por cobrar',
      activeBadgeDotColor: 'bg-emerald-200',
      description: 'Cargos en cuentas por cobrar'
    },
    {
      id: 2,
      title: 'Pagos registrados',
      value: data.PaymentsCount,
      icon: 'fas fa-wallet',
      badgeDotColor: 'bg-emerald-500',
      badgeText: 'Abonos realizados por clientes',
      activeBadgeDotColor: 'bg-emerald-200',
      description: 'Abonos realizados por clientes'
    },
    {
      id: 3,
      title: 'Saldo por cobrar',
      value: `S/ ${data.GlobalBalance.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: 'fas fa-circle-dollar-to-slot',
      badgeDotColor: 'bg-emerald-500',
      badgeText: `Deudas S/ ${data.TotalDocs.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Pagos S/ ${data.TotalPays.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      activeBadgeDotColor: 'bg-emerald-200',
      description: `Deudas S/ ${data.TotalDocs.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Pagos S/ ${data.TotalPays.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
  ];

  const getCardClasses = (isActive: boolean) => {
    if (isActive) {
      return "cursor-pointer relative overflow-hidden rounded-[1.75rem] p-6 shadow-xl transition-all duration-300 transform hover:-translate-y-1 bg-gradient-to-br from-emerald-700 to-emerald-900 text-white ring-4 ring-emerald-500/20";
    }
    return "cursor-pointer relative overflow-hidden rounded-[1.75rem] p-6 shadow-sm border border-slate-100 hover:shadow-md transition-all duration-300 bg-white text-slate-800";
  };

  const getIconBgClasses = (isActive: boolean) => {
    if (isActive) {
      return "absolute inset-0 flex items-center justify-center pointer-events-none opacity-15 text-white";
    }
    return "absolute inset-0 flex items-center justify-center pointer-events-none opacity-10 text-emerald-900";
  };

  const getLabelClasses = (isActive: boolean) => {
    if (isActive) {
      return "text-xs font-semibold uppercase tracking-wide opacity-90";
    }
    return "text-xs font-semibold uppercase tracking-wide text-slate-600";
  };

  const getIconContainerClasses = (isActive: boolean) => {
    if (isActive) {
      return "w-7 h-7 rounded-full bg-white/25 flex items-center justify-center backdrop-blur-sm";
    }
    return "w-7 h-7 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-400";
  };

  const getValueClasses = (isActive: boolean) => {
    if (isActive) {
      return "text-4xl font-bold tracking-tight text-white";
    }
    return "text-4xl font-bold tracking-tight text-slate-900";
  };

  const getBadgeContainerClasses = (isActive: boolean) => {
    if (isActive) {
      return "mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 border border-white/20 w-fit backdrop-blur-sm";
    }
    return "mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 w-fit";
  };

  const getBadgeTextClasses = (isActive: boolean) => {
    if (isActive) {
      return "text-[10px] font-medium tracking-wide uppercase";
    }
    return "text-[10px] font-semibold text-slate-500 uppercase";
  };

  return (
    <div className="space-y-6 pt-2">
      {/* Encabezado Dashboard financiero */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Dashboard</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">
            {isAdmin
              ? 'Resumen de clientes, deudas, pagos y saldo global del estudio.'
              : 'Resumen de clientes, deudas, pagos y saldo global de tus empresas asignadas.'}
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/companies"
             className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-700 text-white text-sm font-semibold shadow-md shadow-emerald-800/30 hover:bg-emerald-800 transition">
            <i className="fas fa-building text-xs"></i>
            <span>Ver empresas</span>
          </Link>
          <Link to="/reports/financial"
             className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-800 transition">
            <i className="fas fa-chart-line text-xs"></i>
            <span>Ver reportes</span>
          </Link>
        </div>
      </div>

      {/* Cards resumen financiero */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {cards.map((card, index) => {
          const isActive = activeCard === index;
          return (
            <div key={card.id} onClick={() => setActiveCard(index)} className={getCardClasses(isActive)}>
              <div className={getIconBgClasses(isActive)}>
                <i className={`${card.icon} text-7xl -rotate-12`}></i>
              </div>
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className={getLabelClasses(isActive)}>
                      {card.title}
                    </p>
                    <div className={getIconContainerClasses(isActive)}>
                      <i className="fas fa-arrow-up-right-from-square text-[10px]"></i>
                    </div>
                  </div>
                  <p className={getValueClasses(isActive)}>
                    {card.value}
                  </p>
                </div>
                <div className={getBadgeContainerClasses(isActive)}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-200' : 'bg-emerald-500'}`}></span>
                  <span className={getBadgeTextClasses(isActive)}>
                    {card.badgeText}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* Grid principal */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
        {/* Columna izquierda/centro */}
        <div className="space-y-6 xl:col-span-2">
          {/* Análisis de Proyectos (Gráfico Barras) */}
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Análisis de pagos por mes</h2>
                <p className="text-xs text-slate-400 mt-1">Año {data.MonthlyPaymentsYear} · intensidad según monto pagado.</p>
              </div>
            </div>
            
            <div className="flex items-end justify-between h-40 gap-2 sm:gap-4">
              {data.MonthlyPayments.map((month, idx) => (
                <div key={idx} className="flex flex-col items-center gap-2 w-full group cursor-pointer">
                  {/* Contenedor con fondo de rayas para meses sin pagos */}
                  <div className="w-full max-w-[40px] h-32 rounded-[1rem] relative overflow-hidden transition-all bg-stripes-gray">
                    {month.Level !== "zero" && (
                      <div
                        className={`absolute inset-x-0 bottom-0 rounded-[1rem] ${month.Level === "max" ? "bg-[#065f46] shadow-xl shadow-emerald-900/30 text-white" : "bg-[#34d399] shadow-md shadow-emerald-900/10 text-emerald-900"}`}
                        style={{ height: `${month.Height}%` }}
                      ></div>
                    )}
                    <div className="absolute inset-x-0 bottom-2 text-center text-[10px] font-semibold pointer-events-none">
                      S/ {month.Amount.toFixed(0)}
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-500">{month.Label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Colaboración del Equipo / Empresas con deuda */}
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Empresas con deuda</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Top 10 por saldo pendiente. La mora y el score usan el periodo contable del cargo (periodo de servicio
                  o mes de emisión si no hay periodo). Filtra por meses mínimos de atraso de periodo para priorizar
                  cobros.
                </p>
              </div>
              <div className="flex flex-col gap-1 min-w-[200px]">
                <label htmlFor="dash-debt-mora" className="text-[11px] font-semibold text-slate-500 uppercase">
                  Atraso de periodo (mín.)
                </label>
                <select
                  id="dash-debt-mora"
                  value={debtOverdueFilter}
                  onChange={(e) => setDebtOverdueFilter(e.target.value)}
                  disabled={debtListRefreshing}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-60"
                >
                  <option value="">Todas (top 10 por saldo)</option>
                  <option value="1">≥ 1 mes de atraso (periodo)</option>
                  <option value="2">≥ 2 meses de atraso (periodo)</option>
                  <option value="3">≥ 3 meses de atraso (periodo)</option>
                </select>
              </div>
            </div>

            <div className={`space-y-4 ${debtListRefreshing ? 'opacity-60 pointer-events-none' : ''}`}>
              {debtListRefreshing ? (
                <p className="text-sm text-slate-500 flex items-center gap-2">
                  <i className="fas fa-spinner fa-spin"></i> Actualizando lista…
                </p>
              ) : null}
              {!debtListRefreshing && data.TopDebtors.length > 0 ? (
                data.TopDebtors.map((debtor, idx) => {
                  const mora = periodDebtMoraBadge(debtor.MaxOverdueMonths ?? 0, debtor.HasOverdue ?? false);
                  return (
                    <div key={debtor.Company?.id ?? idx} className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-700 text-xs font-bold border border-emerald-100 overflow-hidden flex-shrink-0">
                          <span className="truncate max-w-[2.5rem]">
                            {debtor.Company.trade_name || debtor.Company.business_name}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{debtor.Company.business_name}</p>
                          <p className="text-[11px] text-slate-400 font-medium">
                            Código: {debtor.Company.code} · RUC: {debtor.Company.ruc}
                            {debtor.OldestOpenDebtPeriod ? (
                              <>
                                {' '}
                                · Periodo más antiguo:{' '}
                                <span className="text-slate-600">{debtor.OldestOpenDebtPeriod}</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <PeriodScoreMini maxLag={debtor.MaxOverdueMonths ?? 0} />
                        <div className="text-right">
                          <p className="text-xs text-slate-400 uppercase font-semibold">Saldo pendiente</p>
                          <p
                            className={`text-sm font-bold ${
                              debtor.Balance > 5000 ? 'text-red-600' : debtor.Balance > 2000 ? 'text-amber-600' : 'text-slate-800'
                            }`}
                          >
                            S/ {debtor.Balance.toFixed(2)}
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-[10px] font-bold tracking-wide whitespace-nowrap ${mora.cls}`}
                        >
                          {mora.label}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : !debtListRefreshing ? (
                <p className="text-sm text-slate-500">
                  {debtOverdueFilter
                    ? 'Ninguna empresa con saldo cumple el filtro de atraso de periodo. Prueba con otro umbral o sin filtro.'
                    : 'No hay empresas con saldo pendiente actualmente. 🎉'}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Columna derecha */}
        <div className="space-y-6">
          {/* Recordatorios / Alertas de cobranza */}
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Alertas de cobranza</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Resumen rápido de pendientes y vencidos en tu cartera.
                </p>
              </div>
              <Link to="/reports/financial"
                 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-700 text-white text-[11px] font-semibold hover:bg-emerald-800">
                <i className="fas fa-chart-pie text-[10px]"></i>
                Reportes
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3">
                <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  Docs pendientes
                </p>
                <p className="mt-1 text-xl font-bold text-amber-800">{data.PendingDocsCount}</p>
              </div>

              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-3">
                <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wide flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                  Docs vencidos
                </p>
                <p className="mt-1 text-xl font-bold text-red-800">{data.OverdueDocsCount}</p>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
                <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  Empresas con deuda
                </p>
                <p className="mt-1 text-xl font-bold text-emerald-800">{data.DebtCompaniesCount}</p>
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-500 flex items-center justify-between gap-3">
              <span>
                Deuda total aproximada: <span className="font-semibold text-slate-700">S/ {data.TotalDebtAmount.toFixed(2)}</span>
              </span>
              <Link to="/companies"
                 className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900">
                <i className="fas fa-building"></i> Ver empresas
              </Link>
            </div>
          </div>

          {/* Progreso del Proyecto / Porcentaje de cobranza anual */}
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
             <h2 className="text-lg font-bold text-slate-800 mb-1">Porcentaje de cobranza del año</h2>
             <p className="text-xs text-slate-400 mb-5">
               Año {data.MonthlyPaymentsYear} · relación entre pagos registrados y deudas cargadas.
             </p>
             
             <div className="flex items-center justify-center relative mb-6">
                <div className="w-48 h-24 overflow-hidden relative">
                   <svg className="absolute inset-0 w-full h-full" viewBox="0 0 192 96" aria-hidden="true">
                      <defs>
                        <linearGradient id="miwebYearCollectionGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#dc2626" />
                          <stop offset="50%" stopColor="#f59e0b" />
                          <stop offset="100%" stopColor="#047857" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 18 88 A 78 78 0 0 1 174 88"
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="18"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 18 88 A 78 78 0 0 1 174 88"
                        fill="none"
                        stroke="url(#miwebYearCollectionGradient)"
                        strokeWidth="18"
                        strokeLinecap="round"
                        strokeDasharray={`${Math.PI * 78} ${Math.PI * 78}`}
                        strokeDashoffset={(Math.PI * 78) * (1 - yearPercent / 100)}
                      />
                   </svg>
                   <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 text-center">
                      <p className="text-4xl font-bold text-slate-800">
                        {yearPercentText}
                      </p>
                      <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                        Cobranza anual
                      </p>
                   </div>
                </div>
             </div>
             
             <div className="flex items-center justify-center gap-4 text-xs font-medium text-slate-500">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-700"></span>
                  <span>Pagos registrados S/ {data.YearCollectionPaysStr}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-300"></span>
                  <span>Deudas S/ {data.YearCollectionDocsStr}</span>
                </div>
             </div>
             
             <div className="mt-6">
                <p className="text-xs font-bold text-slate-400 mb-2">Avance de cobranza anual</p>
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                   <div
                     className="h-full bg-gradient-to-r from-red-600 via-amber-500 to-emerald-700"
                     style={{ width: `${yearPercent}%`, minWidth: '4px' }}
                   ></div>
                </div>
             </div>
          </div>

          {/* Últimas deudas registradas */}
          <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 mb-1">Movimientos recientes</h2>
            <p className="text-xs text-slate-400 mb-5">
              Últimas 5 deudas registradas en el módulo financiero.
            </p>
            
            <ul className="space-y-4">
              {data.RecentDocuments.length > 0 ? (
                data.RecentDocuments.map((doc, idx) => (
                  <li key={idx} className="flex items-start gap-4">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
                      ${(() => {
                        const dueDate = doc.due_date ? new Date(doc.due_date) : null;
                        const isOverdue = Boolean(
                          dueDate &&
                            Number.isFinite(dueDate.getTime()) &&
                            dueDate.getTime() < Date.now() &&
                            doc.status !== 'pagado' &&
                            doc.status !== 'anulado',
                        );
                        if (doc.status === 'pagado') return 'bg-emerald-50 text-emerald-700';
                        if (isOverdue) return 'bg-red-50 text-red-600';
                        return 'bg-amber-50 text-amber-600';
                      })()}`}
                    >
                      <i className="fas fa-file-invoice"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {doc.company ? doc.company.business_name : 'Sin empresa'}
                        </p>
                        <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
                          {doc.issue_date.split('T')[0]}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {doc.type} · {doc.number}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800">
                          S/ {doc.total_amount.toFixed(2)}
                        </p>
                        {(() => {
                          const dueDate = doc.due_date ? new Date(doc.due_date) : null;
                          const isOverdue = Boolean(
                            dueDate &&
                              Number.isFinite(dueDate.getTime()) &&
                              dueDate.getTime() < Date.now() &&
                              doc.status !== 'pagado' &&
                              doc.status !== 'anulado',
                          );
                          const label = isOverdue ? 'vencido' : doc.status;
                          const cls =
                            label === 'pagado'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : label === 'vencido'
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200';
                          return (
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls}`}
                            >
                              {label}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-500">
                  Aún no hay deudas registradas.
                </li>
              )}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
