import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import api, { ApiError, type DiscogsAlbum, type DiscogsCollectionPage } from '../services/api';
import {
  entryFor, getImportLibrary, importTitleKey, needsImportCheck, readDiscogsImport, reconcileImport, writeDiscogsImport,
  type ImportEntry,
} from '../services/discogsImportSession';
import { ModalDialog } from './ModalDialog';
import { SaveShelfSelect } from './SaveDestinationActions';

type Shelf = 'collection' | 'wishlist';
type ImportProgress = { albumId: number; destination: Shelf; current: number; total: number };
type ListStatus = 'idle' | 'loading' | 'ready' | 'error' | 'connection-error';
type Recovery = 'idle' | 'checking' | 'ready' | 'error';

const shelves: Shelf[] = ['collection', 'wishlist'];
const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };
const primaryAction = 'rh-primary-action px-3 text-sm font-semibold disabled:opacity-60';
const secondaryAction = 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-55';
const titleKey = ({ artist, album }: Pick<DiscogsAlbum, 'artist' | 'album'>) => importTitleKey(artist, album);
const requestTimeout = 30_000;

function ImportRowOutcome({ entry, retry, disabled }: { entry: ImportEntry; retry: () => void; disabled: boolean }) {
  const shelf = shelfNames[entry.destination];
  switch (entry.status) {
    case 'imported':
      return <p className="text-sm font-medium text-green-600">Imported to {shelf}</p>;
    case 'found':
      return <p className="text-sm font-medium text-green-600">Found in {shelf} after checking your shelves</p>;
    case 'skipped':
      return <p className="text-sm text-gray-600">Already in {entry.savedShelf ? shelfNames[entry.savedShelf] : 'your library'}</p>;
    case 'failed':
      return <>
        <p className="mb-2 text-sm text-red-600">Import to {shelf} failed</p>
        <button type="button" className={`w-full ${secondaryAction}`} onClick={retry} disabled={disabled}
          aria-label={`Retry import of ${entry.album.album}`}>Retry</button>
      </>;
    case 'sending':
      return <p className="text-sm text-gray-600">Checking whether this record was saved to {shelf}</p>;
    case 'pending':
      return <p className="text-sm text-gray-600">Queued for {shelf}</p>;
  }
}

interface DiscogsImporterProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSuccess: () => void;
  onImportingChange: (importing: boolean) => void;
  viewMode: Shelf;
}

export const DiscogsImporter = ({ open, onOpen, onClose, onSuccess, onImportingChange, viewMode }: DiscogsImporterProps) => {
  const [fetchStatus, setFetchStatus] = useState<ListStatus>('idle');
  const [fetchPage, setFetchPage] = useState(1);
  const [pagination, setPagination] = useState<Omit<DiscogsCollectionPage, 'albums' | 'count'>>();
  const [loadedPages, setLoadedPages] = useState(new Map<number, DiscogsAlbum[]>());
  const catalog = useMemo(() => [...new Map([...loadedPages.values()].flat()
    .map(album => [album.discogsId, album])).values()], [loadedPages]);
  const [entries, setEntries] = useState(readDiscogsImport);
  const journal = useRef(entries);
  const [initialRecovery] = useState(() => entries.some(needsImportCheck));
  const [recovery, setRecovery] = useState<Recovery>(initialRecovery ? 'checking' : 'idle');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set<number>());
  const [chosenShelf, setChosenShelf] = useState<Shelf>();
  const [showBackgroundStatus, setShowBackgroundStatus] = useState(initialRecovery);
  const [storageFailed, setStorageFailed] = useState(false);
  const operationInProgress = useRef(false);
  const stopRequested = useRef(false);
  const busy = fetchStatus === 'loading' || progress !== null || recovery === 'checking';

  const remember = (next: ImportEntry[]) => {
    journal.current = next;
    setEntries(next);
    setStorageFailed(!writeDiscogsImport(next));
  };

  const rememberEntry = (entry: ImportEntry) => {
    remember(journal.current.map(previous => previous.album.discogsId === entry.album.discogsId ? entry : previous));
  };

  const recover = async (cancel?: AbortSignal) => {
    const timeout = AbortSignal.timeout(requestTimeout);
    const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
    try {
      const library = await getImportLibrary(signal);
      if (cancel?.aborted) return false;
      const checked = journal.current.map(entry => reconcileImport(entry, library));
      if (checked.some((entry, index) => entry !== journal.current[index] && (entry.status === 'found' || entry.status === 'skipped'))) {
        onSuccess();
      }
      remember(checked);
      setRecovery('ready');
      return true;
    } catch {
      if (!cancel?.aborted) setRecovery('error');
      return false;
    }
  };

  const recoverOnMount = useEffectEvent((signal: AbortSignal) => recover(signal));

  useEffect(() => {
    if (!initialRecovery) return;
    const controller = new AbortController();
    void recoverOnMount(controller.signal);
    return () => controller.abort();
  }, [initialRecovery]);

  const fetchCollection = async (page = 1) => {
    if (operationInProgress.current || recovery === 'checking') return;
    operationInProgress.current = true;
    setFetchPage(page);
    setFetchStatus('loading');
    try {
      const result = await api.importDiscogsCollection(page);
      setLoadedPages(previous => {
        const incomingIds = new Set(result.albums.map(album => album.discogsId));
        const keptSelection = (previous.get(page) ?? [])
          .filter(album => selectedIds.has(album.discogsId) && !incomingIds.has(album.discogsId));
        return new Map(previous).set(page, [...result.albums, ...keptSelection]);
      });
      setPagination(previous => {
        const loaded = Math.max(previous?.page ?? 1, result.page);
        return { page: loaded, totalPages: result.totalPages, nextPage: loaded > result.page
          ? (loaded < result.totalPages ? loaded + 1 : undefined) : result.nextPage };
      });
      setFetchStatus('ready');
    } catch (error) {
      setFetchStatus(error instanceof ApiError && error.status === 400 ? 'connection-error' : 'error');
    } finally {
      operationInProgress.current = false;
    }
  };

  const importRecords = async (jobs: ImportEntry[], verify = false) => {
    if (operationInProgress.current || recovery === 'checking' || recovery === 'error' || !jobs.length) return;
    operationInProgress.current = true;
    onImportingChange(true);
    stopRequested.current = false;
    setStopped(false);
    const ids = new Set(jobs.map(entry => entry.album.discogsId));
    let refreshLibrary = false;
    try {
      if (verify) {
        setRecovery('checking');
        if (!await recover()) return;
        jobs = journal.current.filter(entry => ids.has(entry.album.discogsId) && needsImportCheck(entry));
      }

      // Record the exact pressing and destination before the first request for this batch.
      const queue = jobs.map((entry): ImportEntry => ({ ...entry, status: 'pending' }));
      remember([...journal.current.filter(entry => !ids.has(entry.album.discogsId) || !needsImportCheck(entry)), ...queue]);
      setSelectedIds(previous => new Set([...previous].filter(id => !ids.has(id))));

      for (const [index, entry] of queue.entries()) {
        if (stopRequested.current) {
          setStopped(true);
          break;
        }
        const { album, destination } = entry;
        const sending: ImportEntry = { ...entry, status: 'sending' };
        setProgress({ albumId: album.discogsId, destination, current: index + 1, total: queue.length });
        rememberEntry(sending);
        try {
          await api.addAlbum({
            artist: album.artist,
            album: album.album,
            year: album.year,
            coverImageUrl: album.coverImageUrl,
            discogsId: album.discogsId,
            applyCatalogReference: true,
            status: destination,
          }, AbortSignal.timeout(requestTimeout));
          rememberEntry({ ...entry, status: 'imported' });
          refreshLibrary = true;
        } catch (error) {
          if (error instanceof ApiError && error.status < 500) {
            rememberEntry({ ...entry, status: error.status === 409 ? 'skipped' : 'failed' });
            refreshLibrary ||= error.status === 409;
          } else {
            // An interrupted response can come after the server has already saved the record.
            try {
              const library = await getImportLibrary(AbortSignal.timeout(requestTimeout));
              const checked = reconcileImport(sending, library);
              rememberEntry(checked.status === 'pending' ? { ...entry, status: 'failed' } : checked);
              refreshLibrary ||= checked.status === 'found' || checked.status === 'skipped';
            } catch {
              setRecovery('error');
              break;
            }
          }
        }
      }
    } finally {
      operationInProgress.current = false;
      setProgress(null);
      setStopping(false);
      onImportingChange(false);
      if (refreshLibrary) onSuccess();
    }
  };

  const outcomes = new Map(entries.map(entry => [entry.album.discogsId, entry]));
  const processedTitles = new Set(entries.map(entry => titleKey(entry.album)));
  const remaining = catalog.filter(album => !processedTitles.has(titleKey(album)));
  const selected = remaining.filter(album => selectedIds.has(album.discogsId));
  const titleCounts = new Map<string, number>();
  for (const album of catalog) {
    const title = titleKey(album);
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const allEligible = remaining.filter(album => titleCounts.get(titleKey(album)) === 1);
  const hasUnselectedEligible = allEligible.some(album => !selectedIds.has(album.discogsId));
  const eligibleTitleCount = new Set(remaining.map(titleKey)).size;
  const retryJobs = entries.filter(entry => entry.status === 'failed');
  const resumeJobs = entries.filter(entry => entry.status === 'pending' || entry.status === 'sending');
  const visibleAlbums = new Map(entries.map(entry => [entry.album.discogsId, entry.album]));
  for (const album of catalog) visibleAlbums.set(album.discogsId, album);
  const countsByShelf = (status: 'imported' | 'found' | 'failed') => shelves.flatMap(shelf => {
    const count = entries.filter(entry => entry.status === status && entry.destination === shelf).length;
    const description = status === 'found' ? 'found in' : status === 'imported' ? 'imported to' : 'failed to import to';
    return count ? [`${count} ${description} ${shelfNames[shelf]}`] : [];
  });
  const skipped = entries.filter(entry => entry.status === 'skipped').length;
  const summary = [
    ...countsByShelf('imported'),
    ...countsByShelf('found'),
    ...(skipped ? [`${skipped} already in your library`] : []),
    ...countsByShelf('failed'),
  ].join(' · ');
  const destination = chosenShelf ?? viewMode;
  const progressText = progress ? `Importing ${progress.current} of ${progress.total} to ${shelfNames[progress.destination]}…` : null;
  const recoveryText = recovery === 'checking' ? 'Checking your shelves for this import…'
    : recovery === 'error' ? 'Could not check which records were saved. Check your shelves again to continue.'
      : initialRecovery && resumeJobs.length > 0 ? 'An import was interrupted. Outcomes found on your shelves are shown below.'
        : initialRecovery && summary ? 'Checked both shelves. Your import outcomes are below.' : null;

  const chooseAlbum = (album: Pick<DiscogsAlbum, 'discogsId' | 'artist' | 'album'>, checked: boolean) => {
    setChosenShelf(current => current ?? destination);
    setSelectedIds(previous => {
      const next = new Set(previous);
      for (const candidate of remaining) {
        if (titleKey(candidate) === titleKey(album)) next.delete(candidate.discogsId);
      }
      if (checked) next.add(album.discogsId);
      return next;
    });
  };

  const close = () => {
    setShowBackgroundStatus(progress !== null || resumeJobs.length > 0 || recovery === 'checking' || recovery === 'error');
    if (!progress && !selected.length) setChosenShelf(undefined);
    onClose();
  };

  if (!open) {
    if (!showBackgroundStatus) return null;
    return (
      <aside className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-300 bg-white p-3" aria-label="Discogs import status">
        <p className="min-w-0 flex-1 basis-44 text-sm font-medium" role="status">
          {progressText ?? (recovery === 'checking' ? 'Checking your shelves for an interrupted Discogs import…'
            : resumeJobs.length ? 'Discogs import has records to review'
              : stopped ? 'Discogs import stopped' : 'Discogs import finished')}
          {!progress && summary ? ` · ${summary}` : ''}
        </p>
        <button type="button" className={secondaryAction} onClick={onOpen}>Reopen Discogs import</button>
        {!progress && recovery !== 'checking' && (
          <button type="button" className="min-h-11 px-2 text-sm text-gray-600" onClick={() => setShowBackgroundStatus(false)}>Dismiss</button>
        )}
      </aside>
    );
  }

  const fetchFailed = fetchStatus === 'error' || fetchStatus === 'connection-error';
  const hasCatalog = !!pagination;
  const morePage = pagination?.nextPage;
  return (
    <ModalDialog labelledBy="discogs-import-title" onClose={close}>
      <div className="rh-dialog-panel max-w-6xl">
        <div className="rh-dialog-header flex items-center justify-between gap-3 border-b border-gray-200 p-4 sm:p-6">
          <h2 id="discogs-import-title" className="text-xl font-bold text-gray-900">Import from Discogs</h2>
          <button type="button" onClick={close} className="rh-dialog-close" aria-label="Close Discogs import">
            <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-4 sm:p-6">
          {(summary || progressText) && <p className="text-sm font-medium text-gray-900" role="status">{progressText ?? summary}</p>}
          {(stopping || progress || stopped) && <p className="text-sm text-gray-600" role="status">
            {stopping ? 'The current record will finish, then the import will stop.'
              : progress ? 'The import continues if you close this window.'
                : 'Import stopped. The outcomes below are kept.'}
          </p>}
          {storageFailed && <p role="status" className="text-sm text-gray-600">This tab cannot keep import progress after a reload.</p>}
          {recoveryText && <p role={recovery === 'error' ? 'alert' : 'status'} className="text-sm text-gray-600">{recoveryText}</p>}
          {fetchFailed && (
            <p className="text-sm text-red-600" role="alert">
              {fetchStatus === 'connection-error'
                ? 'The server could not verify your Discogs account. Ask your server administrator to check the connection.'
                : fetchPage > 1 ? `Could not load Discogs page ${fetchPage}. Your existing selection is kept.`
                  : 'Could not load your Discogs collection. Try loading it again.'}
            </p>
          )}

          {!hasCatalog ? (
            <div className={entries.length ? 'space-y-2' : 'py-8 text-center sm:py-12'}>
              <p className="text-sm font-medium text-gray-900" role="status">
                {fetchStatus === 'loading' ? 'Loading your Discogs collection…' : 'Review your Discogs collection'}
              </p>
              <p className="mb-3 text-sm text-gray-600">Load records, then choose a shelf and the albums to import.</p>
              <button type="button" className={primaryAction} onClick={() => void fetchCollection()} disabled={busy}>
                {fetchStatus === 'idle' ? 'Load Discogs collection' : fetchStatus === 'loading' ? 'Loading…' : 'Reload Discogs collection'}
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium" role="status">
                {remaining.length
                  ? `${remaining.length} ${remaining.length === 1 ? 'record' : 'records'} available${morePage ? ' on loaded pages' : ''}`
                  : morePage ? 'No new records on the pages loaded so far.'
                    : entries.length ? 'No additional records to import.' : 'No new records to import.'}
              </p>
              {eligibleTitleCount < remaining.length && <p className="text-sm text-gray-600">
                Choose one pressing per album. Choosing a different pressing replaces your selection. Select all skips these albums.
              </p>}
            </div>
          )}

          {(remaining.length > 0 || retryJobs.length > 0 || resumeJobs.length > 0 || recovery === 'error' ||
            (progress && progress.current < progress.total)) && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {recovery === 'error' && <button type="button" className={secondaryAction} onClick={() => {
                setRecovery('checking');
                void recover();
              }}>Check shelves again</button>}
              {!progress && resumeJobs.length > 0 && recovery !== 'error' && (
                <div className="grid w-full justify-items-start gap-2">
                  <p className="text-sm text-gray-600">
                    {shelves.flatMap(shelf => {
                      const count = resumeJobs.filter(entry => entry.destination === shelf).length;
                      return count ? [`${count} to ${shelfNames[shelf]}`] : [];
                    }).join(' · ')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={primaryAction} disabled={busy}
                      onClick={() => void importRecords(resumeJobs, true)}>Resume remaining ({resumeJobs.length})</button>
                    <button type="button" className={secondaryAction} disabled={busy}
                      onClick={() => remember(journal.current.filter(entry => entry.status !== 'pending'))}>Cancel remaining</button>
                  </div>
                </div>
              )}
              {remaining.length > 0 && (
                <>
                  <SaveShelfSelect value={progress?.destination ?? destination} disabled={busy || resumeJobs.length > 0}
                    onChange={shelf => { if (!operationInProgress.current) setChosenShelf(shelf); }} />
                  {(hasUnselectedEligible || selected.length > 0) && (
                    <button type="button" className={secondaryAction} disabled={busy} onClick={() => {
                      setChosenShelf(current => current ?? destination);
                      setSelectedIds(previous => hasUnselectedEligible
                        ? new Set([...previous, ...allEligible.map(album => album.discogsId)]) : new Set());
                    }}>
                      {hasUnselectedEligible ? `Select all${morePage ? ' loaded' : ''} (${allEligible.length})` : 'Clear selection'}
                    </button>
                  )}
                  <button type="button" className={primaryAction} disabled={busy || !selected.length || resumeJobs.length > 0 || recovery === 'error'}
                    onClick={() => void importRecords(selected.map(album => entryFor(album, destination)))}>
                    {selected.length
                      ? `Import ${selected.length} ${selected.length === 1 ? 'record' : 'records'} to ${shelfNames[progress?.destination ?? destination]}`
                      : 'Import selected records'}
                  </button>
                </>
              )}
              {retryJobs.length > 0 && (
                <button type="button" className={secondaryAction} disabled={busy || resumeJobs.length > 0 || recovery === 'error'}
                  onClick={() => void importRecords(retryJobs, true)}>Retry failed ({retryJobs.length})</button>
              )}
              {progress && progress.current < progress.total && (
                <button type="button" className={secondaryAction} disabled={stopping} onClick={() => {
                  stopRequested.current = true;
                  setStopping(true);
                }}>{stopping ? 'Stopping…' : 'Stop after current record'}</button>
              )}
            </div>
          )}

          {visibleAlbums.size > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[...visibleAlbums.values()].map(album => {
              const entry = outcomes.get(album.discogsId);
              const isImporting = progress?.albumId === album.discogsId;
              const multiple = (titleCounts.get(titleKey(album)) ?? 0) > 1;
              const label = `Select ${album.album} by ${album.artist}${multiple ? ` · Discogs release ${album.discogsId}` : ''}`;
              const facts = [album.pressing?.format, album.pressing?.label, album.pressing?.catalogNumber, album.pressing?.country]
                .filter(Boolean).join(' · ');
              const alternativeProcessed = !entry && processedTitles.has(titleKey(album));
              const selection = <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-medium">
                <input type="checkbox" checked={selectedIds.has(album.discogsId)} disabled={busy}
                  aria-label={label} onChange={event => chooseAlbum(album, event.currentTarget.checked)} />
                {multiple ? 'Choose pressing' : 'Select'}
              </label>;

              return (
                <article key={album.discogsId} className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white">
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-t-xl bg-gray-50">
                    {album.coverImageUrl
                      ? <img src={album.coverImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      : <span className="px-2 text-center text-xs text-gray-600">Cover unavailable</span>}
                  </div>
                  <div className="min-w-0 space-y-1 p-3 [overflow-wrap:anywhere]">
                    <h3 className="text-sm font-semibold text-gray-900">{album.album}</h3>
                    <p className="text-xs text-gray-600">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
                    {facts && <p className="text-xs text-gray-600">{facts}</p>}
                    <a className="rh-comparison-source text-xs" href={`https://www.discogs.com/release/${album.discogsId}`} target="_blank" rel="noreferrer">
                      Discogs {album.discogsId}<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </div>
                  <div className="mt-auto px-3 pb-3 [overflow-wrap:anywhere]">
                    {isImporting && <p className="text-sm font-medium">Importing…</p>}
                    {entry && !isImporting && <ImportRowOutcome entry={entry} retry={() => void importRecords([entry], true)}
                      disabled={busy || resumeJobs.length > 0 || recovery === 'error'} />}
                    {alternativeProcessed && <p className="text-sm text-gray-600">Another pressing of this album is in the import review.</p>}
                    {!entry && !alternativeProcessed && selection}
                  </div>
                </article>
              );
            })}
          </div>}
        </div>

        {hasCatalog && (
          <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t bg-white px-4 py-2 sm:px-6">
            <p className="min-w-0 text-xs text-gray-600" role="status">
              {pagination.totalPages ? `${Math.min(pagination.page, pagination.totalPages)} of ${pagination.totalPages} Discogs pages loaded`
                : 'Discogs collection is empty'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {(morePage || fetchFailed || fetchStatus === 'loading') && (
                <button type="button" className={secondaryAction} disabled={busy}
                  onClick={() => void fetchCollection(fetchFailed ? fetchPage : morePage ?? 1)}>
                  {fetchStatus === 'loading' ? 'Loading…' : fetchFailed ? 'Retry Discogs page' : 'Load more Discogs records'}
                </button>
              )}
              {!fetchFailed && !busy && <button type="button" className="rh-lookup-link" onClick={() => void fetchCollection()}>
                {pagination.page > 1 ? 'Refresh first page' : 'Refresh list'}
              </button>}
            </div>
          </footer>
        )}
      </div>
    </ModalDialog>
  );
};
