/**
 * Aviso de acogimiento a "IGV Justo" (Ley 30524, postergación del pago del IGV para MYPE).
 * Solo se renderiza cuando el supervisor activó la bandera al crear la liquidación — no hay
 * nada que mostrar cuando no está acogida (a diferencia de `DetraccionReadOnlyBar`, que sí
 * informa el estado "sin aplicación").
 */
export function IgvJustoReadOnlyBar() {
  return (
    <div className="mt-3 pt-3 border-t border-sky-100 bg-sky-50/60 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
      <i className="fas fa-calendar-check text-sky-600 text-sm" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-sky-900">Acogido a IGV Justo</p>
        <p className="text-[11px] text-sky-700">
          El cliente puede postergar el pago del IGV según el cronograma especial para MYPE.
        </p>
      </div>
    </div>
  );
}

export default IgvJustoReadOnlyBar;
