import ExcelJS from 'exceljs';

export type PeriodExcel = { period: string; blob: Blob };

/**
 * Junta varios Excel de la propuesta (uno por periodo, ya generados por el servidor) en un solo libro con una
 * hoja por periodo («202610», «202611»…). Cada hoja queda igual que el Excel individual.
 */
export async function mergePeriodExcels(parts: PeriodExcel[]): Promise<Blob> {
  const out = new ExcelJS.Workbook();
  for (const part of parts) {
    const src = new ExcelJS.Workbook();
    await src.xlsx.load(await part.blob.arrayBuffer());
    const from = src.worksheets[0];
    if (!from) continue;
    const to = out.addWorksheet(part.period);
    from.eachRow({ includeEmpty: true }, (row, n) => {
      const dst = to.getRow(n);
      dst.values = row.values;
      if (n === 1) dst.font = { bold: true };
      dst.commit();
    });
  }
  const buffer = await out.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Periodos AAAAMM entre dos extremos (incluidos), en orden. */
export function periodsBetween(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let y = Number(desde.slice(0, 4));
  let m = Number(desde.slice(4));
  const endY = Number(hasta.slice(0, 4));
  const endM = Number(hasta.slice(4));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 60) break;
  }
  return out;
}
