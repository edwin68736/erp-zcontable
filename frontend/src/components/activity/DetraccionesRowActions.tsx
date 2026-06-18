import { useRef, useState, type ChangeEvent } from 'react';
import { resolveBackendUrl } from '../../api/client';
import { downloadRemoteFile } from '../../utils/downloadFile';
import FilePreviewModal from '../FilePreviewModal';
import {
  detraccionesAllowsUpload,
  detraccionesSupervisorCanSetManualStatus,
  detraccionesStatusBadgeClass,
  detraccionesStatusLabel,
  normalizeDetraccionesStatus,
} from './detraccionesConfig';
import DetraccionesStatusModal from './DetraccionesStatusModal';
import type { DetraccionesListRow } from '../../services/detracciones';
import type { ActivityWorkspace } from '../../navigation/activityRoutes';

type DetraccionesRowActionsProps = {
  row: DetraccionesListRow;
  periodYm: string;
  workspace: ActivityWorkspace;
  canUpload: boolean;
  canVerify: boolean;
  canSetStatus: boolean;
  onUpdated: () => void;
  onUpload: (companyId: number, file: File) => Promise<void>;
  onVerify: (declarationId: number) => Promise<void>;
  onSetStatus: (companyId: number, declarationId: number | undefined, status: 'sin_clave' | 'no_corresponde') => Promise<void>;
};

function validatePdfClient(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf')) {
    return 'Solo se permiten archivos PDF.';
  }
  if (file.type && file.type !== 'application/pdf') {
    return 'El archivo debe ser PDF.';
  }
  return null;
}

const DetraccionesRowActions = ({
  row,
  workspace,
  canUpload,
  canVerify,
  canSetStatus,
  onUpdated,
  onUpload,
  onVerify,
  onSetStatus,
}: DetraccionesRowActionsProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);

  const status = normalizeDetraccionesStatus(row.status);
  const fileName = row.file_name?.trim() || 'Comprobante.pdf';
  const fileUrl = row.file_url ? resolveBackendUrl(row.file_url) : '';
  const showUpload = canUpload && workspace === 'assistant' && detraccionesAllowsUpload(status);
  const showVerify = canVerify && workspace === 'supervisor' && status === 'cargado' && Boolean(row.declaration_id);
  const showStatusEdit =
    canSetStatus && workspace === 'supervisor' && detraccionesSupervisorCanSetManualStatus(status);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const err = validatePdfClient(file);
    if (err) {
      window.alert(err);
      return;
    }
    try {
      setUploading(true);
      await onUpload(row.company_id, file);
      onUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleVerify = async () => {
    if (!row.declaration_id) return;
    try {
      setVerifying(true);
      await onVerify(row.declaration_id);
      onUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setVerifying(false);
    }
  };

  const handleDownload = async () => {
    if (!fileUrl) return;
    try {
      setDownloading(true);
      await downloadRemoteFile(fileUrl, fileName);
    } catch (err) {
      console.error(err);
    } finally {
      setDownloading(false);
    }
  };

  const handleStatusConfirm = async (next: 'sin_clave' | 'no_corresponde') => {
    try {
      setStatusSaving(true);
      await onSetStatus(row.company_id, row.declaration_id, next);
      setStatusModalOpen(false);
      onUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setStatusSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2 min-w-[8rem]">
        <div className="flex flex-wrap items-center gap-1">
          {showStatusEdit ? (
            <button
              type="button"
              onClick={() => setStatusModalOpen(true)}
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:ring-2 hover:ring-primary-300 ${detraccionesStatusBadgeClass(status)}`}
              title="Cambiar estado (supervisor)"
            >
              {detraccionesStatusLabel(status)}
              <i className="fas fa-pen ml-1 text-[9px] opacity-70" aria-hidden />
            </button>
          ) : (
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${detraccionesStatusBadgeClass(status)}`}
            >
              {detraccionesStatusLabel(status)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {fileUrl ? (
            <>
              <button
                type="button"
                onClick={() => setPreview({ url: fileUrl, fileName })}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-primary-700 hover:underline"
                title="Ver PDF"
              >
                <i className="fas fa-eye" aria-hidden />
                Ver
              </button>
              <button
                type="button"
                disabled={downloading}
                onClick={() => void handleDownload()}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 hover:underline disabled:opacity-50"
                title="Descargar PDF"
              >
                <i className="fas fa-download" aria-hidden />
                {downloading ? '…' : 'Descargar'}
              </button>
            </>
          ) : null}
          {showUpload ? (
            <>
              <button
                type="button"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-primary-700 hover:underline disabled:opacity-50"
                title={fileUrl ? 'Reemplazar PDF' : 'Subir PDF'}
              >
                <i className="fas fa-upload" aria-hidden />
                {uploading ? 'Subiendo…' : fileUrl ? 'Reemplazar' : 'Cargar'}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => void handleFile(e)}
              />
            </>
          ) : null}
          {showVerify ? (
            <button
              type="button"
              disabled={verifying}
              onClick={() => void handleVerify()}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 hover:underline disabled:opacity-50"
              title="Marcar como verificado"
            >
              <i className="fas fa-check" aria-hidden />
              {verifying ? '…' : 'Verificar'}
            </button>
          ) : null}
        </div>
      </div>

      {preview ? (
        <FilePreviewModal
          open
          url={preview.url}
          title={preview.fileName}
          onClose={() => setPreview(null)}
          onDownload={() => void handleDownload()}
        />
      ) : null}

      <DetraccionesStatusModal
        open={statusModalOpen}
        companyName={row.business_name}
        currentStatus={status}
        saving={statusSaving}
        onClose={() => setStatusModalOpen(false)}
        onConfirm={(s) => void handleStatusConfirm(s)}
      />
    </>
  );
};

export default DetraccionesRowActions;
