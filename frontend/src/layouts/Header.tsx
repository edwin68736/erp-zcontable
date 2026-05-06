import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { companiesService } from '../services/companies';
import type { Company, DashboardData } from '../types/dashboard';
import { PeriodScoreMini, periodDebtMoraBadge } from '../utils/periodDebtScore';

interface HeaderProps {
  onToggleSidebar: () => void;
  isSidebarCollapsed: boolean;
  onToggleSidebarCollapse: () => void;
  onOpenThemeModal: () => void;
  userName?: string;
}

const Header = ({
  onToggleSidebar,
  isSidebarCollapsed,
  onToggleSidebarCollapse,
  onOpenThemeModal,
  userName = "Usuario"
}: HeaderProps) => {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Company[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [lastNotificationsFetchAt, setLastNotificationsFetchAt] = useState<number | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const lastSearchIdRef = useRef(0);
  const notificationsLoadingRef = useRef(false);
  const lastNotificationsFetchAtRef = useRef<number | null>(null);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    notificationsLoadingRef.current = notificationsLoading;
  }, [notificationsLoading]);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length <= 3) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    const searchId = ++lastSearchIdRef.current;
    const handle = window.setTimeout(async () => {
      try {
        const results = await companiesService.search(term);
        if (searchId !== lastSearchIdRef.current) return;
        setSearchResults(results);
        setShowResults(results.length > 0);
      } catch {
        if (searchId !== lastSearchIdRef.current) return;
        setSearchResults([]);
        setShowResults(false);
      }
    }, 250);

    return () => window.clearTimeout(handle);
  }, [searchTerm]);

  const fetchNotifications = async () => {
    if (notificationsLoadingRef.current) return;
    try {
      notificationsLoadingRef.current = true;
      setNotificationsLoading(true);
      setNotificationsError('');
      const response = await client.get<DashboardData>('/dashboard');
      setDashboardData(response.data);
      const now = Date.now();
      lastNotificationsFetchAtRef.current = now;
      setLastNotificationsFetchAt(now);
    } catch (e) {
      console.error(e);
      setNotificationsError('Error al cargar notificaciones');
    } finally {
      setNotificationsLoading(false);
      notificationsLoadingRef.current = false;
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchNotifications();
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const last = lastNotificationsFetchAtRef.current;
      if (last && Date.now() - last < 10000) return;
      fetchNotifications();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const notificationsCount = useMemo(() => {
    const debt = dashboardData?.DebtCompaniesCount ?? dashboardData?.TopDebtors?.length ?? 0;
    const pending = dashboardData?.PendingDocsCount ?? 0;
    const overdue = dashboardData?.OverdueDocsCount ?? 0;
    return debt + pending + overdue;
  }, [dashboardData]);

  return (
    <header className="relative z-50 bg-white/70 backdrop-blur rounded-2xl shadow-[0_12px_30px_-18px_rgba(15,23,42,0.35)] border border-slate-200/60 px-6 py-2 flex items-center justify-between mb-3 flex-shrink-0">
      <div className="flex items-center gap-4 lg:hidden">
        <button 
          type="button" 
          className="p-2 -ml-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors" 
          onClick={onToggleSidebar}
        >
          <i className="fas fa-bars text-lg"></i>
        </button>
      </div>

      {/* Search Bar */}
      <div className="flex-1 max-w-xl mr-auto hidden md:block">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleSidebarCollapse}
            className="hidden lg:flex w-11 h-11 rounded-full bg-primary-600 text-white shadow-sm hover:bg-primary-700 transition-colors items-center justify-center"
            aria-label={isSidebarCollapsed ? 'Expandir sidebar' : 'Minimizar sidebar'}
            title={isSidebarCollapsed ? 'Expandir sidebar' : 'Minimizar sidebar'}
          >
            <i className={isSidebarCollapsed ? 'fas fa-angles-right' : 'fas fa-angles-left'}></i>
          </button>

          <div className="relative group flex-1" ref={searchContainerRef}>
            <span className="absolute inset-y-0 left-4 flex items-center text-slate-400 group-focus-within:text-emerald-600 transition-colors">
              <i className="fas fa-search"></i>
            </span>
            <input
              type="text"
              placeholder="Buscar cliente..."
              className="w-full pl-11 pr-4 py-3.5 rounded-full bg-white/80 border border-slate-200/70 text-sm font-medium text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-all shadow-inner"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={() => searchTerm.trim().length > 3 && searchResults.length > 0 && setShowResults(true)}
            />
            <span className="absolute inset-y-0 right-4 flex items-center text-slate-400 text-xs font-bold border border-slate-200 rounded px-1.5 h-6 my-auto bg-white">
              ⌘ F
            </span>
            
            {/* Search Results */}
            {showResults && (
              <div className="absolute left-0 right-0 mt-2 bg-white rounded-2xl shadow-lg border border-slate-100 py-1 max-h-72 overflow-y-auto text-sm text-slate-700 z-30">
                {searchResults.map((item) => (
                  <Link
                    key={item.id}
                    to={`/companies/${item.id}/statement`}
                    className="flex items-center justify-between px-4 py-2 hover:bg-slate-50 cursor-pointer"
                    onClick={() => {
                      setSearchTerm('');
                      setShowResults(false);
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-700 text-[11px] font-bold">
                        {(item.code || '').slice(0, 3).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{item.business_name || 'Sin nombre'}</p>
                        <p className="text-[11px] text-slate-400">{item.ruc || ''}</p>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border text-slate-500 bg-slate-50">
                      Estado de cuenta
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:gap-6 pl-4">
        {/* Notification Icons */}
        <div className="flex items-center gap-2" ref={notificationsRef}>
          <div>
            <button
              type="button"
              className="w-10 h-10 rounded-full bg-white hover:bg-slate-50 text-slate-400 hover:text-emerald-600 transition-all flex items-center justify-center border border-transparent hover:border-slate-100 hover:shadow-sm relative"
              aria-expanded={isNotificationsOpen}
              aria-haspopup="menu"
              onClick={() => {
                setIsNotificationsOpen((prev) => {
                  const next = !prev;
                  if (next && !dashboardData && !notificationsLoading) fetchNotifications();
                  return next;
                });
              }}
            >
              <i className="far fa-bell"></i>
              {notificationsCount > 0 ? (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
                  {notificationsCount > 99 ? '99+' : notificationsCount}
                </span>
              ) : null}
            </button>

            <div
              className={`absolute right-0 mt-3 w-[min(22rem,calc(100vw-3rem))] bg-white rounded-2xl shadow-lg border border-slate-100 transform transition-all duration-200 z-50 origin-top-right overflow-hidden max-h-[calc(100vh-7.5rem)] overflow-y-auto ${
                isNotificationsOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
              }`}
              role="menu"
            >
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">Notificaciones</p>
                  <p className="text-xs text-slate-500 truncate">
                    {lastNotificationsFetchAt
                      ? `Actualizado ${new Date(lastNotificationsFetchAt).toLocaleTimeString()}`
                      : 'Resumen de alertas del estudio'}
                  </p>
                </div>
                <button
                  type="button"
                  className="w-9 h-9 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-emerald-700 flex items-center justify-center"
                  onClick={fetchNotifications}
                  disabled={notificationsLoading}
                  aria-label="Actualizar"
                >
                  <i className={`fas ${notificationsLoading ? 'fa-spinner fa-spin' : 'fa-rotate-right'} text-xs`}></i>
                </button>
              </div>

              {notificationsLoading ? (
                <div className="px-4 py-5 text-sm text-slate-600">
                  <i className="fas fa-spinner fa-spin mr-2"></i> Cargando...
                </div>
              ) : notificationsError ? (
                <div className="px-4 py-4 text-sm text-red-700 bg-red-50 border-t border-red-100">{notificationsError}</div>
              ) : (
                <div className="px-2 py-2">
                  <div className="px-2 py-2">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Empresas con deuda</p>
                      <Link
                        to="/reports/financial"
                        className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                        onClick={() => setIsNotificationsOpen(false)}
                      >
                        Ver reporte
                      </Link>
                    </div>

                    {(dashboardData?.TopDebtors ?? []).length > 0 ? (
                      <div className="space-y-1">
                        {(dashboardData?.TopDebtors ?? []).slice(0, 5).map((debtor, idx) => {
                          const mora = periodDebtMoraBadge(
                            Number(debtor.MaxOverdueMonths ?? 0),
                            Boolean(debtor.HasOverdue),
                          );
                          return (
                            <Link
                              key={debtor.Company?.id ?? `debtor-${idx}`}
                              to={debtor.Company?.id ? `/companies/${debtor.Company.id}/statement` : '/reports/financial'}
                              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
                              onClick={() => setIsNotificationsOpen(false)}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-slate-800 truncate">
                                  {debtor.Company?.business_name || 'Sin nombre'}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {debtor.Company?.ruc || ''}
                                  {debtor.OldestOpenDebtPeriod ? ` · Per. ${debtor.OldestOpenDebtPeriod}` : ''}
                                </p>
                                <span
                                  className={`mt-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${mora.cls}`}
                                >
                                  {mora.label}
                                </span>
                              </div>
                              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <PeriodScoreMini compact maxLag={Number(debtor.MaxOverdueMonths ?? 0)} />
                                <span className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                                  S/ {Number(debtor.Balance ?? 0).toFixed(2)}
                                </span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="px-3 py-2 rounded-xl bg-slate-50 text-xs text-slate-600 border border-slate-100">
                        No hay empresas con deuda por ahora.
                      </div>
                    )}
                  </div>

                  <div className="h-px bg-slate-100 my-1"></div>

                  <div className="px-2 py-2 space-y-1">
                    <Link
                      to="/documents?status=pendiente"
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
                      onClick={() => setIsNotificationsOpen(false)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-100 text-amber-700 flex items-center justify-center">
                          <i className="fas fa-file-invoice text-xs"></i>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800">Deudas pendientes</p>
                          <p className="text-[11px] text-slate-500">Revisar cargos por cobrar.</p>
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full flex-shrink-0">
                        {dashboardData?.PendingDocsCount ?? 0}
                      </span>
                    </Link>

                    <Link
                      to="/documents?status=vencido"
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors"
                      onClick={() => setIsNotificationsOpen(false)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-red-50 border border-red-100 text-red-700 flex items-center justify-center">
                          <i className="fas fa-triangle-exclamation text-xs"></i>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800">Pagos vencidos</p>
                          <p className="text-[11px] text-slate-500">Deudas vencidas pendientes de cobro.</p>
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-red-800 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full flex-shrink-0">
                        {dashboardData?.OverdueDocsCount ?? 0}
                      </span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* User Profile Dropdown */}
        <div className="relative pl-2 border-l border-slate-100" ref={userMenuRef}>
           <button 
             className="flex items-center gap-3 focus:outline-none group"
             onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
             aria-expanded={isUserMenuOpen}
           >
              <div className="text-right hidden sm:block max-w-[200px]">
                 <p className="text-sm font-bold text-slate-800 leading-tight group-hover:text-emerald-700 transition-colors truncate" title={userName}>
                   {userName}
                 </p>
              </div>
              <div className="w-11 h-11 rounded-full bg-emerald-100 p-0.5 shadow-sm cursor-pointer group-hover:shadow-md transition-all ring-2 ring-transparent group-hover:ring-emerald-100">
                 <img
                   src={`https://ui-avatars.com/api/?name=${encodeURIComponent(userName || 'U')}&background=064e3b&color=fff`}
                   alt=""
                   className="w-full h-full rounded-full object-cover"
                 />
              </div>
              <i className={`fas fa-chevron-down text-xs text-slate-400 group-hover:text-emerald-700 transition-colors ml-1 ${isUserMenuOpen ? 'rotate-180' : ''}`}></i>
           </button>

           {/* Dropdown menu */}
           <div 
             className={`absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg py-1 border border-slate-100 transform transition-all duration-200 z-50 origin-top-right ${isUserMenuOpen ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}
             role="menu" 
           >
             <div className="px-4 py-3 border-b border-slate-50">
               <p className="text-xs font-medium text-slate-500">Conectado como</p>
               <p className="text-sm font-bold text-slate-800 truncate" title={userName}>{userName}</p>
             </div>
             
             <Link to="/profile" className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-emerald-700 transition-colors" role="menuitem">
               <i className="far fa-user w-4 text-center"></i>
               <span>Mi Perfil</span>
             </Link>

              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-emerald-700 transition-colors text-left"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  onOpenThemeModal();
                }}
                role="menuitem"
              >
                <i className="fas fa-sliders-h w-4 text-center"></i>
                <span>Tema</span>
              </button>
             
             <div className="border-t border-slate-50 my-1"></div>
             
             <Link to="/logout" className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors" role="menuitem">
               <i className="fas fa-sign-out-alt w-4 text-center"></i>
               <span>Cerrar sesión</span>
             </Link>
           </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
