import { useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog';
import api, { ApiError, type Album, type DiscogsAlbum } from '../services/api';
import { SaveShelfSelect } from './SaveDestinationActions';

type Shelf = Album['status'];
type ImportJob = { album: DiscogsAlbum; destination: Shelf };
type ImportOutcome = Pick<ImportJob, 'destination'> & { status: 'imported' | 'skipped' | 'failed' };
type ImportProgress = Pick<ImportJob, 'destination'> & { albumId: number; current: number; total: number };

const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };
const shelves: Shelf[] = ['collection', 'wishlist'];
const primaryAction = 'rh-filled-action rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50';
const secondaryAction = 'rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50';

interface DiscogsImporterProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSuccess: () => void;
  onImportingChange: (importing: boolean) => void;
  viewMode: Shelf;
}

export const DiscogsImporter = ({ open, onOpen, onClose, onSuccess, onImportingChange, viewMode }: DiscogsImporterProps) => {
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'connection-error'>('idle');
  const [albums, setAlbums] = useState<DiscogsAlbum[]>([]);
  const [outcomes, setOutcomes] = useState<Partial<Record<number, ImportOutcome>>>({});
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set<number>());
  const [chosenShelf, setChosenShelf] = useState<Shelf>();
  const [showBackgroundStatus, setShowBackgroundStatus] = useState(false);
  const operationInProgress = useRef(false);
  const stopRequested = useRef(false);
  const busy = fetchStatus === 'loading' || progress !== null;

  const fetchCollection = async () => {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    setFetchStatus('loading');
    try {
      const result = await api.importDiscogsCollection();
      const availableIds = new Set(result.albums.map(album => album.discogsId));
      setSelectedIds(previous => new Set([...previous].filter(id => availableIds.has(id))));
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
    onImportingChange(true);
    stopRequested.current = false;
    setStopped(false);
    let refreshLibrary = false;
    try {
      for (const [index, { album, destination }] of jobs.entries()) {
        if (stopRequested.current) {
          setStopped(true);
          break;
        }
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
        setSelectedIds(previous => {
          const next = new Set(previous);
          next.delete(albumId);
          return next;
        });
      }
    } finally {
      operationInProgress.current = false;
      setProgress(null);
      setStopping(false);
      onImportingChange(false);
      if (refreshLibrary) onSuccess();
    }
  };

  const remaining = albums.filter(album => !outcomes[album.discogsId]);
  const selected = remaining.filter(album => selectedIds.has(album.discogsId));
  const retryJobs = albums.flatMap(album => {
    const outcome = outcomes[album.discogsId];
    return outcome?.status === 'failed' ? [{ album, destination: outcome.destination }] : [];
  });
  const results = Object.values(outcomes);
  const countsByShelf = (status: 'imported' | 'failed') => shelves.flatMap(shelf => {
    const count = results.filter(outcome => outcome?.status === status && outcome.destination === shelf).length;
    return count ? [`${count} ${status === 'imported' ? 'imported' : 'failed to import'} to ${shelfNames[shelf]}`] : [];
  });
  const skipped = results.filter(outcome => outcome?.status === 'skipped').length;
  const summary = [
    ...countsByShelf('imported'),
    ...(skipped ? [`${skipped} already in your library`] : []),
    ...countsByShelf('failed'),
  ].join(' · ');
  const destination = chosenShelf ?? viewMode;
  const progressText = progress
    ? `Importing ${progress.current} of ${progress.total} to ${shelfNames[progress.destination]}…`
    : null;
  const close = () => {
    setShowBackgroundStatus(progress !== null);
    if (!progress) setChosenShelf(undefined);
    onClose();
  };

  if (!open) {
    if (!showBackgroundStatus) return null;
    return (
      <aside className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-300 bg-white p-3" aria-label="Discogs import status">
        <p className="min-w-0 flex-1 basis-44 text-sm font-medium" role="status">
          {progressText ?? (stopped ? 'Discogs import stopped' : 'Discogs import finished')}
          {!progress && summary ? ` · ${summary}` : ''}
        </p>
        <button type="button" className={secondaryAction} onClick={onOpen}>Reopen Discogs import</button>
        {!progress && (
          <button type="button" className="min-h-11 px-2 text-sm text-gray-600" onClick={() => setShowBackgroundStatus(false)}>Dismiss</button>
        )}
      </aside>
    );
  }

  return (
    <ModalDialog labelledBy="discogs-import-title" onClose={close}>
      <div className="rh-dialog-panel max-w-6xl">
        <div className="rh-dialog-header flex items-center justify-between gap-3 border-b border-gray-200 p-4 sm:p-6">
          <h2 id="discogs-import-title" className="text-xl font-bold text-gray-900">Import from Discogs</h2>
          <button type="button" onClick={close} className="rh-dialog-close" aria-label="Close Discogs import">
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
                  : 'Load records, then choose a shelf and the albums to import.'}
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
                    {progressText ?? (fetchStatus === 'loading'
                      ? 'Refreshing Discogs collection…'
                      : summary || `${remaining.length} ${remaining.length === 1 ? 'record' : 'records'} available`)}
                  </p>
                  {(stopping || progress || stopped) && <p className="text-sm text-gray-600" role="status">
                    {stopping ? 'The current record will finish, then the import will stop.'
                      : progress ? 'The import continues if you close this window.'
                      : 'Import stopped. The outcomes below are kept.'}
                  </p>}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {remaining.length > 0 && (
                    <>
                      <SaveShelfSelect value={progress?.destination ?? destination} disabled={busy}
                        onChange={shelf => { if (!operationInProgress.current) setChosenShelf(shelf); }} />
                      <button type="button" className={secondaryAction} disabled={busy}
                        onClick={() => setSelectedIds(selected.length === remaining.length
                          ? new Set()
                          : new Set(remaining.map(album => album.discogsId)))}>
                        {selected.length === remaining.length ? 'Clear selection' : `Select all (${remaining.length})`}
                      </button>
                      <button type="button" className={primaryAction} disabled={busy || !selected.length}
                        onClick={() => importRecords(selected.map(album => ({ album, destination })))}>
                        {selected.length
                          ? `Import ${selected.length} ${selected.length === 1 ? 'record' : 'records'} to ${shelfNames[progress?.destination ?? destination]}`
                          : 'Import selected records'}
                      </button>
                    </>
                  )}
                  {retryJobs.length > 0 && (
                    <button type="button" className={secondaryAction} onClick={() => importRecords(retryJobs)} disabled={busy}>
                      Retry failed ({retryJobs.length})
                    </button>
                  )}
                  {progress && progress.current < progress.total && (
                    <button
                      type="button"
                      className={secondaryAction}
                      disabled={stopping}
                      onClick={() => {
                        stopRequested.current = true;
                        setStopping(true);
                      }}
                    >
                      {stopping ? 'Stopping…' : 'Stop after current record'}
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
                            {isRetry ? (
                              <button type="button" className={`w-full ${secondaryAction}`}
                                onClick={() => importRecords([{ album, destination: outcome.destination }])}
                                disabled={busy} aria-label={`Retry import of ${album.album}`}>
                                {isImporting ? 'Importing…' : 'Retry'}
                              </button>
                            ) : (
                              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-medium">
                                <input type="checkbox" checked={selectedIds.has(album.discogsId)} disabled={busy}
                                  aria-label={`Select ${album.album} by ${album.artist}`}
                                  onChange={event => {
                                    const checked = event.currentTarget.checked;
                                    setSelectedIds(previous => {
                                      const next = new Set(previous);
                                      if (checked) next.add(album.discogsId);
                                      else next.delete(album.discogsId);
                                      return next;
                                    });
                                  }} />
                                {isImporting ? 'Importing…' : 'Select'}
                              </label>
                            )}
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
