import BuzonUnreadReminder from './BuzonUnreadReminder';
import TodayCalendarReminder from './calendar/TodayCalendarReminder';

/** Avisos flotantes de la esquina inferior derecha: arriba las notificaciones de SUNAT, abajo la agenda de hoy. */
const FloatingReminders = () => (
  <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3 sm:bottom-6 sm:right-6">
    <BuzonUnreadReminder />
    <TodayCalendarReminder />
  </div>
);

export default FloatingReminders;
