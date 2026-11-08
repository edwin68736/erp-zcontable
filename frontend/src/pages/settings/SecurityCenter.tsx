import { useCallback, useEffect, useState } from 'react';
import PageHeading from '../../components/ui/PageHeading';
import { P } from '../../rbac/codes';
import { auth } from '../../services/auth';
import { securityService, type PendingApproval } from '../../services/security';
import ApprovalsTab from '../security/ApprovalsTab';
import SettingsTab from '../security/SettingsTab';
import UserDevicesTab from '../security/UserDevicesTab';
import SecurityEvents from './SecurityEvents';

type TabId = 'events' | 'approvals' | 'devices' | 'settings';

/** Cada cuántos segundos se revisan las solicitudes de aprobación pendientes. */
const POLL_MS = 10000;

/**
 * Estudio → Seguridad: bitácora de accesos, aprobación de equipos nuevos, equipos de cada usuario y configuración de los
 * dispositivos de confianza. Cada pestaña aparece según el permiso de quien mira.
 */
const SecurityCenter = () => {
  const canEvents = auth.hasPermission(P.securityEventsView);
  const canManage = auth.hasPermission(P.securityDevicesManage);
  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'events', label: 'Bitácora', show: canEvents },
    { id: 'approvals', label: 'Aprobaciones', show: canManage },
    { id: 'devices', label: 'Dispositivos por usuario', show: canManage },
    { id: 'settings', label: 'Configuración', show: canEvents || canManage },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<TabId>(visible[0]?.id ?? 'events');
  const [pending, setPending] = useState<PendingApproval[] | null>(null);

  const loadPending = useCallback(async () => {
    if (!canManage) return;
    try {
      setPending(await securityService.pendingApprovals());
    } catch {
      /* se reintenta en el siguiente ciclo */
    }
  }, [canManage]);

  useEffect(() => {
    void loadPending();
    if (!canManage) return;
    const timer = window.setInterval(() => void loadPending(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [canManage, loadPending]);

  return (
    <div className="space-y-5 pt-2">
      <div>
        <PageHeading>Seguridad</PageHeading>
        <p className="mt-1 text-sm text-slate-500">Accesos al sistema, equipos de confianza y verificación en dos pasos.</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
        {visible.map((t) => {
          const count = t.id === 'approvals' ? (pending?.length ?? 0) : 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {t.label}
              {count > 0 ? <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === 'events' && canEvents ? <SecurityEvents embedded /> : null}
      {tab === 'approvals' && canManage ? <ApprovalsTab rows={pending} onChanged={() => void loadPending()} /> : null}
      {tab === 'devices' && canManage ? <UserDevicesTab /> : null}
      {tab === 'settings' ? <SettingsTab canEdit={canManage} /> : null}
    </div>
  );
};

export default SecurityCenter;
