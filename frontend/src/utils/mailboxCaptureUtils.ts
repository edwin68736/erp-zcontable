import type { SunatInboxCaptureSlot } from '../services/sunatInbox';

export type MailboxWeekProgress = {
  total: number;
  pendiente: number;
  cargado: number;
  verificado: number;
};

function analyzeSlots(slots: SunatInboxCaptureSlot[]) {
  let anyPendiente = false;
  let anyCargado = false;
  let anyVerificado = false;
  let allVerificado = slots.length > 0;

  for (const sl of slots) {
    for (const side of [sl.sunat, sl.sunafil]) {
      switch (side.status) {
        case 'pendiente':
          anyPendiente = true;
          allVerificado = false;
          break;
        case 'cargado':
          anyCargado = true;
          allVerificado = false;
          break;
        case 'verificado':
          anyVerificado = true;
          break;
        default:
          anyPendiente = true;
          allVerificado = false;
      }
    }
  }

  if (slots.length === 0) {
    anyPendiente = true;
    allVerificado = false;
  }

  return { anyPendiente, anyCargado, anyVerificado, allVerificado };
}

export function summarizeMailboxSlots(slots: SunatInboxCaptureSlot[]): string {
  const { anyPendiente, anyCargado, anyVerificado, allVerificado } = analyzeSlots(slots);
  if (allVerificado) return 'verificado';
  if (anyPendiente && (anyCargado || anyVerificado)) return 'parcial';
  if (anyPendiente) return 'pendiente';
  if (anyCargado) return 'cargado';
  return 'pendiente';
}

export function countMailboxWeekProgress(slots: SunatInboxCaptureSlot[]): MailboxWeekProgress {
  const out: MailboxWeekProgress = { total: 0, pendiente: 0, cargado: 0, verificado: 0 };
  for (const sl of slots) {
    for (const side of [sl.sunat, sl.sunafil]) {
      out.total += 1;
      if (side.status === 'verificado') out.verificado += 1;
      else if (side.status === 'cargado') out.cargado += 1;
      else out.pendiente += 1;
    }
  }
  return out;
}

export function matchesMailboxListFilter(slots: SunatInboxCaptureSlot[], filter: string): boolean {
  const f = filter.trim();
  if (!f) return true;
  const { anyPendiente, anyCargado, anyVerificado, allVerificado } = analyzeSlots(slots);
  switch (f) {
    case 'pendiente':
      return anyPendiente;
    case 'cargado':
      return anyCargado;
    case 'verificado':
      return allVerificado;
    case 'parcial':
      return anyPendiente && (anyCargado || anyVerificado);
    default:
      return summarizeMailboxSlots(slots) === f;
  }
}
