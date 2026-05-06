import client from '../api/client';
import type { FirmConfig } from '../types/dashboard';

type StatementBankLogoUploadResponse = {
  success: boolean;
  data: { statement_bank_logo_url: string; config: FirmConfig };
};

type StatementPaymentQrUploadResponse = {
  success: boolean;
  data: { statement_payment_qr_url: string; config: FirmConfig };
};

export const configService = {
  async getFirmConfig(): Promise<FirmConfig> {
    const res = await client.get<FirmConfig>('/firm-config');
    return res.data;
  },

  /** Membrete del estudio sin tokens Tukifac (PDF, listados). */
  async getFirmBranding(): Promise<FirmConfig> {
    const res = await client.get<FirmConfig>('/firm-config/branding');
    return res.data;
  },

  async updateFirmConfig(input: Partial<FirmConfig>): Promise<FirmConfig> {
    const res = await client.put<FirmConfig>('/firm-config', input);
    return res.data;
  },

  async uploadFirmLogo(file: File): Promise<{ logo_url: string; config: FirmConfig }> {
    const form = new FormData();
    form.append('file', file);
    const res = await client.post<{ success: boolean; data: { logo_url: string; config: FirmConfig } }>(
      '/firm-config/logo',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  async uploadStatementBankLogo(file: File): Promise<{ statement_bank_logo_url: string; config: FirmConfig }> {
    const form = new FormData();
    form.append('file', file);
    const res = await client.post<StatementBankLogoUploadResponse>(
      '/firm-config/statement-bank-logo',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },

  async uploadStatementPaymentQr(file: File): Promise<{ statement_payment_qr_url: string; config: FirmConfig }> {
    const form = new FormData();
    form.append('file', file);
    const res = await client.post<StatementPaymentQrUploadResponse>(
      '/firm-config/statement-payment-qr',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data.data;
  },
};

