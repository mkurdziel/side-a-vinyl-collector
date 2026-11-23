import { useRef, useState } from 'react';
import api, { ApiError, type BackupManifest, type BackupOutcome } from '../services/api';
import { ModalDialog } from './ModalDialog';

interface SettingsModalProps {
  onClose: () => void;
  onRestore: () => void;
  restoreBlocked: boolean;
}

type Review = { file: File; manifest: BackupManifest };

const secondary = 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60';

export function SettingsModal({ onClose, onRestore, restoreBlocked }: SettingsModalProps) {
  const [busy, setBusy] = useState<'preview' | 'restore' | 'export' | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [outcome, setOutcome] = useState<BackupOutcome | null>(null);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const operation = useRef(false);

  const close = () => {
    if (!operation.current) onClose();
  };

  const exportBackup = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy('export');
    setError('');
    setDownloaded(false);
    try {
      const { blob, filename } = await api.exportBackup();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloaded(true);
    } catch {
      setError('Could not download the backup. Try again.');
    } finally {
      operation.current = false;
      setBusy(null);
    }
  };

  const chooseFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || operation.current) return;
    operation.current = true;
    setBusy('preview');
    setReview(null);
    setOutcome(null);
    setError('');
    try {
      setReview({ file, manifest: await api.previewBackup(file) });
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status < 500 ? failure.message : 'Could not review the backup. Try choosing the file again.');
    } finally {
      operation.current = false;
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!review || operation.current || restoreBlocked) return;
    operation.current = true;
    setBusy('restore');
    setError('');
    setDownloaded(false);
    try {
      setOutcome(await api.restoreBackup(review.file));
      setReview(null);
      onRestore();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status < 500 ? failure.message : 'Could not verify the restore outcome. Check your library before trying again.');
    } finally {
      operation.current = false;
      setBusy(null);
    }
  };

  return (
    <ModalDialog labelledBy="settings-title" onClose={close}>
      <div className="rh-dialog-panel max-w-xl">
        <header className="rh-dialog-header flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 id="settings-title" className="text-xl font-bold">Library settings</h2>
          <button type="button" className={secondary} onClick={close} disabled={!!busy}>Close</button>
        </header>

        <div className="space-y-5 p-4 sm:p-6">
          <section aria-labelledby="backup-title">
            <h3 id="backup-title" className="font-semibold">Export backup</h3>
            <p className="mt-1 text-sm text-gray-600">Download a ZIP of your shelves, notes, barcode mappings, album data and locally available artwork.</p>
            <button type="button" className={`mt-3 ${secondary}`} onClick={exportBackup} disabled={!!busy}>
              {busy === 'export' ? 'Preparing backup…' : 'Download current backup'}
            </button>
            {downloaded && <p className="mt-2 text-sm text-gray-600" role="status">Backup download started.</p>}
          </section>

          <section className="border-t border-gray-200 pt-5" aria-labelledby="restore-title">
            <h3 id="restore-title" className="font-semibold">Restore from a backup</h3>
            <p className="mt-1 text-sm text-gray-600">Choose a ZIP to review it first. Restoring replaces your current shelves, notes and barcode mappings.</p>
            <label className="mt-3 block text-sm font-medium">
              Backup ZIP
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={chooseFile}
                disabled={!!busy}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-gray-300 p-2 text-sm"
              />
            </label>

            {busy === 'preview' && <p role="status" className="mt-3 text-sm">Reading backup…</p>}
            {review && (
              <div className="mt-4 space-y-3 rounded-xl border border-gray-300 p-3 sm:p-4">
                <div>
                  <h4 className="font-semibold [overflow-wrap:anywhere]">{review.file.name}</h4>
                  <p className="text-sm text-gray-600">
                    {review.manifest.timestamp
                      ? `Exported ${new Date(review.manifest.timestamp).toLocaleString()}`
                      : 'Export date unavailable'}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  {[
                    ['Collection', review.manifest.collection],
                    ['Wishlist', review.manifest.wishlist],
                    ['Barcode mappings', review.manifest.barcodes],
                    ['Artwork available', review.manifest.artwork],
                  ].map(([label, count]) => (
                    <div key={label} className="flex items-baseline justify-between gap-2">
                      <dt>{label}</dt><dd className="font-semibold tabular-nums">{count}</dd>
                    </div>
                  ))}
                </dl>
                {review.manifest.warnings.map(warning => <p key={warning} className="text-sm text-red-600">{warning}</p>)}
                <p className="text-sm font-semibold">This replaces the current library. Download a current backup first if you want to keep a copy.</p>
                {restoreBlocked && <p className="text-sm" role="status">Wait for the Discogs import to finish before restoring.</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setReview(null); setError(''); }} className={secondary} disabled={!!busy}>Cancel restore</button>
                  <button type="button" onClick={restore} disabled={!!busy || restoreBlocked} aria-busy={busy === 'restore'}
                    className="rh-filled-action min-h-11 rounded-lg bg-red-600 px-3 text-sm font-semibold disabled:opacity-60">
                    {busy === 'restore' ? 'Restoring…' : 'Replace library with this backup'}
                  </button>
                </div>
              </div>
            )}
            {outcome && (
              <div role="status" className="mt-4 space-y-2 rounded-xl border border-gray-300 p-3 text-sm">
                <h4 className="font-semibold">{outcome.message}</h4>
                <ul className="space-y-1">
                  <li>Albums restored · {outcome.stats.albums}</li>
                  <li>Barcode mappings restored · {outcome.stats.barcodes}</li>
                  <li>Artwork files restored · {outcome.stats.artwork}</li>
                </ul>
                {outcome.warnings.map(warning => <p key={warning}>{warning}</p>)}
                {outcome.skippedArtwork.length > 0 && (
                  <details>
                    <summary className="cursor-pointer font-medium">Artwork files skipped · {outcome.skippedArtwork.length}</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {outcome.skippedArtwork.map(({ album, reason }, index) => <li key={index} className="[overflow-wrap:anywhere]">{album} · {reason}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </section>
          {!!error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </ModalDialog>
  );
}
