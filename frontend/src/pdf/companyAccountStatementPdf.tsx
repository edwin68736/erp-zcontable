/**
 * Estado de cuenta: generación con **pdf-lib** (`buildAccountStatementPdfBlob`), no con @react-pdf,
 * para embeber imágenes de forma fiable (PNG/JPEG) en el navegador.
 */
import type { AccountLedger, Company, FirmConfig } from '../types/dashboard';
import { buildAccountStatementPdfBlob, companyAccountStatementPdfFilename, type StatementPdfAssets } from './companyAccountStatementPdfBuild';

export { loadImageBlobForPdf as getLogoPngBlobForAccountPdf } from '../utils/pdfLogo';
export type { StatementPdfAssets };

export async function generateCompanyAccountStatementPdfBlob(
  company: Company,
  ledger: AccountLedger,
  firm: FirmConfig | null,
  logoPng: Blob | null,
  extra?: StatementPdfAssets | null,
): Promise<Blob> {
  return buildAccountStatementPdfBlob(company, ledger, firm, logoPng, extra);
}

export { companyAccountStatementPdfFilename };
