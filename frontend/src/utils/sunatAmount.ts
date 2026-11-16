/**
 * Lee un importe tal como lo muestra SUNAT, que usa el formato peruano antiguo («78.000,00»: punto de miles y coma decimal) y a
 * veces el inglés («78,000.00»). Con los dos separadores manda el último (es el decimal); con uno solo se decide por su forma:
 * «1,234» y «78.000» son miles (grupos de tres), «3,90» y «0.05» son decimales. Devuelve null si no es un número.
 * (El servidor tiene la misma regla: parseSunatAmount en backend/services/sunat_itf_service.go.)
 */
export function parseSunatAmount(raw: string | undefined | null): number | null {
  let s = (raw ?? '').replace(/s\/|\$|\s| /gi, '');
  if (s === '') return null;
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = (s.match(/,/g) ?? []).length > 1 || /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (dot >= 0) {
    if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return neg ? -v : v;
}
