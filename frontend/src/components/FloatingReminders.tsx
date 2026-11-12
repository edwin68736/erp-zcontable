import { useState } from 'react';
import BuzonUnreadReminder from './BuzonUnreadReminder';
import SolKeysFloating from './SolKeysFloating';
import TodayCalendarReminder from './calendar/TodayCalendarReminder';

/**
 * Flotantes de la esquina inferior derecha: arriba las notificaciones de SUNAT, luego la agenda de hoy y abajo el botón de Claves SOL
 * (abre un modal con la lista de claves desde cualquier vista). Son independientes (cada uno decide si se muestra). Si juntos no
 * caben en la pantalla, sus listas se acortan y se desplazan en vez de salirse. Con el modal de Claves SOL abierto, los avisos se
 * esconden para no taparlo.
 */
const FloatingReminders = () => {
  const [solOpen, setSolOpen] = useState(false);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col items-end gap-3 sm:bottom-6 sm:max-h-[calc(100dvh-3rem)] sm:right-6">
      <div className={solOpen ? 'hidden' : 'contents'}>
        <BuzonUnreadReminder />
        <TodayCalendarReminder />
      </div>
      <SolKeysFloating open={solOpen} onOpenChange={setSolOpen} />
    </div>
  );
};

export default FloatingReminders;
