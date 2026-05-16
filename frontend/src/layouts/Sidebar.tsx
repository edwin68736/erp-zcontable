import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  STUDIO_SECTION,
  filterSidebarEntries,
  getVisibleOperationalModules,
  isSidebarLinkVisible,
  isStudioSectionVisible,
  resolveSidebarModuleIdFromPathname,
  type OperationalModuleConfig,
  type SidebarAccordionId,
  type SidebarLinkItem,
  type SidebarModuleEntry,
} from '../navigation/sidebarConfig';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
}

type LinkVariant = 'desktop-expanded' | 'desktop-flyout' | 'mobile';

const Sidebar = ({ isOpen, onClose, isCollapsed }: SidebarProps) => {
  const location = useLocation();
  const [, setPermissionsTick] = useState(0);
  const visibleOperationalModules = getVisibleOperationalModules();
  const studioVisible = isStudioSectionVisible();
  const studioItems = STUDIO_SECTION.items.filter((l) => isSidebarLinkVisible(l));

  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onPermissionsUpdated = () => setPermissionsTick((n) => n + 1);
    window.addEventListener('miweb:permissions-updated', onPermissionsUpdated);
    return () => window.removeEventListener('miweb:permissions-updated', onPermissionsUpdated);
  }, []);

  const [openModuleId, setOpenModuleId] = useState<SidebarAccordionId | null>(() => {
    return resolveSidebarModuleIdFromPathname(location.pathname) ?? 'finance';
  });

  useEffect(() => {
    const id = resolveSidebarModuleIdFromPathname(location.pathname);
    if (id !== null) setOpenModuleId(id);
  }, [location.pathname]);

  useEffect(() => {
    if (openModuleId === null) return;
    const opsVisible = visibleOperationalModules.some((m) => m.id === openModuleId);
    const studioOk = openModuleId === STUDIO_SECTION.id && studioVisible;
    if (!opsVisible && !studioOk) {
      setOpenModuleId(visibleOperationalModules[0]?.id ?? (studioVisible ? STUDIO_SECTION.id : null));
    }
  }, [openModuleId, visibleOperationalModules, studioVisible]);

  useEffect(() => {
    if (!isCollapsed || openModuleId === null) return;
    const handle = (e: MouseEvent) => {
      const el = asideRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setOpenModuleId(null);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [isCollapsed, openModuleId]);

  const toggleModule = useCallback((id: SidebarAccordionId) => {
    setOpenModuleId((prev) => (prev === id ? null : id));
  }, []);

  const getDesktopExpandedLinkClass = ({ isActive }: { isActive: boolean }) => {
    const base =
      'group flex items-center gap-3 px-4 py-2.5 rounded-2xl text-[13px] leading-snug transition-all duration-200';
    const active = 'bg-gradient-to-r from-[#0B8A72] to-[#0A7C66] text-white font-semibold';
    const inactive = 'text-white/75 hover:bg-white/10 hover:text-white/95 font-medium';
    return `${base} ${isActive ? active : inactive}`;
  };

  const getDesktopFlyoutLinkClass = ({ isActive }: { isActive: boolean }) => {
    const base = 'flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs leading-snug transition-colors';
    const active = 'bg-white/15 text-white font-semibold';
    const inactive = 'text-white/80 hover:bg-white/10 hover:text-white/95 font-medium';
    return `${base} ${isActive ? active : inactive}`;
  };

  const getIconClass = (isActive: boolean, variant: LinkVariant) => {
    const dim =
      variant === 'desktop-flyout' ? 'text-sm' : variant === 'desktop-expanded' ? 'text-[15px]' : 'text-lg';
    return `flex items-center justify-center shrink-0 ${dim} ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white/85'}`;
  };

  const renderNavLink = (
    link: SidebarLinkItem,
    moduleLabel: string,
    variant: LinkVariant,
    onNavigate?: () => void,
  ) => {
    const title = `${moduleLabel} · ${link.label}`;
    const classFn =
      variant === 'desktop-expanded'
        ? getDesktopExpandedLinkClass
        : variant === 'desktop-flyout'
          ? getDesktopFlyoutLinkClass
          : ({ isActive }: { isActive: boolean }) => {
              const base =
                'group flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13px] leading-snug transition-colors';
              const active = 'bg-white/15 text-white font-semibold';
              const inactive = 'text-white/75 hover:bg-white/10 hover:text-white/95 font-medium';
              return `${base} ${isActive ? active : inactive}`;
            };

    return (
      <NavLink
        key={`${variant}-${link.to}`}
        to={link.to}
        className={classFn}
        end={link.exact}
        title={title}
        aria-label={title}
        onClick={onNavigate}
      >
        {({ isActive }) => (
          <>
            <span className={getIconClass(isActive, variant)}>
              <i className={link.icon}></i>
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{link.label}</span>
            {variant === 'desktop-expanded' && isActive && link.label === 'Dashboard' ? (
              <span className="ml-auto w-1.5 h-1.5 shrink-0 rounded-full bg-white" />
            ) : null}
          </>
        )}
      </NavLink>
    );
  };

  const renderEntries = (
    mod: OperationalModuleConfig,
    entries: SidebarModuleEntry[],
    variant: LinkVariant,
    onNavigate?: () => void,
  ) => {
    const filtered = filterSidebarEntries(entries);
    if (filtered.length === 0) return null;

    return (
      <div className="space-y-1">
        {filtered.map((entry) => {
          if (entry.type === 'link') {
            return renderNavLink(entry, mod.label, variant, onNavigate);
          }
          return (
            <div key={`${mod.id}-${entry.label || 'g'}`} className="space-y-1">
              {entry.label ? (
                <p
                  className={
                    variant === 'desktop-flyout'
                      ? 'px-3 pt-2 pb-0.5 text-[10px] font-semibold text-white/40 uppercase tracking-[0.12em]'
                      : 'px-4 pt-2 pb-0.5 text-[10px] font-semibold text-white/35 uppercase tracking-[0.14em]'
                  }
                >
                  {entry.label}
                </p>
              ) : null}
              {entry.items.map((link) => renderNavLink(link, mod.label, variant, onNavigate))}
            </div>
          );
        })}
      </div>
    );
  };

  const renderStudioEntries = (variant: LinkVariant, onNavigate?: () => void) => {
    if (studioItems.length === 0) return null;
    return (
      <div className="space-y-1">
        {studioItems.map((link) => renderNavLink(link, STUDIO_SECTION.label, variant, onNavigate))}
      </div>
    );
  };

  const moduleHeaderButton = (
    mod: OperationalModuleConfig,
    opts: { showLabel: boolean; moduleIndex: number },
  ) => {
    const { showLabel, moduleIndex } = opts;
    const isOpenMod = openModuleId === mod.id;
    const topPad =
      moduleIndex > 0 ? (isCollapsed ? 'mt-2 pt-2 border-t border-white/10' : 'mt-3 pt-3 border-t border-white/10') : '';

    return (
      <div key={mod.id} className={`relative ${topPad}`}>
        <button
          type="button"
          className={`flex w-full items-center rounded-2xl text-left transition-colors hover:bg-white/10 ${
            showLabel ? 'gap-3 px-4 py-2.5' : 'justify-center px-3 py-2.5'
          } ${isOpenMod ? 'bg-white/10' : ''}`}
          onClick={() => toggleModule(mod.id)}
          aria-expanded={isOpenMod}
          title={showLabel ? undefined : mod.label}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg text-white/90">
            <i className={mod.icon} aria-hidden />
          </span>
          {showLabel ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/95">{mod.label}</span>
              <i
                className={`fas fa-chevron-down shrink-0 text-xs text-white/50 transition-transform duration-200 ${
                  isOpenMod ? '-rotate-180' : ''
                }`}
                aria-hidden
              />
            </>
          ) : null}
        </button>

        {isCollapsed && isOpenMod ? (
          <div
            className="absolute left-full top-0 z-[100] ml-2 min-w-[220px] max-w-[min(280px,calc(100vw-6rem))] rounded-2xl border border-white/15 bg-[#042B33] py-3 pl-3 pr-2 shadow-2xl shadow-black/40"
            role="region"
            aria-label={mod.label}
          >
            <p className="mb-2 truncate px-2 text-xs font-bold uppercase tracking-wide text-white/50">{mod.label}</p>
            <div className="custom-scrollbar max-h-[min(70vh,24rem)] overflow-y-auto pr-1">
              {renderEntries(mod, mod.entries, 'desktop-flyout')}
            </div>
          </div>
        ) : null}

        {!isCollapsed && isOpenMod ? (
          <div className="mt-1 border-l border-white/15 pl-2">{renderEntries(mod, mod.entries, 'desktop-expanded')}</div>
        ) : null}
      </div>
    );
  };

  const studioHeaderButton = (opts: { showLabel: boolean; moduleIndex: number }) => {
    const { showLabel, moduleIndex } = opts;
    const id = STUDIO_SECTION.id as SidebarAccordionId;
    const isOpenMod = openModuleId === id;
    const topPad =
      moduleIndex > 0 ? (isCollapsed ? 'mt-2 pt-2 border-t border-white/10' : 'mt-3 pt-3 border-t border-white/10') : '';

    return (
      <div key={STUDIO_SECTION.id} className={`relative ${topPad}`}>
        <button
          type="button"
          className={`flex w-full items-center rounded-2xl text-left transition-colors hover:bg-white/10 ${
            showLabel ? 'gap-3 px-4 py-2.5' : 'justify-center px-3 py-2.5'
          } ${isOpenMod ? 'bg-white/10' : ''}`}
          onClick={() => toggleModule(id)}
          aria-expanded={isOpenMod}
          title={showLabel ? undefined : STUDIO_SECTION.label}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg text-white/90">
            <i className={STUDIO_SECTION.icon} aria-hidden />
          </span>
          {showLabel ? (
            <>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/95">{STUDIO_SECTION.label}</span>
              <i
                className={`fas fa-chevron-down shrink-0 text-xs text-white/50 transition-transform duration-200 ${
                  isOpenMod ? '-rotate-180' : ''
                }`}
                aria-hidden
              />
            </>
          ) : null}
        </button>

        {isCollapsed && isOpenMod ? (
          <div
            className="absolute left-full top-0 z-[100] ml-2 min-w-[220px] rounded-2xl border border-white/15 bg-[#042B33] py-3 pl-3 pr-2 shadow-2xl shadow-black/40"
            role="region"
            aria-label={STUDIO_SECTION.label}
          >
            <p className="mb-2 truncate px-2 text-xs font-bold uppercase tracking-wide text-white/50">
              {STUDIO_SECTION.label}
            </p>
            {renderStudioEntries('desktop-flyout')}
          </div>
        ) : null}

        {!isCollapsed && isOpenMod ? (
          <div className="mt-1 border-l border-white/15 pl-2">{renderStudioEntries('desktop-expanded')}</div>
        ) : null}
      </div>
    );
  };

  const desktopNav = (
    <nav
      className={`custom-scrollbar flex min-h-0 flex-1 flex-col space-y-0 overflow-y-auto overflow-x-visible py-1 pr-1 ${isCollapsed ? 'pl-2' : 'pl-4'}`}
    >
      {visibleOperationalModules.length > 0 ? (
        <p
          className={`px-2 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white/45 ${
            isCollapsed ? 'sr-only' : ''
          }`}
        >
          Módulos
        </p>
      ) : null}
      {visibleOperationalModules.map((mod, idx) =>
        moduleHeaderButton(mod, { showLabel: !isCollapsed, moduleIndex: idx }),
      )}
      {studioVisible
        ? studioHeaderButton({ showLabel: !isCollapsed, moduleIndex: visibleOperationalModules.length })
        : null}
    </nav>
  );

  const mobileModuleBlock = (mod: OperationalModuleConfig) => {
    const isOpenMod = openModuleId === mod.id;

    return (
      <div key={mod.id} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-3 text-left"
          onClick={() => toggleModule(mod.id)}
          aria-expanded={isOpenMod}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/90">
            <i className={mod.icon} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/95">{mod.label}</span>
          <i
            className={`fas fa-chevron-down text-xs text-white/50 transition-transform ${isOpenMod ? '-rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {isOpenMod ? <div className="border-t border-white/10 px-2 py-2">{renderEntries(mod, mod.entries, 'mobile', onClose)}</div> : null}
      </div>
    );
  };

  const mobileStudioBlock = () => {
    if (studioItems.length === 0) return null;
    const id = STUDIO_SECTION.id as SidebarAccordionId;
    const isOpenMod = openModuleId === id;

    return (
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-3 text-left"
          onClick={() => toggleModule(id)}
          aria-expanded={isOpenMod}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/90">
            <i className={STUDIO_SECTION.icon} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/95">{STUDIO_SECTION.label}</span>
          <i
            className={`fas fa-chevron-down text-xs text-white/50 transition-transform ${isOpenMod ? '-rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {isOpenMod ? (
          <div className="border-t border-white/10 px-2 py-2">{renderStudioEntries('mobile', onClose)}</div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <aside
        ref={asideRef}
        className={`relative z-[60] hidden h-full min-h-0 lg:flex flex-col text-white rounded-2xl shadow-[0_16px_40px_-22px_rgba(2,44,52,0.9)] flex-shrink-0 overflow-x-visible overflow-y-hidden bg-[url('/sidebar.png'),radial-gradient(80%_55%_at_20%_78%,rgba(16,185,129,0.30)_0%,rgba(16,185,129,0)_60%),radial-gradient(70%_60%_at_70%_92%,rgba(250,204,21,0.22)_0%,rgba(250,204,21,0)_55%),linear-gradient(180deg,#0A3C45_0%,#06343C_45%,#042B33_100%)] bg-[size:cover,auto,auto,auto] bg-[position:center,center,center,center] bg-[repeat:no-repeat,no-repeat,no-repeat,no-repeat] ${
          isCollapsed ? 'w-[92px]' : 'w-[280px]'
        }`}
      >
        <div className={`flex w-full shrink-0 items-center justify-center ${isCollapsed ? 'px-3 py-7' : 'px-6 py-8'}`}>
          <NavLink
            to="/dashboard"
            className="flex w-full max-w-[150px] justify-center"
            title="ZContable"
            aria-label="Inicio"
          >
            <img src="/logo_side.png" alt="ZContable" className="h-auto w-full max-w-[150px] object-contain" />
          </NavLink>
        </div>

        {desktopNav}

        <div className={`mt-auto shrink-0 ${isCollapsed ? 'p-3' : 'p-6'}`} />
      </aside>

      <div
        className={`fixed inset-0 bg-slate-900/50 z-[70] lg:hidden backdrop-blur-sm transition-opacity ${isOpen ? 'block' : 'hidden'}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-[80] w-72 shadow-2xl transform transition-transform duration-300 lg:hidden flex flex-col h-full text-white bg-[url('/sidebar.png'),radial-gradient(80%_55%_at_20%_78%,rgba(16,185,129,0.30)_0%,rgba(16,185,129,0)_60%),radial-gradient(70%_60%_at_70%_92%,rgba(250,204,21,0.22)_0%,rgba(250,204,21,0)_55%),linear-gradient(180deg,#0A3C45_0%,#06343C_45%,#042B33_100%)] bg-[size:cover,auto,auto,auto] bg-[position:center,center,center,center] bg-[repeat:no-repeat,no-repeat,no-repeat,no-repeat] ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="relative flex shrink-0 items-center justify-center border-b border-white/10 px-6 py-6 min-h-[4.5rem]">
          <NavLink
            to="/dashboard"
            onClick={onClose}
            className="flex max-w-[150px] w-full justify-center"
            aria-label="Inicio"
          >
            <img src="/logo_side.png" alt="ZContable" className="h-auto w-full max-w-[150px] object-contain" />
          </NavLink>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-1/2 -translate-y-1/2 shrink-0 p-1 text-white/60 hover:text-white"
            aria-label="Cerrar menú"
          >
            <i className="fas fa-times" />
          </button>
        </div>
        <nav className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-4 pl-3 pr-1">
          {visibleOperationalModules.length > 0 ? (
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">Módulos</p>
          ) : null}
          <div className="flex flex-col gap-2">
            {visibleOperationalModules.map((mod) => mobileModuleBlock(mod))}
            {mobileStudioBlock()}
          </div>
          <div className="my-4 border-t border-white/10" />
          <NavLink
            to="/logout"
            className="flex items-center gap-4 rounded-xl px-4 py-3 text-white/80 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            <i className="fas fa-sign-out-alt" /> <span>Cerrar sesión</span>
          </NavLink>
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
