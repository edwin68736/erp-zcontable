import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import TodayCalendarReminder from '../components/calendar/TodayCalendarReminder';
import DensityPicker from '../components/DensityPicker';
import { DENSITY_KEY, parseDensityPref, resolveDensity, type DensityPref } from '../utils/density';
import { SIDEBAR_PREF_KEY, initialSidebarCollapsed } from '../utils/sidebarPref';
import IdleLogoutGuard from '../components/IdleLogoutGuard';
import NotifyHost from '../components/NotifyHost';
import { showLegacyToast } from '../utils/notify';
import ReauthDialog from '../components/ReauthDialog';
import { auth } from '../services/auth';
import { ensureTukifacSeriesCached } from '../services/tukifacSeriesCache';

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Solo manda lo que la persona eligió con el botón; si nunca eligió, en pantallas angostas arranca colapsado.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(SIDEBAR_PREF_KEY);
    } catch {
      stored = null;
    }
    return initialSidebarCollapsed(stored, window.innerWidth);
  });
  // En Inicio el menú arranca colapsado (la escena ocupa todo el ancho); el botón de la cabecera
  // lo expande solo mientras se siga en Inicio y no toca la preferencia guardada para el resto.
  const { pathname } = useLocation();
  const isHome = pathname === '/';
  const [homeSidebarExpanded, setHomeSidebarExpanded] = useState(false);
  useEffect(() => {
    if (isHome) setHomeSidebarExpanded(false);
  }, [isHome]);
  const sidebarCollapsed = isHome ? !homeSidebarExpanded : isSidebarCollapsed;
  const toggleSidebarCollapse = () => {
    if (isHome) {
      setHomeSidebarExpanded((v) => !v);
      return;
    }
    const next = !isSidebarCollapsed;
    setIsSidebarCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_PREF_KEY, next ? '1' : '0');
    } catch {
      /* sin almacenamiento: no se recuerda la elección */
    }
  };
  const [layoutThemeBg, setLayoutThemeBg] = useState(() => {
    try {
      return window.localStorage.getItem('layoutThemeBg') ?? '';
    } catch {
      return '';
    }
  });
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [densityPref, setDensityPref] = useState<DensityPref>(() => {
    try {
      return parseDensityPref(window.localStorage.getItem(DENSITY_KEY));
    } catch {
      return 'auto';
    }
  });
  // La densidad efectiva (compacta/cómoda) se publica en <html data-density> y el CSS global la aplica a las tablas.
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.density = resolveDensity(densityPref, window.innerWidth, window.innerHeight);
    };
    apply();
    if (densityPref !== 'auto') return;
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [densityPref]);
  const handleDensityChange = (next: DensityPref) => {
    setDensityPref(next);
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      /* sin almacenamiento: no se recuerda la elección */
    }
  };
  const user = auth.getUser();
  const hasThemeBg = Boolean(layoutThemeBg);

  const themeOptions = [
    { id: 'theme1', src: '/themes/theme1.jpg', label: 'Tema 1' },
    { id: 'theme2', src: '/themes/theme2.jpg', label: 'Tema 2' },
    { id: 'theme3', src: '/themes/theme3.jpg', label: 'Tema 3' },
    { id: 'theme4', src: '/themes/theme4.jpg', label: 'Tema 4' },
  ];

  useEffect(() => {
    void ensureTukifacSeriesCached().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!auth.getToken()) return;
    if (auth.hasStoredPermissions()) return;
    void auth.refreshPermissions().catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      if (!layoutThemeBg) {
        window.localStorage.removeItem('layoutThemeBg');
        return;
      }
      window.localStorage.setItem('layoutThemeBg', layoutThemeBg);
    } catch {
      return;
    }
  }, [layoutThemeBg]);

  useEffect(() => {
    if (!isThemeModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsThemeModalOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isThemeModalOpen]);

  // Avisos antiguos (`miweb:toast`): se muestran como alertas centradas (utils/notify.ts).
  useEffect(() => {
    const handleToast = (event: Event) => showLegacyToast((event as CustomEvent<{ type?: string; message?: string }>).detail);
    window.addEventListener('miweb:toast', handleToast);
    return () => window.removeEventListener('miweb:toast', handleToast);
  }, []);

  const handleSelectTheme = (src: string) => {
    setLayoutThemeBg(src);
    setIsThemeModalOpen(false);
  };

  const handleUploadTheme = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;
      setLayoutThemeBg(result);
      setIsThemeModalOpen(false);
    };
    reader.readAsDataURL(file);
  };

  // La contraseña la puso un administrador: no se puede usar el sistema hasta cambiarla.
  if (auth.mustChangePassword() && pathname !== '/profile') {
    return <Navigate to="/profile" replace />;
  }

  return (
    <div
      className="bg-gradient-to-b from-slate-50 to-slate-100 h-screen overflow-hidden text-slate-800 font-sans"
      style={
        layoutThemeBg
          ? {
              backgroundImage: `linear-gradient(to bottom, rgba(248, 250, 252, 0.38), rgba(241, 245, 249, 0.55)), url(${layoutThemeBg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundAttachment: 'fixed',
            }
          : undefined
      }
    >
      <div className="flex h-full p-2 lg:p-3 gap-3">
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          isCollapsed={sidebarCollapsed}
        />
        
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <Header
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            isSidebarCollapsed={sidebarCollapsed}
            onToggleSidebarCollapse={toggleSidebarCollapse}
            onOpenThemeModal={() => setIsThemeModalOpen(true)}
            userName={user?.name}
          />
          
          <main className="relative z-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pr-1">
            <div
              className={`min-h-full rounded-2xl shadow-[0_12px_30px_-18px_rgba(15,23,42,0.35)] border px-2 md:px-5 pt-3 pb-4 ${
                hasThemeBg
                  ? 'bg-gradient-to-b from-white/40 to-white/20 backdrop-blur-sm border-slate-200/50'
                  : 'bg-gradient-to-b from-white/70 to-white/40 backdrop-blur border-slate-200/60'
              }`}
            >
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      {isThemeModalOpen ? (
        <div className="fixed inset-0 z-dialog flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setIsThemeModalOpen(false)}
            aria-label="Cerrar ajustes"
          ></button>

          <div className="relative w-full max-w-3xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-6rem)]">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100 bg-white/90 backdrop-blur shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Ajustes</h3>
                <p className="text-xs text-slate-500">Densidad de las listas y tema de fondo.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsThemeModalOpen(false)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                aria-label="Cerrar"
              >
                <i className="fas fa-times text-xs"></i>
              </button>
            </div>

            <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5 overflow-y-auto flex-1 min-h-0">
              <DensityPicker value={densityPref} onChange={handleDensityChange} />
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {themeOptions.map((t) => {
                  const selected = layoutThemeBg === t.src;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelectTheme(t.src)}
                      className={`group rounded-xl border overflow-hidden text-left transition ${
                        selected ? 'border-primary-500 ring-2 ring-primary-200' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="aspect-[3/4] sm:aspect-[4/5] bg-slate-100 overflow-hidden">
                        <img
                          src={t.src}
                          alt={t.label}
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                        />
                      </div>
                      <div className="px-3 py-2">
                        <div className="text-xs font-semibold text-slate-800">{t.label}</div>
                        <div className="text-2xs text-slate-500">{selected ? 'Seleccionado' : 'Elegir'}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Subir imagen</div>
                  <div className="text-xs text-slate-500">Usa una imagen propia como fondo.</div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 cursor-pointer">
                    <i className="fas fa-upload mr-2 text-xs"></i> Subir
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        handleUploadTheme(file);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-slate-300 text-slate-700 text-sm font-medium hover:bg-white"
                    onClick={() => setLayoutThemeBg('')}
                    disabled={!layoutThemeBg}
                  >
                    Restablecer
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Fuera del panel de contenido: su `backdrop-blur` haría que estos diálogos se centraran en el panel y no en la pantalla. */}
      <IdleLogoutGuard />
      <ReauthDialog />
      <NotifyHost />
      <TodayCalendarReminder />
    </div>
  );
};

export default Layout;
