import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import api, { ApiError, type DiscogsAlbum, type DiscogsCollectionPage } from '../services/api';
import {
  entryFor, getImportLibrary, importTitleKey, needsImportCheck, readDiscogsImport, readImportReview, reconcileImport,
  reviewChoiceFor, writeDiscogsImport, writeImportReview, type ImportEntry, type ImportReviewChoice, type ImportReviewDraft,
} from '../services/discogsImportSession';
import { ModalDialog } from './ModalDialog';
import { SaveShelfSelect } from './SaveDestinationActions';

type Shelf = 'collection' | 'wishlist';
type ImportProgress = { albumId: number; destination: Shelf; current: number; total: number };
type ListStatus = 'idle' | 'loading' | 'ready' | 'error' | 'connection-error';
type Recovery = 'idle' | 'checking' | 'ready' | 'error';
type CollectionPages = Map<number, DiscogsAlbum[]>;
type ReviewNotice = { choice: ImportReviewChoice; reason: string };

const shelves: Shelf[] = ['collection', 'wishlist'];
const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };
const primaryAction = 'rh-primary-action px-3 text-sm font-semibold disabled:opacity-60';
const secondaryAction = 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-55';
const titleKey = ({ artist, album }: Pick<DiscogsAlbum, 'artist' | 'album'>) => importTitleKey(artist, album);
const requestTimeout = 30_000;

function combinePages(pages: CollectionPages) {
  return [...new Map([...pages.values()].flat().map(album => [album.discogsId, album])).values()];
}

function countPressings(albums: DiscogsAlbum[]) {
  const counts = new Map<string, number>();
  for (const album of albums) {
    const title = titleKey(album);
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return counts;
}

function bulkChoicesToReview(choices: ImportReviewChoice[], titleCounts: Map<string, number>) {
  return choices.filter(choice => choice.source === 'bulk' && (titleCounts.get(titleKey(choice)) ?? 0) > 1);
}

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
  const [loadedPages, setLoadedPages] = useState<CollectionPages>(new Map());
  const catalog = useMemo(() => combinePages(loadedPages), [loadedPages]);
  const titleCounts = useMemo(() => countPressings(catalog), [catalog]);
  const [entries, setEntries] = useState(readDiscogsImport);
  const journal = useRef(entries);
  const [initialRecovery] = useState(() => entries.some(needsImportCheck));
  const [recovery, setRecovery] = useState<Recovery>(initialRecovery ? 'checking' : 'idle');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [draft, setDraft] = useState(readImportReview);
  const reviewDraft = useRef(draft);
  const [previousDestination, setPreviousDestination] = useState<Shelf>();
  const destination = draft?.destination ?? previousDestination ?? viewMode;
  const selectedIds = new Set(draft?.choices.map(choice => choice.discogsId));
  const [reviewNotices, setReviewNotices] = useState<ReviewNotice[]>([]);
  const [restoringPage, setRestoringPage] = useState<number | null>(null);
  const restoring = restoringPage !== null;
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [reviewStorageFailed, setReviewStorageFailed] = useState(false);
  const reviewHeading = useRef<HTMLParagraphElement>(null);
  const focusReview = useRef(false);
  const [showBackgroundStatus, setShowBackgroundStatus] = useState(initialRecovery);
  const [storageFailed, setStorageFailed] = useState(false);
  const operationInProgress = useRef(false);
  const stopRequested = useRef(false);
  const busy = fetchStatus === 'loading' || progress !== null || recovery === 'checking' || restoring;

  useLayoutEffect(() => {
    if (open && focusReview.current && reviewHeading.current) {
      focusReview.current = false;
      reviewHeading.current.focus({ preventScroll: true });
    }
  }, [draft, open, pagination]);

  const rememberDraft = (next: ImportReviewDraft | null, persist = true) => {
    reviewDraft.current = next;
    if (persist) setReviewStorageFailed(!writeImportReview(next));
    setDraft(next);
  };

  const draftForReview = () => reviewDraft.current ?? { choices: [], destination, lastPage: pagination?.page ?? 1 };

  const remember = (next: ImportEntry[]) => {
    journal.current = next;
    setEntries(next);
    const stored = writeDiscogsImport(next);
    setStorageFailed(!stored);
    return stored;
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
      const incomingIds = new Set(result.albums.map(album => album.discogsId));
      const keptSelection = (loadedPages.get(page) ?? [])
        .filter(album => selectedIds.has(album.discogsId) && !incomingIds.has(album.discogsId));
      const pages = new Map(loadedPages).set(page, [...result.albums, ...keptSelection]);
      const loaded = Math.max(pagination?.page ?? 1, result.page);
      const nextPage = loaded < result.totalPages ? loaded + 1 : undefined;
      const currentDraft = draftForReview();
      const needsReview = bulkChoicesToReview(currentDraft.choices, countPressings(combinePages(pages)));
      if (reviewDraft.current || loaded > 1) {
        rememberDraft({ ...currentDraft, lastPage: loaded, choices: currentDraft.choices.filter(choice => !needsReview.includes(choice)) });
      }
      if (needsReview.length) setReviewNotices(previous => [...previous, ...needsReview.map(choice => ({
        choice, reason: 'Another pressing appeared. Choose the release you want.',
      }))]);
      setLoadedPages(pages);
      setPagination({ page: loaded, totalPages: result.totalPages, nextPage });
      setFetchStatus('ready');
    } catch (error) {
      setFetchStatus(error instanceof ApiError && error.status === 400 ? 'connection-error' : 'error');
    } finally {
      operationInProgress.current = false;
    }
  };

  const restoreReview = async () => {
    const savedDraft = reviewDraft.current;
    if (operationInProgress.current || recovery === 'checking' || !savedDraft) return;
    operationInProgress.current = true;
    setRestoreFailed(false);
    setRestoringPage(0);
    try {
      const library = savedDraft.choices.length ? await getImportLibrary(AbortSignal.timeout(requestTimeout)) : [];
      const savedByTitle = new Map(library.map(album => [importTitleKey(album.artist_name, album.title), album.status]));
      const savedByRelease = new Map(library.map(album => [album.discogs_id, album.status]));
      const pages: CollectionPages = new Map();
      setRestoringPage(1);
      let result = await api.importDiscogsCollection(1, AbortSignal.timeout(requestTimeout));
      pages.set(result.page, result.albums);
      while (result.nextPage && result.nextPage <= savedDraft.lastPage) {
        setRestoringPage(result.nextPage);
        result = await api.importDiscogsCollection(result.nextPage, AbortSignal.timeout(requestTimeout));
        pages.set(result.page, result.albums);
      }
      const fresh = combinePages(pages);
      const releases = new Map(fresh.map(album => [album.discogsId, album]));
      const ambiguous = bulkChoicesToReview(savedDraft.choices, countPressings(fresh));
      const notices: ReviewNotice[] = [];
      const choices = savedDraft.choices.filter(choice => {
        const savedShelf = savedByRelease.get(choice.discogsId) ?? savedByTitle.get(titleKey(choice));
        const release = releases.get(choice.discogsId);
        if (savedShelf) notices.push({ choice, reason: `Already in ${shelfNames[savedShelf]}.` });
        else if (!release || titleKey(release) !== titleKey(choice)) {
          notices.push({ choice, reason: 'Unavailable on the refreshed pages. Check the list or load more records.' });
        } else if (ambiguous.includes(choice)) notices.push({ choice, reason: 'Another pressing appeared. Choose the release you want.' });
        else return true;
        return false;
      });

      focusReview.current = true;
      rememberDraft({ ...savedDraft, choices, lastPage: result.page });
      setReviewNotices(notices);
      setLoadedPages(pages);
      setPagination({ page: result.page, totalPages: result.totalPages, nextPage: result.nextPage });
      setFetchStatus('ready');
    } catch {
      setRestoreFailed(true);
    } finally {
      operationInProgress.current = false;
      setRestoringPage(null);
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
      const stored = remember([...journal.current.filter(entry => !ids.has(entry.album.discogsId) || !needsImportCheck(entry)), ...queue]);
      if (!verify) {
        setPreviousDestination(destination);
        rememberDraft(null, stored);
      }

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
  const allEligible = remaining.filter(album => titleCounts.get(titleKey(album)) === 1);
  const hasUnselectedEligible = allEligible.some(album => !selectedIds.has(album.discogsId));
  const eligibleTitleCount = new Set(remaining.map(titleKey)).size;
  const retryJobs = entries.filter(entry => entry.status === 'failed');
  const resumeJobs = entries.filter(entry => entry.status === 'pending' || entry.status === 'sending');
  const visibleAlbums = new Map(entries.map(entry => [entry.album.discogsId, entry.album]));
  for (const album of catalog) visibleAlbums.set(album.discogsId, album);
  const pressingsByTitle = new Map<string, ImportEntry['album'][]>();
  for (const album of visibleAlbums.values()) {
    const title = titleKey(album);
    const pressings = pressingsByTitle.get(title) ?? [];
    pressings.push(album);
    pressingsByTitle.set(title, pressings);
  }
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
  const progressText = progress ? `Importing ${progress.current} of ${progress.total} to ${shelfNames[progress.destination]}…` : null;
  const recoveryText = recovery === 'checking' ? 'Checking your shelves for this import…'
    : recovery === 'error' ? 'Could not check which records were saved. Check your shelves again to continue.'
      : initialRecovery && resumeJobs.length > 0 ? 'An import was interrupted. Outcomes found on your shelves are shown below.'
        : initialRecovery && summary ? 'Checked both shelves. Your import outcomes are below.' : null;
  const draftSummary = draft && `${draft.choices.length} selected for ${shelfNames[draft.destination]}`;

  const chooseAlbum = (album: Pick<DiscogsAlbum, 'discogsId' | 'artist' | 'album'>, checked: boolean) => {
    if (operationInProgress.current) return;
    const current = draftForReview();
    const title = titleKey(album);
    const choices = current.choices.filter(choice => titleKey(choice) !== title);
    if (checked) choices.push(reviewChoiceFor(album, 'chosen'));
    rememberDraft({ ...current, choices });
    setReviewNotices(previous => previous.filter(notice => titleKey(notice.choice) !== title));
  };

  const chooseAll = () => {
    if (operationInProgress.current) return;
    const current = draftForReview();
    const alreadySelected = new Set(current.choices.map(choice => choice.discogsId));
    const choices = hasUnselectedEligible ? [...current.choices, ...allEligible
      .filter(album => !alreadySelected.has(album.discogsId)).map(album => reviewChoiceFor(album, 'bulk'))] : [];
    rememberDraft({ ...current, choices });
  };

  const discardReview = () => {
    if (operationInProgress.current) return;
    focusReview.current = true;
    rememberDraft(null);
    setPreviousDestination(undefined);
    setRestoreFailed(false);
    setReviewNotices([]);
    setLoadedPages(new Map());
    setPagination(undefined);
    setFetchStatus('idle');
  };

  const close = () => {
    setShowBackgroundStatus(progress !== null || resumeJobs.length > 0 || recovery === 'checking' || recovery === 'error');
    if (!progress && !draft) setPreviousDestination(undefined);
    onClose();
  };

  const renderRecord = (album: ImportEntry['album'], multiple: boolean) => {
    const entry = outcomes.get(album.discogsId);
    const isImporting = progress?.albumId === album.discogsId;
    const label = `Select ${album.album} by ${album.artist}${multiple ? ` · Discogs release ${album.discogsId}` : ''}`;
    const facts = [album.pressing?.format, album.pressing?.label, album.pressing?.catalogNumber, album.pressing?.country]
      .filter(Boolean).join(' · ');
    const alternativeProcessed = !entry && processedTitles.has(titleKey(album));
    return <article key={album.discogsId} className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-t-xl bg-gray-50">
        {album.coverImageUrl
          ? <img src={album.coverImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <span className="px-2 text-center text-xs text-gray-600">Cover unavailable</span>}
      </div>
      <div className="min-w-0 space-y-1 p-3 [overflow-wrap:anywhere]">
        {multiple
          ? <h4 className="text-sm font-semibold text-gray-900">Discogs {album.discogsId}</h4>
          : <h3 className="text-sm font-semibold text-gray-900">{album.album}</h3>}
        {(!multiple || album.year) && <p className="text-xs text-gray-600">
          {multiple ? album.year : `${album.artist}${album.year ? ` · ${album.year}` : ''}`}
        </p>}
        {facts && <p className="text-xs text-gray-600">{facts}</p>}
        <a className="rh-comparison-source text-xs" href={`https://www.discogs.com/release/${album.discogsId}`} target="_blank" rel="noreferrer">
          {multiple ? 'View on Discogs' : `Discogs ${album.discogsId}`}<span className="sr-only">{multiple && ` · release ${album.discogsId}`} (opens in a new tab)</span>
        </a>
      </div>
      <div className="mt-auto px-3 pb-3 [overflow-wrap:anywhere]">
        {isImporting && <p className="text-sm font-medium">Importing…</p>}
        {entry && !isImporting && <ImportRowOutcome entry={entry} retry={() => void importRecords([entry], true)}
          disabled={busy || resumeJobs.length > 0 || recovery === 'error'} />}
        {alternativeProcessed && <p className="text-sm text-gray-600">Another pressing of this album is in the import review.</p>}
        {!entry && !alternativeProcessed && <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-medium">
          <input type="checkbox" checked={selectedIds.has(album.discogsId)} disabled={busy}
            aria-label={label} onChange={event => chooseAlbum(album, event.currentTarget.checked)} />
          {multiple ? 'Choose pressing' : 'Select'}
        </label>}
      </div>
    </article>;
  };

  if (!open) {
    if (!showBackgroundStatus && !draft) return null;
    return (
      <aside className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-300 bg-white p-3" aria-label="Discogs import status">
        <p className="min-w-0 flex-1 basis-44 text-sm font-medium" role="status">
          {!showBackgroundStatus ? `Discogs review · ${draftSummary}` : progressText ?? (recovery === 'checking' ? 'Checking your shelves for an interrupted Discogs import…'
            : resumeJobs.length ? 'Discogs import has records to review'
              : stopped ? 'Discogs import stopped' : 'Discogs import finished')}
          {showBackgroundStatus && !progress && summary ? ` · ${summary}` : ''}
        </p>
        <button type="button" className={secondaryAction} onClick={onOpen}>{showBackgroundStatus ? 'Reopen Discogs import' : 'Open Discogs review'}</button>
        {showBackgroundStatus && !progress && recovery !== 'checking' && (
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
          {reviewStorageFailed && <p role="status" className="text-sm text-gray-600">This tab could not save review changes for reload.</p>}
          {recoveryText && <p role={recovery === 'error' ? 'alert' : 'status'} className="text-sm text-gray-600">{recoveryText}</p>}
          {fetchFailed && (
            <p className="text-sm text-red-600" role="alert">
              {fetchStatus === 'connection-error'
                ? 'The server could not verify your Discogs account. Ask your server administrator to check the connection.'
                : fetchPage > 1 ? `Could not load Discogs page ${fetchPage}. Your existing selection is kept.`
                  : 'Could not load your Discogs collection. Try loading it again.'}
            </p>
          )}

          {!hasCatalog && draft ? (
            <section className="space-y-2" aria-label="Saved Discogs review">
              <p ref={reviewHeading} tabIndex={-1} className="text-sm font-semibold text-gray-900">Saved review · {draftSummary}</p>
              <p className="text-sm text-gray-600" role={restoreFailed ? 'alert' : 'status'}>
                {restoreFailed ? 'Could not refresh your review. Your choices are kept. Try again.'
                  : restoringPage === 0 ? 'Checking both shelves for your selected records…'
                    : restoring ? `Refreshing page ${restoringPage} of ${draft.lastPage}…`
                      : 'Resume to refresh the Discogs pages you reviewed and check both shelves.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryAction} disabled={busy} onClick={() => void restoreReview()}>
                  {restoring ? 'Refreshing…' : restoreFailed ? 'Retry review' : 'Resume review'}
                </button>
                <button type="button" className={secondaryAction} disabled={busy} onClick={discardReview}>Discard review</button>
              </div>
            </section>
          ) : !hasCatalog ? (
            <div className={entries.length ? 'space-y-2' : 'py-8 text-center sm:py-12'}>
              <p ref={reviewHeading} tabIndex={-1} className="text-sm font-medium text-gray-900" role="status">
                {fetchStatus === 'loading' ? 'Loading your Discogs collection…' : 'Review your Discogs collection'}
              </p>
              <p className="mb-3 text-sm text-gray-600">Load records, then choose a shelf and the albums to import.</p>
              <button type="button" className={primaryAction} onClick={() => void fetchCollection()} disabled={busy}>
                {fetchStatus === 'idle' ? 'Load Discogs collection' : fetchStatus === 'loading' ? 'Loading…' : 'Reload Discogs collection'}
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <p ref={reviewHeading} tabIndex={-1} className="text-sm font-medium" role="status">
                {remaining.length
                  ? `${remaining.length} ${remaining.length === 1 ? 'record' : 'records'} available${morePage ? ' on loaded pages' : ''}`
                  : morePage ? 'No new records on the pages loaded so far.'
                    : entries.length ? 'No additional records to import.' : 'No new records to import.'}
              </p>
              {eligibleTitleCount < remaining.length && <p className="text-sm text-gray-600">
                Choose one pressing per album where several are listed. Select all skips those albums.
              </p>}
              {draft && <div className="flex flex-wrap items-center justify-between gap-x-3">
                <p className="text-sm text-gray-600" role="status">{draftSummary}</p>
                <button type="button" className="rh-lookup-link" disabled={busy} onClick={discardReview}>Discard review</button>
              </div>}
            </div>
          )}

          {reviewNotices.length > 0 && <section className="space-y-1 border-y border-gray-200 py-2" aria-label="Changes to your Discogs selection">
            <p className="text-sm font-medium text-gray-900" role="status">
              {reviewNotices.length} {reviewNotices.length === 1 ? 'selection needs' : 'selections need'} your attention.
            </p>
            <ul className="space-y-1 pl-4 text-sm text-gray-600 [overflow-wrap:anywhere]">
              {reviewNotices.map(({ choice, reason }) => <li key={choice.discogsId} className="list-disc">
                {choice.album} by {choice.artist} · Discogs {choice.discogsId}. {reason}
              </li>)}
            </ul>
          </section>}

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
                    onChange={shelf => { if (!operationInProgress.current) rememberDraft({ ...draftForReview(), destination: shelf }); }} />
                  {(hasUnselectedEligible || selected.length > 0) && (
                    <button type="button" className={secondaryAction} disabled={busy} onClick={chooseAll}>
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
            {[...pressingsByTitle.entries()].map(([title, pressings]) => pressings.length === 1 ? renderRecord(pressings[0], false) : (
              <section key={title} className="col-span-full space-y-2 border-y border-gray-200 py-3"
                aria-label={`Pressings of ${pressings[0].album} by ${pressings[0].artist}`}>
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <h3 className="text-sm font-semibold text-gray-900">{pressings[0].album}</h3>
                  <p className="text-sm text-gray-600">{pressings[0].artist} · {pressings.length} pressings</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {pressings.map(album => renderRecord(album, true))}
                </div>
              </section>
            ))}
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
