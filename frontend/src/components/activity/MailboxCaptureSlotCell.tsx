import { useRef, useState, type ChangeEvent } from 'react';
import { resolveBackendUrl } from '../../api/client';
import { downloadRemoteFile } from '../../utils/downloadFile';
import FilePreviewModal from '../FilePreviewModal';
import ClipboardPasteUploadModal from './ClipboardPasteUploadModal';
import {
  mailboxStatusBadgeClass,
  mailboxSideStatusLabel,
  mailboxTypeLabel,
  type MailboxType,
} from './sunatInboxConfig';
import type { SunatInboxCaptureSlot, SunatInboxMailboxSide } from '../../services/sunatInbox';
import {
  formatTimelinessDate,
  formatTimelinessDateCompact,
  timelinessBadgeClass,
  timelinessLabel,
  timelinessRowBorderClass,
} from './timelinessConfig';

type LayoutMode = 'compact' | 'detail';

type MailboxSideCellProps = {
  side: SunatInboxMailboxSide;
  mailboxType: MailboxType;
  canUpload: boolean;
  canVerify: boolean;
  uploading: boolean;
  verifying: boolean;
  downloading: boolean;
  layout: LayoutMode;
  onUpload: (file: File) => Promise<void>;
  onOpenPaste: () => void;
  onVerify: () => Promise<void>;
  onPreview: (url: string, fileName: string) => void;
  onDownload: (url: string, fileName: string) => Promise<void>;
};

function actionBtnClass(layout: LayoutMode, tone: 'primary' | 'neutral' | 'success' = 'primary') {
  const base =
    layout === 'detail'
      ? 'inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50'
      : 'inline-flex items-center gap-1 text-xs font-medium hover:underline disabled:opacity-50 shrink-0';
  if (layout === 'detail') {
    if (tone === 'success') return `${base} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`;
    if (tone === 'neutral') return `${base} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
    return `${base} border-primary-200 bg-primary-50 text-primary-800 hover:bg-primary-100`;
  }
  if (tone === 'success') return `${base} text-emerald-700`;
  if (tone === 'neutral') return `${base} text-slate-600`;
  return `${base} text-primary-700`;
}

const badgeCompact = 'inline-flex items-center justify-center px-1.5 py-0.5 rounded-md font-medium text-[11px] leading-snug whitespace-nowrap';
const compactLabelCol = 'w-[4.5rem] shrink-0 text-xs font-semibold text-slate-800';
const compactStatusCol = 'w-[5.25rem] shrink-0';
const compactTimelinessCol = 'w-[6.75rem] shrink-0';

function CompactMailboxSideCell({
  side,
  mailboxType,
  canUpload,
  canVerify,
  uploading,
  verifying,
  downloading,
  onUpload,
  onOpenPaste,
  onVerify,
  onPreview,
  onDownload,
}: Omit<MailboxSideCellProps, 'layout'>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileName = side.file_name?.trim() || 'Archivo';
  const fileUrl = side.file_url ? resolveBackendUrl(side.file_url) : '';
  const timelinessCode = side.timeliness?.timeliness;
  const showTimeliness = Boolean(timelinessCode);
  const hasDeadline = Boolean(side.timeliness?.due_at);
  const borderClass = showTimeliness ? timelinessRowBorderClass(timelinessCode) : 'border-slate-200';

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await onUpload(file);
  };

  return (
    <div className={`rounded-md border bg-white/90 px-2.5 py-2 w-full min-w-[17.5rem] border-l-4 space-y-1.5 ${borderClass}`}>
      {hasDeadline ? (
        <p className="text-[11px] text-slate-600 tabular-nums leading-snug font-medium" title="Hora límite de carga">
          hasta {formatTimelinessDateCompact(side.timeliness?.due_at)}
        </p>
      ) : null}

      <div className="flex flex-nowrap items-center gap-x-1">
        <span className={compactLabelCol}>{mailboxTypeLabel(mailboxType)}</span>
        <span className={`${badgeCompact} ${compactStatusCol} ${mailboxStatusBadgeClass(side.status)}`}>
          {mailboxSideStatusLabel(side.status)}
        </span>
        {showTimeliness ? (
          <span
            className={`${badgeCompact} ${compactTimelinessCol} ${timelinessBadgeClass(timelinessCode)}`}
            title={hasDeadline ? `Plazo: ${formatTimelinessDate(side.timeliness?.due_at)}` : undefined}
          >
            {timelinessLabel(timelinessCode)}
          </span>
        ) : (
          <span className={compactTimelinessCol} aria-hidden />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0 pt-1 border-t border-slate-100">
        {fileUrl ? (
          <>
            <button type="button" onClick={() => onPreview(fileUrl, fileName)} className={actionBtnClass('compact', 'primary')} title="Ver">
              <i className="fas fa-eye text-[10px]" aria-hidden />
              Ver
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void onDownload(fileUrl, fileName)}
              className={actionBtnClass('compact', 'neutral')}
              title="Descargar"
            >
              <i className="fas fa-download text-[10px]" aria-hidden />
              {downloading ? '…' : 'Descargar'}
            </button>
          </>
        ) : side.status === 'pendiente' ? (
          <span className="text-[11px] text-slate-400">Sin archivo</span>
        ) : (
          <span className="text-[11px] text-amber-700">No disp.</span>
        )}
        {canUpload && side.status !== 'verificado' ? (
          <>
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className={actionBtnClass('compact', 'primary')}
            >
              <i className="fas fa-upload text-[10px]" aria-hidden />
              {uploading ? '…' : 'Subir'}
            </button>
            <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => void handleFile(e)} />
            <button
              type="button"
              disabled={uploading}
              onClick={onOpenPaste}
              className={actionBtnClass('compact', 'neutral')}
              title="Pegar imagen o PDF desde el portapapeles"
            >
              <i className="fas fa-paste text-[10px]" aria-hidden />
              {uploading ? '…' : 'Pegar'}
            </button>
          </>
        ) : null}
        {canVerify && side.status === 'cargado' ? (
          <button
            type="button"
            disabled={verifying}
            onClick={() => void onVerify()}
            className={actionBtnClass('compact', 'success')}
            title="Verificar (supervisor)"
          >
            <i className="fas fa-check text-[10px]" aria-hidden />
            {verifying ? '…' : 'Verificar'}
          </button>
        ) : null}
        {!canVerify && side.status === 'cargado' ? (
          <span className="text-[11px] text-slate-500 shrink-0" title="Pendiente de verificación">
            Pend. verif.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DetailMailboxSideCell(props: MailboxSideCellProps) {
  const {
    side,
    mailboxType,
    canUpload,
    canVerify,
    uploading,
    verifying,
    downloading,
    onUpload,
    onOpenPaste,
    onVerify,
    onPreview,
    onDownload,
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const fileName = side.file_name?.trim() || 'Archivo';
  const fileUrl = side.file_url ? resolveBackendUrl(side.file_url) : '';
  const timelinessCode = side.timeliness?.timeliness;
  const showTimeliness = Boolean(timelinessCode);
  const hasDeadline = Boolean(side.timeliness?.due_at);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await onUpload(file);
  };

  return (
    <div
      className={`rounded border bg-white/80 p-3 min-w-[11rem] space-y-2 ${
        showTimeliness ? timelinessRowBorderClass(timelinessCode) + ' border-l-4' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-700">{mailboxTypeLabel(mailboxType)}</span>
        <span className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium ${mailboxStatusBadgeClass(side.status)}`}>
          {mailboxSideStatusLabel(side.status)}
        </span>
        {showTimeliness ? (
          <span
            className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${timelinessBadgeClass(timelinessCode)}`}
            title={hasDeadline ? `Plazo: ${formatTimelinessDate(side.timeliness?.due_at)}` : undefined}
          >
            {timelinessLabel(timelinessCode)}
          </span>
        ) : null}
        {hasDeadline ? (
          <span className="text-[10px] text-slate-500 tabular-nums ml-auto">≤ {formatTimelinessDate(side.timeliness?.due_at)}</span>
        ) : null}
      </div>

      {side.file_name ? (
        <p className="text-xs text-slate-600 break-all" title={side.file_name}>
          {side.file_name}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {fileUrl ? (
          <>
            <button type="button" onClick={() => onPreview(fileUrl, fileName)} className={actionBtnClass('detail', 'primary')}>
              <i className="fas fa-eye text-[10px]" aria-hidden />
              Ver
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void onDownload(fileUrl, fileName)}
              className={actionBtnClass('detail', 'neutral')}
            >
              <i className="fas fa-download text-[10px]" aria-hidden />
              {downloading ? '…' : 'Descargar'}
            </button>
          </>
        ) : side.status !== 'pendiente' ? (
          <span className="text-xs text-amber-700">Archivo no disponible</span>
        ) : (
          <span className="text-xs text-slate-400">Sin archivo</span>
        )}

        {canUpload && side.status !== 'verificado' ? (
          <>
            <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className={actionBtnClass('detail', 'primary')}>
              <i className="fas fa-upload text-[10px]" aria-hidden />
              {uploading ? 'Subiendo…' : 'Subir'}
            </button>
            <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => void handleFile(e)} />
            <button
              type="button"
              disabled={uploading}
              onClick={onOpenPaste}
              className={actionBtnClass('detail', 'neutral')}
              title="Pegar imagen o PDF desde el portapapeles"
            >
              <i className="fas fa-paste text-[10px]" aria-hidden />
              {uploading ? 'Subiendo…' : 'Pegar'}
            </button>
          </>
        ) : null}

        {canVerify && side.status === 'cargado' ? (
          <button type="button" disabled={verifying} onClick={() => void onVerify()} className={actionBtnClass('detail', 'success')}>
            <i className="fas fa-check text-[10px]" aria-hidden />
            {verifying ? '…' : 'Verificar'}
          </button>
        ) : null}

        {!canVerify && side.status === 'cargado' ? (
          <span className="text-xs text-slate-500">Pend. verificación</span>
        ) : null}
      </div>
    </div>
  );
}

function MailboxSideCell(props: MailboxSideCellProps) {
  if (props.layout === 'compact') {
    return <CompactMailboxSideCell {...props} />;
  }
  return <DetailMailboxSideCell {...props} />;
}

type MailboxCaptureSlotCellProps = {
  slot: SunatInboxCaptureSlot;
  canUpload: boolean;
  canVerify: boolean;
  uploadKey: string;
  layout?: LayoutMode;
  onUpload: (slotIndex: number, mailboxType: MailboxType, file: File) => Promise<void>;
  onVerify: (slotId: number, mailboxType: MailboxType) => Promise<void>;
};

export function MailboxCaptureSlotCell({
  slot,
  canUpload,
  canVerify,
  uploadKey,
  layout = 'compact',
  onUpload,
  onVerify,
}: MailboxCaptureSlotCellProps) {
  const [uploadingType, setUploadingType] = useState<MailboxType | null>(null);
  const [verifyingType, setVerifyingType] = useState<MailboxType | null>(null);
  const [downloadingType, setDownloadingType] = useState<MailboxType | null>(null);
  const [pasteTarget, setPasteTarget] = useState<MailboxType | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [actionError, setActionError] = useState('');

  const handlePreview = (url: string, fileName: string) => {
    setPreview({ url, title: fileName });
  };

  const handleDownload = async (url: string, fileName: string, mailboxType: MailboxType) => {
    try {
      setDownloadError('');
      setDownloadingType(mailboxType);
      await downloadRemoteFile(url, fileName);
    } catch {
      setDownloadError('No se pudo descargar el archivo.');
    } finally {
      setDownloadingType(null);
    }
  };

  const handleUpload = async (mailboxType: MailboxType, file: File) => {
    try {
      setUploadingType(mailboxType);
      await onUpload(slot.slot_index, mailboxType, file);
    } finally {
      setUploadingType(null);
    }
  };

  const handleVerify = async (mailboxType: MailboxType) => {
    if (!slot.id) {
      setActionError('No hay slot registrado. Recargue la página.');
      return;
    }
    try {
      setActionError('');
      setVerifyingType(mailboxType);
      await onVerify(slot.id, mailboxType);
    } finally {
      setVerifyingType(null);
    }
  };

  const sideProps = (mailboxType: MailboxType, side: SunatInboxMailboxSide) => ({
    side,
    mailboxType,
    canUpload,
    canVerify,
    uploading: uploadingType === mailboxType,
    verifying: verifyingType === mailboxType,
    downloading: downloadingType === mailboxType,
    layout,
    onUpload: (file: File) => handleUpload(mailboxType, file),
    onOpenPaste: () => setPasteTarget(mailboxType),
    onVerify: () => handleVerify(mailboxType),
    onPreview: handlePreview,
    onDownload: (url: string, fileName: string) => handleDownload(url, fileName, mailboxType),
  });

  return (
    <>
      <div
        className={layout === 'detail' ? 'space-y-3' : 'grid grid-cols-2 gap-2 w-full min-w-[36.5rem]'}
        key={`${uploadKey}-slot-${slot.slot_index}`}
      >
        {downloadError ? <p className="col-span-2 text-xs text-red-600">{downloadError}</p> : null}
        {actionError ? <p className="col-span-2 text-xs text-red-600">{actionError}</p> : null}
        <MailboxSideCell {...sideProps('sunat', slot.sunat)} />
        <MailboxSideCell {...sideProps('sunafil', slot.sunafil)} />
      </div>
      <ClipboardPasteUploadModal
        open={pasteTarget !== null}
        title={pasteTarget ? `Pegar captura — ${mailboxTypeLabel(pasteTarget)}` : 'Pegar archivo'}
        saving={pasteTarget !== null && uploadingType === pasteTarget}
        onClose={() => setPasteTarget(null)}
        onSave={async (file) => {
          if (!pasteTarget) return;
          await handleUpload(pasteTarget, file);
        }}
      />
      <FilePreviewModal
        open={!!preview}
        url={preview?.url ?? null}
        title={preview?.title}
        onClose={() => setPreview(null)}
        onDownload={
          preview
            ? () => void downloadRemoteFile(preview.url, preview.title).catch(() => setDownloadError('No se pudo descargar.'))
            : undefined
        }
      />
    </>
  );
}

export function MailboxCaptureSlotHeader({ slotIndex, totalSlots = 2 }: { slotIndex: number; totalSlots?: number }) {
  const title = totalSlots === 1 ? 'Carga' : `Carga ${slotIndex}`;
  return (
    <th className="px-2 py-2.5 text-center text-xs font-semibold uppercase text-slate-500 whitespace-nowrap min-w-[36.5rem] w-[36.5rem]">
      {title}
    </th>
  );
}
