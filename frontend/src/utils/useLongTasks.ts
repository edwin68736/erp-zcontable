import { useEffect, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import { getTasks, markSeen, subscribe, type LongTask } from './longTasks';

export const useLongTasks = (): LongTask[] => useSyncExternalStore(subscribe, getTasks, getTasks);

/** La consulta de esa clave (`rh:42`), la que esté en curso o la última terminada. */
export const useTask = (key: string): LongTask | undefined => useLongTasks().find((t) => t.key === key);

/**
 * Avisa cuando una consulta que NO inició esta instancia de la pantalla termina o ya había terminado mientras la persona
 * estaba en otra pantalla. Cubre el caso «salí, volví y ya estaba lista»: la pantalla se montó de nuevo y no tiene la
 * respuesta en memoria, así que debe leerla del historial (`resultId`) o mostrar el error.
 *
 * `ownId` guarda el id de la tarea que inició esta misma instancia (esa la resuelve su propio `await`).
 */
export function useTaskSettled(key: string, ownId: MutableRefObject<number | null>, onSettled: (task: LongTask) => void): void {
  const task = useTask(key);
  const handler = useRef(onSettled);
  handler.current = onSettled;
  const prev = useRef<{ id: number; status: LongTask['status'] } | null>(null);
  useEffect(() => {
    if (!task) {
      prev.current = null;
      return;
    }
    const before = prev.current;
    prev.current = { id: task.id, status: task.status };
    if (task.status === 'running' || ownId.current === task.id) return;
    const cameFromRunning = before && before.id === task.id && before.status === 'running';
    const waitingForMe = !before && !task.seen;
    if (cameFromRunning || waitingForMe) {
      markSeen(task.id);
      handler.current(task);
    }
  }, [task, ownId]);
}
