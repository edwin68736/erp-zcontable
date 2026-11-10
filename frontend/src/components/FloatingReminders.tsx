import BuzonUnreadReminder from './BuzonUnreadReminder';
import TodayCalendarReminder from './calendar/TodayCalendarReminder';

/**
 * Avisos flotantes de la esquina inferior derecha: arriba las notificaciones de SUNAT, abajo la agenda de hoy. Son independientes
 * (cada uno decide si se muestra). Si juntos no caben en la pantalla, sus listas se acortan y se desplazan en vez de salirse.
 */
const FloatingReminders = () => (
  <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col items-end gap-3 sm:bottom-6 sm:max-h-[calc(100dvh-3rem)] sm:right-6">
    <BuzonUnreadReminder />
    <TodayCalendarReminder />
  </div>
);

export default FloatingReminders;
