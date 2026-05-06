import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { auth } from '../services/auth';
import { ensureTukifacSeriesCached } from '../services/tukifacSeriesCache';

type ToastType = 'success' | 'error' | 'info';

type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
};

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('sidebarCollapsed') === '1';
    } catch {
      return false;
    }
  });
  const [layoutThemeBg, setLayoutThemeBg] = useState(() => {
    try {
      return window.localStorage.getItem('layoutThemeBg') ?? '';
    } catch {
      return '';
    }
  });
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
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
    try {
      window.localStorage.setItem('sidebarCollapsed', isSidebarCollapsed ? '1' : '0');
    } catch {
      return;
    }
  }, [isSidebarCollapsed]);

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

  useEffect(() => {
    const handleToast = (event: Event) => {
      const e = event as CustomEvent<{ type?: ToastType; message?: string }>;
      const message = typeof e.detail?.message === 'string' ? e.detail.message.trim() : '';
      const type = e.detail?.type ?? 'info';
      if (!message) return;

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((prev) => [...prev, { id, type, message }]);

      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    };

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
      <div className="fixed top-4 right-4 z-[9999] space-y-2 pointer-events-none">
        {toasts.map((t) => {
          const icon =
            t.type === 'success' ? 'fa-check-circle' : t.type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
          const ring =
            t.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : t.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-900'
                : 'border-slate-200 bg-white text-slate-900';
          return (
            <div
              key={t.id}
              className={`pointer-events-auto w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-lg px-4 py-3 text-sm ${ring}`}
            >
              <div className="flex items-start gap-3">
                <div className="pt-0.5">
                  <i className={`fas ${icon}`}></i>
                </div>
                <div className="flex-1 leading-5">{t.message}</div>
                <button
                  type="button"
                  aria-label="Cerrar"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-full hover:bg-black/5"
                  onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                >
                  <i className="fas fa-times text-xs"></i>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex h-full p-4 lg:p-4 gap-4">
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          isCollapsed={isSidebarCollapsed}
        />
        
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <Header
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebarCollapse={() => setIsSidebarCollapsed((v) => !v)}
            onOpenThemeModal={() => setIsThemeModalOpen(true)}
            userName={user?.name}
          />
          
          <main className="relative z-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar pr-1">
            <div
              className={`min-h-full pb-6 rounded-2xl shadow-[0_12px_30px_-18px_rgba(15,23,42,0.35)] border px-2 md:px-6 py-4 ${
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
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4">
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
                <p className="text-xs text-slate-500">Selecciona un tema para el fondo del layout.</p>
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
                        <div className="text-[11px] text-slate-500">{selected ? 'Seleccionado' : 'Elegir'}</div>
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
    </div>
  );
};

export default Layout;
