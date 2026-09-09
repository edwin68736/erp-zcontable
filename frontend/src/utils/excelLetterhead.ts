import type ExcelJS from 'exceljs';
import { configService } from '../services/config';
import { auth } from '../services/auth';
import { loadLogoDataUrlForPdf } from './pdfLogo';

/** Mismo criterio que publicBaseUrl() en pdf/taxSettlementDocumentV2.tsx / pdf/financeCalendarPdfBuild.ts. */
function publicBaseUrl(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.BASE_URL === 'string') {
    return import.meta.env.BASE_URL;
  }
  return '/';
}

/** Logo de marca incluido en public/, usado si el estudio no tiene logo_url configurado en
 * Ajustes (FirmConfig.logo_url) — mismo fallback y misma forma de traerlo que el PDF v2 de
 * liquidaciones (pdf/taxSettlementDocumentV2.tsx, fetchFallbackLogoBlob): un fetch DIRECTO y
 * relativo al propio origen del frontend (Vite sirve `public/` ahí) — a diferencia de
 * loadLogoDataUrlForPdf/resolveBackendUrl, pensada para logos subidos al backend
 * (FirmConfig.logo_url), que resolvería esta ruta relativa contra el origen del backend y
 * fallaría (404) porque el backend no sirve `public/` del frontend. */
const FALLBACK_LOGO_PATH = 'calendario-pdf-logo.png';

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? '') || null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

async function fetchFallbackLogoDataUrl(): Promise<string | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch(`${publicBaseUrl()}${FALLBACK_LOGO_PATH}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function measureImageSize(dataUrl: string): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** "2026-08" → "Agosto-2026" (mismo formato que el reporte del sistema anterior). */
export function periodTributarioLabel(periodYm: string): string {
  const m = Number(periodYm.slice(5, 7));
  const y = periodYm.slice(0, 4);
  const mes = MESES_ES[m - 1];
  return mes ? `${mes}-${y}` : periodYm;
}

export type ExcelLetterheadWorkspace = 'supervisor' | 'assistant';

export interface ExcelLetterheadOptions {
  sheet: ExcelJS.Worksheet;
  /** Nro. de columnas de la tabla (para saber hasta dónde llega el banner del título). */
  totalCols: number;
  /** Texto del banner — ya debe incluir el sufijo "- SUPERVISORES"/"- ASISTENTES". */
  title: string;
  periodYm: string;
  companyCount: number;
  workspace: ExcelLetterheadWorkspace;
  fontName: string;
  fontSize: number;
}

/**
 * Arma el encabezado con membrete en las filas 1 y 2 de la hoja — mismo formato que el reporte del
 * sistema anterior: logo del estudio a la izquierda, banner con el título a la derecha, y una barra
 * con el responsable (supervisor/asistente que exporta), el período tributario y el total de
 * empresas, antes de la tabla. El logo sale de FirmConfig.logo_url (Ajustes → membrete); si el
 * estudio no configuró uno, cae al logo estático de public/ (mismo fallback que el PDF v2 de
 * liquidaciones) — si tampoco existe, sigue sin logo (no bloquea el export). No toca las filas 3
 * en adelante (encabezado de columnas y datos siguen igual).
 */
export async function buildExcelLetterhead(opts: ExcelLetterheadOptions): Promise<void> {
  const { sheet, totalCols, title, periodYm, companyCount, workspace, fontName, fontSize } = opts;
  const LOGO_COLS = 3;

  const row1 = sheet.getRow(1);
  row1.height = 40;
  sheet.mergeCells(1, LOGO_COLS + 1, 1, totalCols);
  const titleCell = sheet.getCell(1, LOGO_COLS + 1);
  titleCell.value = title;
  titleCell.font = { name: fontName, size: fontSize, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  // Logo: no bloquea el export si falla (empresa sin logo configurado, red, etc.).
  try {
    const firm = await configService.getFirmBranding().catch(() => null);
    const logoDataUrl =
      (firm?.logo_url ? await loadLogoDataUrlForPdf(firm.logo_url) : null) ?? (await fetchFallbackLogoDataUrl());
    if (logoDataUrl) {
      const size = await measureImageSize(logoDataUrl);
      const targetHeight = 34;
      const width = size ? Math.round(targetHeight * (size.width / size.height)) : 120;
      const imageId = sheet.workbook.addImage({ base64: logoDataUrl, extension: 'png' });
      sheet.addImage(imageId, {
        tl: { col: 0.15, row: 0.15 },
        ext: { width, height: targetHeight },
      } as ExcelJS.ImagePosition);
    }
  } catch {
    /* sin logo no bloquea el export */
  }

  // Barra de datos (responsable / período / empresas), en lugar del subtítulo plano de antes.
  const row2 = sheet.getRow(2);
  row2.height = 20;
  const user = auth.getUser();
  const roleLabel = workspace === 'supervisor' ? 'SUPERVISOR' : 'ASISTENTE';
  const labelFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E1' } };
  const valueFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  const setInfoCell = (col: number, value: string, bold: boolean, fill: ExcelJS.Fill) => {
    const c = sheet.getCell(2, col);
    c.value = value;
    c.font = { name: fontName, size: fontSize, bold };
    c.fill = fill;
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  };
  setInfoCell(1, `${roleLabel}:`, true, labelFill);
  sheet.mergeCells(2, 2, 2, 4);
  setInfoCell(2, user?.name || user?.username || '—', false, valueFill);
  setInfoCell(5, 'PERÍODO TRIBUTARIO:', true, labelFill);
  sheet.mergeCells(2, 6, 2, 7);
  setInfoCell(6, periodTributarioLabel(periodYm), false, valueFill);
  setInfoCell(8, 'EMPRESAS:', true, labelFill);
  setInfoCell(9, String(companyCount), false, valueFill);
}
