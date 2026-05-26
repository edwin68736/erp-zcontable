export function controlStatusLabel(s: string): string {
  const m: Record<string, string> = {
    al_dia: 'Al día',
    pendiente: 'Pendiente',
    observado: 'Observado',
    vencido: 'Vencido',
    cerrado: 'Cerrado',
  };
  return m[s] ?? s;
}

export function declarationTypeLabel(t: string): string {
  const m: Record<string, string> = {
    pdt_601: 'PDT 601',
    pdt_621: 'PDT 621',
    sire: 'SIRE',
    renta_anual: 'Renta anual',
  };
  return m[t] ?? t;
}

export function declarationStatusLabel(s: string): string {
  const m: Record<string, string> = {
    pendiente: 'Pendiente',
    en_elaboracion: 'En elaboración',
    en_revision: 'En revisión',
    observado: 'Observado',
    aprobado: 'Aprobado',
    presentado: 'Presentado',
    cerrado: 'Cerrado',
  };
  return m[s] ?? s;
}

export function priorityLabel(p: string): string {
  const m: Record<string, string> = {
    baja: 'Baja',
    media: 'Media',
    alta: 'Alta',
    critica: 'Crítica',
  };
  return m[p] ?? p;
}

export function riskLevelLabel(r: string): string {
  const m: Record<string, string> = {
    bajo: 'Bajo',
    medio: 'Medio',
    alto: 'Alto',
    critico: 'Crítico',
  };
  return m[r] ?? r;
}

export function liquidationValidationLabel(s: string): string {
  const m: Record<string, string> = {
    pendiente: 'Pendiente',
    aprobada: 'Aprobada',
    observada: 'Observada',
  };
  return m[s] ?? s;
}

export function npsStatusLabel(s: string): string {
  const m: Record<string, string> = {
    pendiente_generar: 'Pendiente generar',
    generado: 'Generado',
    enviado_cliente: 'Enviado a cliente',
    pendiente_pago: 'Pendiente pago',
    pagado: 'Pagado',
    vencido: 'Vencido',
  };
  return m[s] ?? s;
}

export function currentPeriodYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
