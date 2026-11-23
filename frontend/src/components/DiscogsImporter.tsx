import { useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog';
import api, { ApiError, type Album, type DiscogsAlbum } from '../services/api';

type Shelf = Album['status'];
type ImportJob = { album: DiscogsAlbum; destination: Shelf };
type ImportOutcome = Pick<ImportJob, 'destination'> & { status: 'imported' | 'skipped' | 'failed' };
type ImportProgress = Pick<ImportJob, 'destination'> & { albumId: number; current: number; total: number };

const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };
const primaryAction = 'rh-filled-action rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50';
const secondaryAction = 'rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50';

interface DiscogsImporterProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  viewMode: Shelf;
}

export const DiscogsImporter = ({ open, onClose, onSuccess, viewMode }: DiscogsImporterProps) => {
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'connection-error'>('idle');
  const [albums, setAlbums] = useState<DiscogsAlbum[]>([]);
  const [outcomes, setOutcomes] = useState<Partial<Record<number, ImportOutcome>>>({});
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const operationInProgress = useRef(false);
  const busy = fetchStatus === 'loading' || progress !== null;

  const fetchCollection = async () => {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    setFetchStatus('loading');
    try {
      const result = await api.importDiscogsCollection();
      setAlbums(previous => {
        const rows = new Map<number, DiscogsAlbum>();
        for (const album of previous) {
          if (outcomes[album.discogsId]) rows.set(album.discogsId, album);
        }
        for (const album of result.albums) rows.set(album.discogsId, album);
        return [...rows.values()];
      });
      setFetchStatus('ready');
    } catch (error) {
      setFetchStatus(error instanceof ApiError && error.status === 400 ? 'connection-error' : 'error');
    } finally {
      operationInProgress.current = false;
    }
  };

  const importRecords = async (jobs: ImportJob[]) => {
    if (operationInProgress.current || jobs.length === 0) return;
    operationInProgress.current = true;
    let refreshLibrary = false;
    try {
      for (const [index, { album, destination }] of jobs.entries()) {
        const albumId = album.discogsId;
        setProgress({ albumId, destination, current: index + 1, total: jobs.length });
        let status: ImportOutcome['status'];
        try {
          await api.addAlbum({
            artist: album.artist,
            album: album.album,
            year: album.year,
            coverImageUrl: album.coverImageUrl,
            discogsId: albumId,
            status: destination,
          });
          status = 'imported';
          refreshLibrary = true;
        } catch (error) {
          status = error instanceof ApiError && error.status === 409 ? 'skipped' : 'failed';
          if (status === 'skipped') refreshLibrary = true;
        }
        setOutcomes(previous => ({ ...previous, [albumId]: { destination, status } }));
      }
    } finally {
      operationInProgress.current = false;
      setProgress(null);
      if (refreshLibrary) onSuccess();
    }
  };

  if (!open) return null;

  const remaining = albums.filter(album => !outcomes[album.discogsId]);
  const retryJobs = albums.flatMap(album => {
    const outcome = outcomes[album.discogsId];
    return outcome?.status === 'failed' ? [{ album, destination: outcome.destination }] : [];
  });
  const imported = Object.values(outcomes).filter(outcome => outcome?.status === 'imported').length;
  const skipped = Object.values(outcomes).filter(outcome => outcome?.status === 'skipped').length;
  const summary = [
    imported ? `${imported} imported` : null,
    skipped ? `${skipped} already in your library` : null,
    retryJobs.length ? `${retryJobs.length} failed` : null,
  ].filter(Boolean).join(' · ');
  const destination = shelfNames[viewMode];

  return (
    <ModalDialog labelledBy="discogs-import-title" onClose={onClose}>
      <div className="rh-dialog-panel max-w-6xl">
        <div className="rh-dialog-header flex items-center justify-between gap-3 border-b border-gray-200 p-4 sm:p-6">
          <h2 id="discogs-import-title" className="text-xl font-bold text-gray-900">Import from Discogs</h2>
          <button type="button" onClick={onClose} className="rh-dialog-close" aria-label="Close Discogs import">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          {(fetchStatus === 'error' || fetchStatus === 'connection-error') && (
            <p className="text-sm text-red-600" role="alert">
              {fetchStatus === 'connection-error'
                ? 'The server could not verify your Discogs account. Ask your server administrator to check the connection.'
                : 'Could not load your Discogs collection. Try loading it again.'}
            </p>
          )}

          {albums.length === 0 ? (
            <div className="py-8 text-center sm:py-12">
              <p className="mb-2 text-lg font-medium text-gray-900" role="status">
                {fetchStatus === 'loading' ? 'Loading your Discogs collection…'
                  : fetchStatus === 'ready' ? 'No new records to import'
                  : 'Review your Discogs collection'}
              </p>
              <p className="mb-5 text-sm text-gray-600">
                {fetchStatus === 'ready'
                  ? 'Records already in your library are excluded.'
                  : `Load records and choose which ones to import to ${destination}.`}
              </p>
              <button type="button" className={primaryAction} onClick={fetchCollection} disabled={busy}>
                {fetchStatus === 'idle' ? 'Load Discogs collection'
                  : fetchStatus === 'loading' ? 'Loading…'
                  : 'Reload Discogs collection'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex-1 basis-52 space-y-1">
                  <p className="text-sm font-medium text-gray-900" role="status">
                    {progress
                      ? `Importing ${progress.current} of ${progress.total} to ${shelfNames[progress.destination]}…`
                      : fetchStatus === 'loading'
                        ? 'Refreshing Discogs collection…'
                        : summary || `${remaining.length} ${remaining.length === 1 ? 'record' : 'records'} available`}
                  </p>
                  <p className="text-sm text-gray-600">
                    {progress ? 'The import continues if you close this window.' : `New imports go to ${destination}.`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {remaining.length > 0 && (
                    <button
                      type="button"
                      className={primaryAction}
                      onClick={() => importRecords(remaining.map(album => ({ album, destination: viewMode })))}
                      disabled={busy}
                    >
                      {summary ? 'Import remaining' : 'Import all'}
                    </button>
                  )}
                  {retryJobs.length > 0 && (
                    <button type="button" className={secondaryAction} onClick={() => importRecords(retryJobs)} disabled={busy}>
                      Retry failed ({retryJobs.length})
                    </button>
                  )}
                  <button type="button" className={secondaryAction} onClick={fetchCollection} disabled={busy}>
                    Refresh list
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {albums.map(album => {
                  const outcome = outcomes[album.discogsId];
                  const isImporting = progress?.albumId === album.discogsId;
                  const isRetry = outcome?.status === 'failed';

                  return (
                    <article key={album.discogsId} className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white">
                      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-t-xl bg-gray-50">
                        {album.coverImageUrl ? (
                          <img src={album.coverImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0 space-y-1 p-3">
                        <h3 className="break-words text-sm font-semibold text-gray-900">{album.album}</h3>
                        <p className="break-words text-xs text-gray-600">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
                      </div>
                      <div className="mt-auto px-3 pb-3">
                        {outcome?.status === 'imported' ? (
                          <p className="break-words text-sm font-medium text-green-600">Imported to {shelfNames[outcome.destination]}</p>
                        ) : outcome?.status === 'skipped' ? (
                          <p className="break-words text-sm text-gray-600">Already in your library</p>
                        ) : (
                          <>
                            {isRetry && <p className="mb-2 break-words text-sm text-red-600">Import to {shelfNames[outcome.destination]} failed</p>}
                            <button
                              type="button"
                              className={`w-full ${isRetry ? secondaryAction : primaryAction}`}
                              onClick={() => importRecords([{ album, destination: outcome?.destination ?? viewMode }])}
                              disabled={busy}
                              aria-label={`${isRetry ? 'Retry import of' : 'Import'} ${album.album}`}
                            >
                              {isImporting ? 'Importing…' : isRetry ? 'Retry' : 'Import'}
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </ModalDialog>
  );
};
