import { NavLink } from 'react-router-dom';
import { auth } from '../services/auth';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
}

const Sidebar = ({ isOpen, onClose, isCollapsed }: SidebarProps) => {
  const role = auth.getRole() ?? '';
  const isAdmin = role === 'Administrador';

  const links = [
    { to: '/dashboard', icon: 'fas fa-th-large', label: 'Dashboard', exact: true },
    { to: '/companies', icon: 'fas fa-building', label: 'Empresas' },
    { to: '/documents', icon: 'fas fa-file-invoice-dollar', label: 'Deudas' },
    { to: '/tax-settlements', icon: 'fas fa-file-signature', label: 'Liquidaciones' },
    { to: '/comprobantes', icon: 'fas fa-file-invoice', label: 'Comprobantes' },
    { to: '/payments', icon: 'fas fa-wallet', label: 'Pagos' },
  ];

  const generalLinks = [
    { to: '/subscription-plans', icon: 'fas fa-layer-group', label: 'Planes' },
    { to: '/products', icon: 'fas fa-box-open', label: 'Productos' },
    { to: '/tukifac/documentos', icon: 'fas fa-cloud-download-alt', label: 'Documentos Tukifac' },
    { to: '/documents/fiscal-receipts', icon: 'fas fa-link', label: 'Conciliación Tukifac' },
    { to: '/reports/financial', icon: 'fas fa-chart-line', label: 'Reportes' },
    ...(isAdmin
      ? [
          { to: '/settings/firm', icon: 'fas fa-gear', label: 'Configuración' },
          { to: '/users', icon: 'fas fa-users-cog', label: 'Usuarios y roles' },
        ]
      : []),
  ];

  // Helper for NavLink className
  const getLinkClass = ({ isActive }: { isActive: boolean }) => {
    const base = `group flex items-center rounded-2xl transition-all duration-200 relative ${
      isCollapsed ? 'justify-center px-3 py-3.5' : 'gap-4 px-4 py-3.5'
    }`;
    const active =
      "bg-gradient-to-r from-[#0B8A72] to-[#0A7C66] text-white font-semibold";
    const inactive = "text-white/80 hover:bg-white/10 hover:text-white font-medium";
    return `${base} ${isActive ? active : inactive}`;
  };

  const getIconClass = (isActive: boolean) => {
    return `flex items-center justify-center text-lg ${isActive ? "text-white" : "text-white/65 group-hover:text-white"}`;
  };

  const renderLinks = (linkList: typeof links) => (
    linkList.map((link) => (
      <NavLink
        key={link.to}
        to={link.to}
        className={getLinkClass}
        end={link.exact}
        title={isCollapsed ? link.label : undefined}
        aria-label={isCollapsed ? link.label : undefined}
      >
        {({ isActive }) => (
          <>
            <span className={getIconClass(isActive)}>
              <i className={link.icon}></i>
            </span>
            {!isCollapsed ? <span>{link.label}</span> : null}
            {!isCollapsed && isActive && link.label === 'Dashboard' && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white"></span>
            )}
          </>
        )}
      </NavLink>
    ))
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col text-white rounded-2xl shadow-[0_16px_40px_-22px_rgba(2,44,52,0.9)] flex-shrink-0 relative overflow-hidden bg-[url('/sidebar.png'),radial-gradient(80%_55%_at_20%_78%,rgba(16,185,129,0.30)_0%,rgba(16,185,129,0)_60%),radial-gradient(70%_60%_at_70%_92%,rgba(250,204,21,0.22)_0%,rgba(250,204,21,0)_55%),linear-gradient(180deg,#0A3C45_0%,#06343C_45%,#042B33_100%)] bg-[size:cover,auto,auto,auto] bg-[position:center,center,center,center] bg-[repeat:no-repeat,no-repeat,no-repeat,no-repeat] ${
          isCollapsed ? 'w-[92px]' : 'w-[280px]'
        }`}
      >
        <div
          className={`flex w-full items-center justify-center ${
            isCollapsed ? 'px-3 py-7' : 'px-6 py-8'
          }`}
        >
          <NavLink
            to="/dashboard"
            className="flex w-full max-w-[150px] justify-center"
            title="ZContable"
            aria-label="Inicio"
          >
            <img
              src="/logo_side.png"
              alt="ZContable"
              className="h-auto w-full max-w-[150px] object-contain"
            />
          </NavLink>
        </div>
        
        <nav className={`flex-1 space-y-2 overflow-y-auto overflow-x-hidden custom-scrollbar ${isCollapsed ? 'px-3' : 'px-6'}`}>
          {!isCollapsed ? (
            <p className="px-4 mb-3 text-[11px] font-bold text-white/45 uppercase tracking-[0.12em]">
              MENÚ
            </p>
          ) : null}
          {renderLinks(links)}

          {!isCollapsed ? (
            <div className="pt-6 pb-2">
              <p className="px-4 mb-3 text-[11px] font-bold text-white/45 uppercase tracking-[0.12em]">
                GENERAL
              </p>
            </div>
          ) : (
            <div className="pt-6"></div>
          )}
          {renderLinks(generalLinks)}
        </nav>

        <div className={`mt-auto ${isCollapsed ? 'p-3' : 'p-6'}`}>
          {/* Espacio reservado */}
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      <div 
        className={`fixed inset-0 bg-slate-900/50 z-[70] lg:hidden backdrop-blur-sm transition-opacity ${isOpen ? 'block' : 'hidden'}`}
        onClick={onClose}
        aria-hidden="true"
      ></div>
      
      {/* Mobile Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-[80] w-72 shadow-2xl transform transition-transform duration-300 lg:hidden flex flex-col h-full text-white bg-[url('/sidebar.png'),radial-gradient(80%_55%_at_20%_78%,rgba(16,185,129,0.30)_0%,rgba(16,185,129,0)_60%),radial-gradient(70%_60%_at_70%_92%,rgba(250,204,21,0.22)_0%,rgba(250,204,21,0)_55%),linear-gradient(180deg,#0A3C45_0%,#06343C_45%,#042B33_100%)] bg-[size:cover,auto,auto,auto] bg-[position:center,center,center,center] bg-[repeat:no-repeat,no-repeat,no-repeat,no-repeat] ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="relative px-6 py-6 flex items-center justify-center border-b border-white/10 min-h-[4.5rem]">
          <NavLink
            to="/dashboard"
            onClick={onClose}
            className="flex justify-center max-w-[150px] w-full"
            aria-label="Inicio"
          >
            <img
              src="/logo_side.png"
              alt="ZContable"
              className="h-auto w-full max-w-[150px] object-contain"
            />
          </NavLink>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-1/2 -translate-y-1/2 shrink-0 text-white/60 hover:text-white p-1"
            aria-label="Cerrar menú"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
           {[...links, ...generalLinks].map(link => (
             <NavLink 
               key={link.to} 
               to={link.to} 
               className={({isActive}) => `flex items-center gap-4 px-4 py-3 rounded-xl ${isActive ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
               onClick={onClose}
             >
                <i className={link.icon}></i> <span>{link.label}</span>
             </NavLink>
           ))}
           <div className="my-4 border-t border-white/10"></div>
           <NavLink to="/logout" className="flex items-center gap-4 px-4 py-3 rounded-xl text-white/80 hover:bg-white/10 hover:text-white">
              <i className="fas fa-sign-out-alt"></i> <span>Cerrar sesión</span>
           </NavLink>
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
