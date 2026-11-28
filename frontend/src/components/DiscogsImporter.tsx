import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import api, { ApiError, type DiscogsAlbum, type DiscogsCollectionPage } from '../services/api';
import {
  entryFor, getImportLibrary, importTitleKey, needsImportCheck, readDiscogsImport, readImportReview, reconcileImport,
  reviewChoiceFor, writeDiscogsImport, writeImportReview, type ImportEntry, type ImportReviewChoice, type ImportReviewDraft,
  type ImportReviewNotice,
} from '../services/discogsImportSession';
import { ModalDialog } from './ModalDialog';
import { PressingPairEvidence, PressingPairSelects } from './PressingCandidates';
import { SaveShelfSelect } from './SaveDestinationActions';
import './DiscogsImporter.css';

type Shelf = 'collection' | 'wishlist';
type ImportProgress = { albumId: number; destination: Shelf; current: number; total: number };
type ListStatus = 'idle' | 'loading' | 'ready' | 'canceled' | 'error' | 'connection-error';
type Recovery = 'idle' | 'checking' | 'ready' | 'error';
type CollectionPages = Map<number, DiscogsAlbum[]>;

const shelves: Shelf[] = ['collection', 'wishlist'];
const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };
const primaryAction = 'rh-primary-action px-3 text-sm font-semibold disabled:opacity-60';
const secondaryAction = 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-55';
const titleKey = ({ artist, album }: Pick<DiscogsAlbum, 'artist' | 'album'>) => importTitleKey(artist, album);
const requestTimeout = 30_000;
const counted = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

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

function focusInReview(panel: HTMLElement | null, header: HTMLElement | null, target: HTMLElement | null, alignTo = target, footer?: HTMLElement | null) {
  if (!target || !panel || !alignTo) return;
  const panelTop = panel.getBoundingClientRect().top + panel.clientTop;
  const visibleTop = panelTop + (header?.getBoundingClientRect().height ?? 0) + 12;
  const visibleBottom = panelTop + panel.clientHeight - (footer?.getBoundingClientRect().height ?? 0) - 12;
  const targetBounds = target.getBoundingClientRect();
  const preferredOffset = alignTo.getBoundingClientRect().top - visibleTop;
  const minimumOffset = targetBounds.bottom - visibleBottom;
  const maximumOffset = targetBounds.top - visibleTop;
  panel.scrollTop += Math.min(maximumOffset, Math.max(minimumOffset, preferredOffset));
  target.focus({ preventScroll: true });
}

const pressingHeadingId = (album: ImportEntry['album']) => `discogs-import-pressings-${album.discogsId}`;

function ImportPressingEvidence({ pressings, onChoose, disabled }: {
  pressings: ImportEntry['album'][]; onChoose: (releaseId: number) => void; disabled: boolean;
}) {
  const choices = pressings.map(album => ({ releaseId: album.discogsId, artist: album.artist, year: album.year, pressing: album.pressing }));
  const [firstId, setFirstId] = useState(choices[0].releaseId);
  const [secondId, setSecondId] = useState(choices[1].releaseId);
  const [pairChanged, setPairChanged] = useState(false);
  const first = choices.find(choice => choice.releaseId === firstId) ?? choices[0];
  const alternatives = choices.filter(choice => choice.releaseId !== first.releaseId);
  const second = alternatives.find(choice => choice.releaseId === secondId) ?? alternatives[0];
  return <details className="rh-pressing-secondary min-w-0 text-sm">
    <summary>Compare listings</summary>
    <div className="space-y-2 pb-2">
      <PressingPairEvidence reference={{ choice: first, label: 'Discogs' }} target={{ choice: second, label: 'Discogs' }}
        onLocate={onChoose} disabled={disabled} announceChanges={pairChanged} uncertainAction="Leave this title unresolved if the listings don't distinguish your copy.">
        {choices.length > 2 && <PressingPairSelects choices={choices} firstId={first.releaseId} secondId={second.releaseId}
          onChangeFirst={id => { setFirstId(id); setPairChanged(true); }}
          onChangeSecond={id => { setSecondId(id); setPairChanged(true); }} />}
      </PressingPairEvidence>
    </div>
  </details>;
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
  const directlySelectedIds = new Set(draft?.choices.filter(choice => choice.source === 'chosen').map(choice => choice.discogsId));
  const reviewNotices = draft?.notices ?? [];
  const [activePressingReview, setActivePressingReview] = useState<string>();
  const [restoringPage, setRestoringPage] = useState<number | null>(null);
  const restoring = restoringPage !== null;
  const [reviewCheck, setReviewCheck] = useState<'ready' | 'failed' | 'canceled'>('ready');
  const [reviewStorageFailed, setReviewStorageFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const continuationBar = useRef<HTMLElement>(null);
  const signoffBar = useRef<HTMLDivElement>(null);
  const reviewHeading = useRef<HTMLParagraphElement>(null);
  const noticesHeading = useRef<HTMLParagraphElement>(null);
  const coverageHeading = useRef<HTMLParagraphElement>(null);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const selectionFocus = useRef<string | null>(null);
  const [reviewingSelection, setReviewingSelection] = useState(false);
  const [titleFilter, setTitleFilter] = useState(draft?.working?.searchText ?? '');
  const [needsChoiceOnly, setNeedsChoiceOnly] = useState(draft?.working?.needsChoiceOnly ?? false);
  const resumeWorkingRelease = useRef<number | null>(null);
  const [signoffTarget, setSignoffTarget] = useState<string>();
  const signoffTargetFocus = useRef<string | null>(null);
  const focusPressingFilter = useRef(false);
  const [clearedSelection, setClearedSelection] = useState<Pick<ImportReviewDraft, 'choices' | 'destination'> | null>(null);
  const reviewOrigin = useRef<{ id: string; releaseId?: number; scrollTop: number } | null>(null);
  const reviewFocus = useRef<'overview' | 'changes' | 'coverage' | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const discardConfirmation = useRef<HTMLElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const keepReviewButton = useRef<HTMLButtonElement>(null);
  const focusDiscard = useRef(false);
  const [showBackgroundStatus, setShowBackgroundStatus] = useState(initialRecovery);
  const [storageFailed, setStorageFailed] = useState(false);
  const operationInProgress = useRef(false);
  const pageRead = useRef<AbortController | null>(null);
  const stopRequested = useRef(false);
  const busy = fetchStatus === 'loading' || progress !== null || recovery === 'checking' || restoring || confirmingDiscard;
  const hasCatalog = !!pagination;

  useLayoutEffect(() => {
    const scrollPanel = panel.current;
    const footer = reviewingSelection ? signoffBar.current : continuationBar.current;
    const stickyHeader = header.current;
    if (!open || !scrollPanel?.style || !stickyHeader || typeof ResizeObserver === 'undefined') return;
    const syncScrollPadding = () => {
      scrollPanel.style.scrollPaddingBlockStart = `${stickyHeader.offsetHeight + 8}px`;
      scrollPanel.style.scrollPaddingBlockEnd = `${(footer?.offsetHeight ?? 0) + 8}px`;
    };
    const observer = new ResizeObserver(syncScrollPadding);
    observer.observe(stickyHeader);
    if (footer) observer.observe(footer);
    syncScrollPadding();
    return () => {
      observer.disconnect();
      scrollPanel.style.scrollPaddingBlockStart = '';
      scrollPanel.style.scrollPaddingBlockEnd = '';
    };
  }, [hasCatalog, open, reviewingSelection]);

  useLayoutEffect(() => {
    if (open && reviewFocus.current) {
      const target = reviewFocus.current === 'changes' ? noticesHeading.current ?? reviewHeading.current
        : reviewFocus.current === 'coverage' ? coverageHeading.current ?? reviewHeading.current : reviewHeading.current;
      if (!target) return;
      reviewFocus.current = null;
      if (target === coverageHeading.current) target.focus({ preventScroll: true });
      else focusInReview(panel.current, header.current, target, target, continuationBar.current);
    }
  }, [draft, fetchStatus, open, pagination, reviewCheck, restoringPage, reviewingSelection]);

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    if (reviewingSelection) {
      panel.current.scrollTop = 0;
      selectionHeading.current?.focus({ preventScroll: true });
    } else if (reviewOrigin.current) {
      const { id, releaseId, scrollTop } = reviewOrigin.current;
      reviewOrigin.current = null;
      panel.current.scrollTop = scrollTop;
      const origin = panel.current.querySelector<HTMLElement>(`#${id}`);
      if (origin && !origin.hasAttribute?.('disabled')) {
        origin.focus({ preventScroll: true });
      } else {
        const fallback = releaseId ? panel.current.querySelector<HTMLElement>(`#discogs-import-release-${releaseId}`) : reviewHeading.current;
        const target = fallback ?? reviewHeading.current;
        focusInReview(panel.current, header.current, target, target, continuationBar.current);
      }
    }
  }, [open, reviewingSelection]);

  useLayoutEffect(() => {
    if (!reviewingSelection || !selectionFocus.current) return;
    const target = panel.current?.querySelector<HTMLElement>(`#${selectionFocus.current}`) ?? selectionHeading.current;
    selectionFocus.current = null;
    focusInReview(panel.current, header.current, target, target, signoffBar.current);
  }, [draft, reviewingSelection]);

  useLayoutEffect(() => {
    if (!open) return;
    if (confirmingDiscard) focusInReview(panel.current, header.current, keepReviewButton.current, discardConfirmation.current, continuationBar.current);
    else if (focusDiscard.current) {
      focusDiscard.current = false;
      focusInReview(panel.current, header.current, discardButton.current, discardButton.current, continuationBar.current);
    }
  }, [confirmingDiscard, open]);

  const rememberDraft = (next: ImportReviewDraft | null, persist = true) => {
    reviewDraft.current = next;
    if (persist) setReviewStorageFailed(!writeImportReview(next));
    setDraft(next);
  };

  const draftForReview = (): ImportReviewDraft => reviewDraft.current ?? {
    choices: [], notices: [], destination, lastPage: pagination?.page ?? 1,
  };

  const workingContext = (current: ImportReviewDraft) => current.working ?? { searchText: titleFilter, needsChoiceOnly };

  const rememberActiveRelease = (releaseId: number) => {
    if (operationInProgress.current) return;
    const current = draftForReview();
    if (current.working?.releaseId === releaseId) return;
    rememberDraft({ ...current, working: { ...workingContext(current), releaseId } });
  };

  const changeBrowseFilters = (searchText: string, needsChoice: boolean) => {
    if (operationInProgress.current) return;
    const current = draftForReview();
    setSignoffTarget(undefined);
    setTitleFilter(searchText);
    setNeedsChoiceOnly(needsChoice);
    rememberDraft({ ...current, working: { ...workingContext(current), searchText, needsChoiceOnly: needsChoice } });
  };

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
    const controller = new AbortController();
    pageRead.current = controller;
    setFetchPage(page);
    setFetchStatus('loading');
    try {
      const result = await api.importDiscogsCollection(page, AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeout)]));
      if (controller.signal.aborted) return;
      const pages = new Map(loadedPages).set(page, result.albums);
      const loaded = Math.max(pagination?.page ?? 1, result.page);
      const nextPage = loaded < result.totalPages ? loaded + 1 : undefined;
      const currentDraft = draftForReview();
      const needsReview = new Set(bulkChoicesToReview(currentDraft.choices, countPressings(combinePages(pages))));
      if (!pagination) reviewFocus.current = 'overview';
      else if (page > 1 && !nextPage) reviewFocus.current = 'coverage';
      setClearedSelection(null);
      if (reviewDraft.current || loaded > 1) {
        rememberDraft({
          ...currentDraft, lastPage: loaded, choices: currentDraft.choices.filter(choice => !needsReview.has(choice)),
          notices: [...currentDraft.notices, ...[...needsReview].map(choice => ({ choice, cause: 'competing' as const }))],
        });
      }
      setLoadedPages(pages);
      setPagination({ page: loaded, totalPages: result.totalPages, nextPage });
      setFetchStatus('ready');
    } catch (error) {
      if (!controller.signal.aborted) setFetchStatus(error instanceof ApiError && error.status === 400 ? 'connection-error' : 'error');
    } finally {
      pageRead.current = null;
      if (controller.signal.aborted) setFetchStatus('canceled');
      operationInProgress.current = false;
    }
  };

  const cancelPageLoad = () => {
    reviewFocus.current = 'coverage';
    pageRead.current?.abort();
  };

  const recheckReview = async () => {
    if (operationInProgress.current || recovery === 'checking') return;
    const savedDraft = draftForReview();
    const controller = new AbortController();
    const readSignal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(requestTimeout)]);
    pageRead.current = controller;
    operationInProgress.current = true;
    setReviewCheck('ready');
    setRestoringPage(0);
    try {
      const library = savedDraft.choices.length || savedDraft.notices.length || savedDraft.working?.releaseId
        ? await getImportLibrary(readSignal()) : [];
      if (controller.signal.aborted) return;
      const savedByTitle = new Map(library.map(album => [importTitleKey(album.artist_name, album.title), album.status]));
      const savedByRelease = new Map(library.map(album => [album.discogs_id, album.status]));
      const pages: CollectionPages = new Map();
      setRestoringPage(1);
      let result = await api.importDiscogsCollection(1, readSignal());
      if (controller.signal.aborted) return;
      pages.set(result.page, result.albums);
      while (result.nextPage && result.nextPage <= savedDraft.lastPage) {
        setRestoringPage(result.nextPage);
        result = await api.importDiscogsCollection(result.nextPage, readSignal());
        if (controller.signal.aborted) return;
        pages.set(result.page, result.albums);
      }
      const getSavedShelf = (choice: Pick<DiscogsAlbum, 'discogsId' | 'artist' | 'album'>) =>
        savedByRelease.get(choice.discogsId) ?? savedByTitle.get(titleKey(choice));
      for (const [page, albums] of pages) pages.set(page, albums.filter(album => !getSavedShelf(album)));
      const fresh = combinePages(pages);
      const releases = new Map(fresh.map(album => [album.discogsId, album]));
      const ambiguous = new Set(bulkChoicesToReview(savedDraft.choices, countPressings(fresh)));
      const currentNotice = (choice: ImportReviewChoice): ImportReviewNotice => {
        const shelf = getSavedShelf(choice);
        if (shelf) return { choice, cause: 'saved', shelf };
        const release = releases.get(choice.discogsId);
        return { choice, cause: release && titleKey(release) === titleKey(choice) ? 'competing' : 'unavailable' };
      };
      const notices = savedDraft.notices.map(({ choice }) => currentNotice(choice));
      const choices = savedDraft.choices.filter(choice => {
        const notice = currentNotice(choice);
        if (notice.cause === 'competing' && !ambiguous.has(choice)) return true;
        notices.push(notice);
        return false;
      });

      const activeReleaseId = savedDraft.working?.releaseId;
      if (!pagination && activeReleaseId) resumeWorkingRelease.current = activeReleaseId;
      else reviewFocus.current = notices.length ? 'changes' : 'overview';
      const working = savedDraft.working && activeReleaseId && !releases.has(activeReleaseId)
        ? { ...savedDraft.working, releaseId: undefined } : savedDraft.working;
      setClearedSelection(null);
      if (reviewDraft.current || result.page > 1) rememberDraft({ ...savedDraft, choices, notices, lastPage: result.page, working });
      setLoadedPages(pages);
      setPagination({ page: result.page, totalPages: result.totalPages, nextPage: result.nextPage });
      setFetchStatus('ready');
    } catch {
      if (!controller.signal.aborted) setReviewCheck('failed');
    } finally {
      pageRead.current = null;
      if (controller.signal.aborted) setReviewCheck('canceled');
      operationInProgress.current = false;
      setRestoringPage(null);
    }
  };

  const importRecords = async (jobs: ImportEntry[], verify = false) => {
    if (operationInProgress.current || recovery === 'checking' || recovery === 'error' || !jobs.length || (!verify && reviewCheck !== 'ready')) return;
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
        setClearedSelection(null);
        setPreviousDestination(destination);
        const current = reviewDraft.current;
        rememberDraft(current && (current.notices.length || pagination?.nextPage) ? {
          ...current, choices: current.choices.filter(choice => !ids.has(choice.discogsId)),
        } : null, stored);
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
  const reviewTitles = new Set(reviewNotices.map(({ choice }) => titleKey(choice)));
  const allEligible = remaining.filter(album => titleCounts.get(titleKey(album)) === 1 && !reviewTitles.has(titleKey(album)));
  const eligibleTitleCount = new Set(remaining.map(titleKey)).size;
  const individualTitleCount = eligibleTitleCount - allEligible.length;
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
  const unresolvedNotices = reviewNotices.filter(notice => notice.cause !== 'saved');
  const savedNotices = reviewNotices.filter(notice => notice.cause === 'saved');
  const unresolvedCount = unresolvedNotices.length;
  const savedNoticeCount = savedNotices.length;
  const unresolvedTitles = new Set(unresolvedNotices.map(({ choice }) => titleKey(choice)));
  const chosenTitles = new Set(selected.map(titleKey));
  const needingChoice = new Set(remaining.filter(album => {
    const title = titleKey(album);
    return !chosenTitles.has(title) && ((titleCounts.get(title) ?? 0) > 1 || unresolvedTitles.has(title));
  }).map(titleKey));
  const queryTerms = titleFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const titleGroups = [...pressingsByTitle.entries()];
  const freshPressingGroups = titleGroups.filter(([title, pressings]) =>
    pressings.length > 1 && needingChoice.has(title) && !reviewTitles.has(title));
  const searchMatches = titleGroups.filter(([, [first]]) => queryTerms.every(term => `${first.artist} ${first.album}`.toLowerCase().includes(term)));
  const matchingNeeds = searchMatches.filter(([title]) => needingChoice.has(title));
  const filteredTitleGroups = needsChoiceOnly ? matchingNeeds : searchMatches;
  const visibleTitles = new Set(filteredTitleGroups.map(([title]) => title));
  const temporaryTitle = signoffTarget && !visibleTitles.has(signoffTarget) ? signoffTarget : undefined;
  const visibleTitleGroups = temporaryTitle ? titleGroups.filter(([title]) => title === temporaryTitle || visibleTitles.has(title)) : filteredTitleGroups;
  const unselectedEligible = allEligible.filter(album => visibleTitles.has(titleKey(album)) && !selectedIds.has(album.discogsId));
  const firstPressingGroup = matchingNeeds[0]?.[1][0];
  const choiceFocusId = firstPressingGroup ? pressingHeadingId(firstPressingGroup) : 'discogs-import-filter';
  const draftSummary = draft && [`${counted(draft.choices.length, 'title')} selected for ${shelfNames[draft.destination]}`,
    unresolvedCount ? `${unresolvedCount} ${unresolvedCount === 1 ? 'needs' : 'need'} attention` : null,
    savedNoticeCount ? `${savedNoticeCount} already saved` : null].filter(Boolean).join(' · ');
  const canReviewSelection = selected.length > 0 && !busy && !resumeJobs.length && recovery !== 'error' && reviewCheck === 'ready';

  useLayoutEffect(() => {
    if (!open || !focusPressingFilter.current) return;
    focusPressingFilter.current = false;
    const target = panel.current?.querySelector<HTMLElement>(`#${choiceFocusId}`) ?? null;
    focusInReview(panel.current, header.current, target, target, continuationBar.current);
  }, [choiceFocusId, needsChoiceOnly, open, titleFilter]);

  useLayoutEffect(() => {
    if (!open || reviewingSelection || !signoffTargetFocus.current) return;
    const target = panel.current?.querySelector<HTMLElement>(`#${signoffTargetFocus.current}`) ?? reviewHeading.current;
    signoffTargetFocus.current = null;
    focusInReview(panel.current, header.current, target, target, continuationBar.current);
  }, [open, reviewingSelection, signoffTarget]);

  useLayoutEffect(() => {
    if (!open || !hasCatalog || restoring || resumeWorkingRelease.current === null) return;
    const releaseId = resumeWorkingRelease.current;
    resumeWorkingRelease.current = null;
    const target = panel.current?.querySelector<HTMLInputElement>(`#discogs-import-release-${releaseId}:not(:disabled)`);
    const filter = panel.current?.querySelector<HTMLInputElement>('#discogs-import-filter');
    const fallback = titleFilter.trim() || needsChoiceOnly ? filter : noticesHeading.current;
    const focus = target ?? fallback ?? reviewHeading.current;
    focusInReview(panel.current, header.current, focus, focus, continuationBar.current);
  }, [hasCatalog, needsChoiceOnly, open, restoring, titleFilter]);

  const chooseAlbum = (album: Pick<DiscogsAlbum, 'discogsId' | 'artist' | 'album'>, checked: boolean) => {
    if (operationInProgress.current) return;
    setClearedSelection(null);
    const current = draftForReview();
    const title = titleKey(album);
    if (checked && needsChoiceOnly && needingChoice.has(title)) focusPressingFilter.current = true;
    const choices = current.choices.filter(choice => titleKey(choice) !== title);
    if (checked) choices.push(reviewChoiceFor(album, 'chosen'));
    const notices = checked ? current.notices.filter(notice => titleKey(notice.choice) !== title) : current.notices;
    const working = reviewingSelection ? current.working : { ...workingContext(current), releaseId: album.discogsId };
    rememberDraft({ ...current, choices, notices, working });
  };

  const dismissNotice = (title: string) => {
    const current = reviewDraft.current;
    if (busy || operationInProgress.current || !current) return;
    reviewFocus.current = 'changes';
    rememberDraft({ ...current, notices: current.notices.filter(notice => titleKey(notice.choice) !== title) });
  };

  const chooseAll = () => {
    if (operationInProgress.current) return;
    setClearedSelection(null);
    const current = draftForReview();
    rememberDraft({ ...current, choices: [...current.choices, ...unselectedEligible.map(album => reviewChoiceFor(album, 'bulk'))] });
  };

  const clearOrUndoSelection = () => {
    const current = reviewDraft.current;
    if (busy || operationInProgress.current || !current) return;
    if (clearedSelection) {
      if (reviewCheck !== 'ready') return;
      rememberDraft({ ...current, ...clearedSelection });
      setClearedSelection(null);
    } else {
      setClearedSelection({ choices: current.choices, destination: current.destination });
      rememberDraft({ ...current, choices: [] });
    }
  };

  const togglePressingFilter = () => {
    if (!needsChoiceOnly) focusPressingFilter.current = true;
    changeBrowseFilters(titleFilter, !needsChoiceOnly);
  };

  const discardReview = () => {
    if (operationInProgress.current) return;
    reviewFocus.current = 'overview';
    setConfirmingDiscard(false);
    rememberDraft(null);
    setPreviousDestination(undefined);
    setReviewCheck('ready');
    setActivePressingReview(undefined);
    setTitleFilter('');
    setNeedsChoiceOnly(false);
    setSignoffTarget(undefined);
    setClearedSelection(null);
    setLoadedPages(new Map());
    setPagination(undefined);
    setFetchStatus('idle');
  };

  const requestDiscard = () => {
    if (busy || operationInProgress.current) return;
    if (draft?.choices.length || draft?.notices.length) setConfirmingDiscard(true);
    else discardReview();
  };

  const keepReview = () => {
    focusDiscard.current = true;
    setConfirmingDiscard(false);
  };

  const close = () => {
    setConfirmingDiscard(false);
    reviewOrigin.current = null;
    setReviewingSelection(false);
    pageRead.current?.abort();
    setShowBackgroundStatus(progress !== null || resumeJobs.length > 0 || recovery === 'checking' || recovery === 'error');
    if (!progress && !draft) setPreviousDestination(undefined);
    onClose();
  };

  const discardControl = (className: string) => confirmingDiscard && draft ? (
    <section ref={discardConfirmation} className="w-full space-y-2 rounded-lg border border-gray-300 bg-gray-100 p-3" aria-labelledby="discogs-discard-heading">
      <h3 id="discogs-discard-heading" className="text-sm font-semibold">
        {draft.choices.length
          ? `Discard ${draft.choices.length} ${draft.choices.length === 1 ? 'selection' : 'selections'} for ${shelfNames[draft.destination]}?`
          : 'Discard saved Discogs review?'}
      </h3>
      <p id="discogs-discard-details" className="text-sm text-gray-600">
        {draft.notices.length ? 'This clears the saved review, including records flagged for your attention.'
          : 'This clears your choices and the pages you reviewed.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryAction} ref={keepReviewButton} onClick={keepReview}
          aria-describedby="discogs-discard-heading discogs-discard-details">Keep review</button>
        <button type="button" onClick={discardReview}
          className="min-h-11 rounded-lg border border-red-400 bg-red-50 px-3 text-sm font-semibold text-red-600 hover:bg-gray-50">Discard selection</button>
      </div>
    </section>
  ) : <button type="button" className={className} ref={discardButton} disabled={busy} onClick={requestDiscard}>Discard review</button>;

  const jumpToReviewTarget = (id: string) => {
    const target = panel.current?.querySelector<HTMLElement>(`#${id}`) ?? null;
    focusInReview(panel.current, header.current, target, target, continuationBar.current);
  };

  const openSelectionReview = (id: string, releaseId?: number) => {
    if (!canReviewSelection) return;
    reviewOrigin.current = { id, releaseId, scrollTop: panel.current?.scrollTop ?? 0 };
    setReviewingSelection(true);
  };

  const backToSelections = () => setReviewingSelection(false);

  const reviewPressingFromSignoff = (title: string, release: ImportEntry['album']) => {
    reviewOrigin.current = null;
    signoffTargetFocus.current = pressingHeadingId(release);
    setSignoffTarget(title);
    setReviewingSelection(false);
  };

  const confirmSelectionImport = () => {
    if (!canReviewSelection || !reviewingSelection) return;
    reviewOrigin.current = null;
    reviewFocus.current = 'overview';
    setReviewingSelection(false);
    void importRecords(selected.map(album => entryFor(album, destination)));
  };

  const importChoicesLink = (label: string, releaseId?: number) => {
    const id = releaseId ? `discogs-import-review-link-${releaseId}` : undefined;
    return remaining.length > 0 && <a id={id} href="#discogs-import-choices" className="rh-lookup-link inline-grid text-left"
      onClick={event => {
        event.preventDefault();
        if (id && canReviewSelection) openSelectionReview(id, releaseId);
        else jumpToReviewTarget('discogs-import-choices');
      }}>{label}</a>;
  };

  const renderRecord = (album: ImportEntry['album'], groupName?: string) => {
    const grouped = !!groupName;
    const entry = outcomes.get(album.discogsId);
    const isImporting = progress?.albumId === album.discogsId;
    const facts = [album.pressing?.format, album.pressing?.label, album.pressing?.catalogNumber, album.pressing?.country]
      .filter(Boolean).join(' · ');
    const pressingFacts = [album.pressing?.catalogNumber, album.pressing?.format, album.pressing?.country, album.year]
      .filter(Boolean).join(' · ');
    const label = album.pressing?.label;
    const release = `Discogs release ${album.discogsId}`;
    const id = `discogs-import-release-${album.discogsId}`;
    const checked = selectedIds.has(album.discogsId);
    const showImportLink = directlySelectedIds.has(album.discogsId);
    const selectionLabel = grouped ? checked ? 'Selected pressing' : 'Choose pressing' : 'Select';
    const alternativeProcessed = !entry && processedTitles.has(titleKey(album));
    return <article key={album.discogsId} className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white"
      onFocus={() => rememberActiveRelease(album.discogsId)}>
      {!grouped && <div className="flex aspect-square items-center justify-center overflow-hidden rounded-t-xl bg-gray-50">
        {album.coverImageUrl
          ? <img src={album.coverImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          : <span className="px-2 text-center text-xs text-gray-600">Cover unavailable</span>}
      </div>}
      <div className="min-w-0 space-y-1 p-3 [overflow-wrap:anywhere]">
        {grouped ? <>
          <h4 className="text-sm font-semibold text-gray-900">{pressingFacts || label || release}</h4>
          {pressingFacts && label && <p className="text-xs text-gray-600">{label}</p>}
          {(pressingFacts || label) && <p className="text-xs text-gray-600">{release}</p>}
        </> : <>
          <h3 id={pressingHeadingId(album)} tabIndex={-1} className="text-sm font-semibold text-gray-900">{album.album}</h3>
          <p className="text-xs text-gray-600">{album.artist}{album.year ? ` · ${album.year}` : ''}</p>
          {facts && <p className="text-xs text-gray-600">{facts}</p>}
          <a className="rh-comparison-source text-xs" href={`https://www.discogs.com/release/${album.discogsId}`} target="_blank" rel="noreferrer">
            Discogs {album.discogsId}<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </>}
      </div>
      <div className="mt-auto px-3 pb-3 [overflow-wrap:anywhere]">
        {isImporting && <p className="text-sm font-medium">Importing…</p>}
        {entry && !isImporting && <ImportRowOutcome entry={entry} retry={() => void importRecords([entry], true)}
          disabled={busy || resumeJobs.length > 0 || recovery === 'error'} />}
        {alternativeProcessed && <p className="text-sm text-gray-600">Another pressing of this album is in the import review.</p>}
        {!entry && !alternativeProcessed && <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-medium">
          <input id={id} type={grouped ? 'radio' : 'checkbox'} name={groupName} checked={checked} disabled={busy}
            className="size-4 shrink-0 accent-[var(--rh-info)]"
            aria-label={grouped ? [pressingFacts, label, release, selectionLabel].filter(Boolean).join(' · ') : `Select ${album.album} by ${album.artist}`}
            onChange={event => chooseAlbum(album, event.currentTarget.checked)} />
          {selectionLabel}
        </label>}
        {showImportLink && importChoicesLink('Review import choices', album.discogsId)}
        {grouped && <div className="flex flex-wrap items-center gap-x-2">
          <a className="rh-comparison-source min-h-11 content-center text-xs" href={`https://www.discogs.com/release/${album.discogsId}`} target="_blank" rel="noreferrer">
            View on Discogs<span className="sr-only"> · release {album.discogsId} (opens in a new tab)</span>
          </a>
          {album.coverImageUrl && <img src={album.coverImageUrl} alt="" loading="lazy" className="size-8 rounded object-cover" />}
        </div>}
        {!grouped && !showImportLink && activePressingReview === titleKey(album) && importChoicesLink('Back to import choices')}
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
  const morePage = pagination?.nextPage;
  const coverageText = pagination?.totalPages ? `${Math.min(pagination.page, pagination.totalPages)} of ${pagination.totalPages} Discogs pages loaded`
    : 'Discogs collection is empty';
  const shortCoverageText = pagination?.totalPages ? `${Math.min(pagination.page, pagination.totalPages)}/${pagination.totalPages} pages loaded` : 'No Discogs pages';
  const partialWarning = 'Later pages may contain alternate pressings. This import uses titles selected from the loaded pages.';
  const pageNotLoaded = fetchStatus === 'canceled' || fetchFailed;
  const retryPageLoad = fetchFailed || (fetchStatus === 'canceled' && fetchPage <= (pagination?.page ?? 0));
  const pageFailure = fetchStatus === 'connection-error'
    ? 'The server could not verify your Discogs account. Ask your server administrator to check the connection.'
    : fetchPage > 1 ? `Could not load Discogs page ${fetchPage}. Your existing selection is kept.`
      : 'Could not load your Discogs collection. Try loading it again.';
  const pageActionLabel = fetchStatus === 'loading' ? `Loading Discogs page ${fetchPage}…` : retryPageLoad ? 'Retry Discogs page' : 'Load next Discogs page';
  const compactPageActionLabel = fetchStatus === 'loading' ? 'Loading…' : retryPageLoad ? 'Retry' : 'Load next';
  const cancelPageButton = <button type="button" className={secondaryAction} onClick={cancelPageLoad}>Cancel page load</button>;
  const reviewStatus = reviewCheck === 'failed' ? hasCatalog
    ? 'Could not verify the selected records. Your choices are kept. Retry the review before importing.'
    : 'Could not refresh your review. Your draft is kept. Try again.'
    : reviewCheck === 'canceled' ? hasCatalog
      ? 'Review refresh canceled. Your choices are kept. Retry the review before importing.'
      : 'Review refresh canceled. Your draft is kept.'
      : restoringPage === 0 ? 'Checking both shelves for this review…'
        : restoringPage !== null ? `Refreshing page ${restoringPage} of ${draft?.lastPage ?? pagination?.page ?? 1}…` : null;
  const reviewRefreshButton = (className: string, startLabel: string) => <>
    <button type="button" className={`${className} aria-disabled:opacity-55`} aria-disabled={busy}
      aria-busy={restoring} aria-describedby={reviewStatus ? 'discogs-review-status' : undefined}
      onClick={() => { if (!busy) void recheckReview(); }}>
      {restoring ? 'Refreshing review…' : reviewCheck === 'ready' ? startLabel : 'Retry review'}
    </button>
    {restoring && <button type="button" className={secondaryAction} onClick={cancelPageLoad}>Cancel review refresh</button>}
  </>;
  return (
    <ModalDialog labelledBy="discogs-import-title" onClose={close} onEscape={reviewingSelection ? backToSelections : confirmingDiscard ? keepReview : close}>
      <div ref={panel} className="rh-dialog-panel max-w-6xl">
        <div ref={header} className="rh-dialog-header flex items-center justify-between gap-3 border-b border-gray-200 p-4 sm:p-6">
          <h2 id="discogs-import-title" className="text-xl font-bold text-gray-900">Import from Discogs</h2>
          <button type="button" onClick={close} className="rh-dialog-close" aria-label="Close Discogs import">
            <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {reviewingSelection && <section className="grid gap-4 p-4 sm:p-6" aria-labelledby="discogs-selected-heading">
          <div className="grid gap-1">
            <h3 id="discogs-selected-heading" tabIndex={-1} ref={selectionHeading} className="text-lg font-semibold">Review selected titles</h3>
            <p id="discogs-signoff-count" className="text-sm text-gray-600" role="status">
              {selected.length ? `${counted(selected.length, 'title')} selected for ${shelfNames[destination]}.` : 'No titles selected. Go back to select the releases you want.'}
            </p>
          </div>
          <div id="discogs-signoff-scope" className="space-y-1 border-y border-gray-200 py-2 text-sm">
            <p className="font-semibold">{coverageText}</p>
            {morePage && <p className="text-gray-600">{partialWarning}</p>}
            {freshPressingGroups.length > 0 && <details className="text-gray-600" aria-label="Unselected titles with multiple pressings">
              <summary className="min-h-11 cursor-pointer content-center">
                {counted(freshPressingGroups.length, 'unselected title')} {freshPressingGroups.length === 1 ? 'needs' : 'need'} a pressing choice
              </summary>
              <p className="pb-1">Select all skips titles with several pressings. These titles will be left out of this import.</p>
              <ul className="divide-y divide-gray-200 [overflow-wrap:anywhere]">
                {freshPressingGroups.map(([title, [release, ...alternatives]]) => <li key={title} className="py-1">
                  <p><strong className="text-gray-900">{release.album}</strong> by {release.artist} · {counted(alternatives.length + 1, 'listing')}</p>
                  <a href={`#${pressingHeadingId(release)}`} className="rh-lookup-link inline-grid px-0"
                    aria-label={`Review pressings for ${release.album} by ${release.artist}`}
                    onClick={event => { event.preventDefault(); reviewPressingFromSignoff(title, release); }}>Review pressings</a>
                </li>)}
              </ul>
            </details>}
            {unresolvedCount > 0 && <details className="text-gray-600">
              <summary className="min-h-11 cursor-pointer content-center">
                {counted(unresolvedCount, 'earlier selection')} {unresolvedCount === 1 ? 'needs' : 'need'} attention and will be left out
              </summary>
              <ul className="space-y-1 pb-2 [overflow-wrap:anywhere]">
                {unresolvedNotices.map(({ choice, cause }) => <li key={choice.discogsId}>
                  <strong className="text-gray-900">{choice.album}</strong> by {choice.artist} · Discogs {choice.discogsId} ·{' '}
                  {cause === 'unavailable' ? 'Unavailable on the reviewed pages' : 'Review available pressings'}
                </li>)}
              </ul>
            </details>}
            {savedNoticeCount > 0 && <p className="text-gray-600">{counted(savedNoticeCount, 'title')} already saved.</p>}
          </div>
          <ul className="divide-y divide-gray-200 [overflow-wrap:anywhere]" aria-label="Titles in this import">
            {selected.map((album, index) => {
              const facts = [album.pressing?.catalogNumber, album.pressing?.format, album.pressing?.country, album.year, album.pressing?.label]
                .filter(Boolean).join(' · ');
              return <li key={album.discogsId} className="grid gap-x-4 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <h4 className="text-sm font-semibold">{album.album}</h4>
                  <p className="text-sm text-gray-600">{album.artist}</p>
                  {facts && <p className="text-sm text-gray-600">{facts}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-x-2">
                  <a className="rh-comparison-source min-h-11 content-center" href={`https://www.discogs.com/release/${album.discogsId}`} target="_blank" rel="noreferrer">
                    Discogs release {album.discogsId}<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <button id={`discogs-signoff-remove-${album.discogsId}`} type="button" className="rh-lookup-link"
                    aria-label={`Remove ${album.album} by ${album.artist} from this import`}
                    aria-disabled={busy} onClick={() => {
                      if (busy) return;
                      const neighbor = selected[index + 1] ?? selected[index - 1];
                      selectionFocus.current = neighbor ? `discogs-signoff-remove-${neighbor.discogsId}` : 'discogs-selected-heading';
                      chooseAlbum(album, false);
                    }}>Remove</button>
                </div>
              </li>;
            })}
          </ul>
          <div ref={signoffBar} className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-[var(--rh-surface)] py-2">
            <SaveShelfSelect value={destination} disabled={busy}
              onChange={shelf => { if (!operationInProgress.current) rememberDraft({ ...draftForReview(), destination: shelf }); }} />
            <button type="button" className={secondaryAction} onClick={backToSelections}>Back to selections</button>
            <button id="discogs-import-commit" type="button" className={primaryAction} disabled={!canReviewSelection}
              aria-describedby="discogs-signoff-count discogs-signoff-scope" onClick={confirmSelectionImport}>
              Import {counted(selected.length, 'title')} to {shelfNames[destination]}
            </button>
          </div>
        </section>}
        <div hidden={reviewingSelection} className="space-y-4 p-4 sm:p-6">
          {(summary || progressText) && <p className="text-sm font-medium text-gray-900" role="status">{progressText ?? summary}</p>}
          {(stopping || progress || stopped) && <p className="text-sm text-gray-600" role="status">
            {stopping ? 'The current record will finish, then the import will stop.'
              : progress ? 'The import continues if you close this window.'
                : 'Import stopped. The outcomes below are kept.'}
          </p>}
          {storageFailed && <p role="status" className="text-sm text-gray-600">This tab cannot keep import progress after a reload.</p>}
          {reviewStorageFailed && <p role="status" className="text-sm text-gray-600">This tab could not save review changes for reload.</p>}
          {recoveryText && <p role={recovery === 'error' ? 'alert' : 'status'} className="text-sm text-gray-600">{recoveryText}</p>}
          {!hasCatalog && fetchFailed && <p className="text-sm text-red-600" role="alert">{pageFailure}</p>}
          {!hasCatalog && fetchStatus === 'canceled' && <p className="text-sm text-gray-600" role="status">Discogs page load canceled.</p>}

          {!hasCatalog && draft ? (
            <section className="space-y-2" aria-label="Saved Discogs review">
              <p ref={reviewHeading} tabIndex={-1} className="text-sm font-semibold text-gray-900">Saved review · {draftSummary}</p>
              <p id="discogs-review-status" className="text-sm text-gray-600" role={reviewCheck === 'failed' ? 'alert' : 'status'}>
                {reviewStatus ?? 'Resume to refresh the Discogs pages you reviewed and check both shelves.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {reviewRefreshButton(primaryAction, 'Resume review')}
                {discardControl(secondaryAction)}
              </div>
            </section>
          ) : !hasCatalog ? (
            <div className={entries.length ? 'space-y-2' : 'py-8 text-center sm:py-12'}>
              <p ref={reviewHeading} tabIndex={-1} className="text-sm font-medium text-gray-900" role="status">
                {fetchStatus === 'loading' ? 'Loading your Discogs collection…' : 'Review your Discogs collection'}
              </p>
              <p className="mb-3 text-sm text-gray-600">Load records, then choose a shelf and the albums to import.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" className={primaryAction} onClick={() => void fetchCollection()} disabled={busy}>
                  {fetchStatus === 'idle' ? 'Load Discogs collection' : fetchStatus === 'loading' ? 'Loading…' : 'Reload Discogs collection'}
                </button>
                {fetchStatus === 'loading' && cancelPageButton}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p ref={reviewHeading} tabIndex={-1} className="text-sm font-medium" role="status">
                {remaining.length
                  ? `${counted(remaining.length, 'Discogs listing')} across ${counted(eligibleTitleCount, 'title')}${morePage ? ' on loaded pages' : ''}`
                  : morePage ? 'No new listings on the pages loaded so far.'
                    : entries.length ? 'No additional listings to import.' : 'No new listings to import.'}
              </p>
              {morePage && <p id="discogs-partial-import" className="text-sm text-gray-600">Later pages may contain alternate pressings.</p>}
              <div className="flex flex-wrap items-center gap-x-3">
                {reviewRefreshButton('rh-lookup-link text-left', 'Refresh reviewed pages')}
                {draft && discardControl('rh-lookup-link')}
              </div>
              {reviewStatus && <p id="discogs-review-status" className={`text-sm ${reviewCheck === 'failed' ? 'text-red-600' : 'text-gray-600'}`}
                role={reviewCheck === 'failed' ? 'alert' : 'status'}>{reviewStatus}</p>}
            </div>
          )}

          {hasCatalog && reviewNotices.length > 0 && <section className="space-y-1 border-y border-gray-200 py-2" aria-label="Changes to your Discogs selection">
            <p ref={noticesHeading} tabIndex={-1} className="text-sm font-medium text-gray-900" role="status">
              {[unresolvedCount ? `${counted(unresolvedCount, 'title')} ${unresolvedCount === 1 ? 'needs' : 'need'} your attention` : null,
                savedNoticeCount ? `${counted(savedNoticeCount, 'title')} already saved` : null].filter(Boolean).join(' · ')}
            </p>
            <ul className="divide-y divide-gray-200 text-sm text-gray-600 [overflow-wrap:anywhere]">
              {[...unresolvedNotices, ...savedNotices].map(notice => {
                const { choice } = notice;
                const title = titleKey(choice);
                const canReplace = notice.cause !== 'saved';
                const alternatives = canReplace && !processedTitles.has(title) ? pressingsByTitle.get(title) ?? [] : [];
                const headingId = alternatives.length ? pressingHeadingId(alternatives[0]) : undefined;
                const action = alternatives.length === 1 ? 'Review pressing' : 'Review pressings';
                const originalAvailable = alternatives.some(album => album.discogsId === choice.discogsId);
                const reason = notice.cause === 'saved' ? `Already in ${shelfNames[notice.shelf]}.`
                  : !headingId || (notice.cause === 'unavailable' && !originalAvailable) ? 'Unavailable on the refreshed pages.'
                    : alternatives.length > 1 ? 'Another pressing appeared.' : 'One pressing is available to review.';
                return <li key={choice.discogsId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 py-1">
                  <p className="min-w-0 text-sm">
                    <strong className="font-semibold text-gray-900">{choice.album}</strong> by {choice.artist} · Discogs {choice.discogsId}. {reason}
                    {canReplace && !headingId && morePage && ' Load more records to keep looking.'}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2">
                    {headingId && <a href={`#${headingId}`} className="rh-lookup-link inline-grid text-left"
                      aria-label={`${action} for ${choice.album} by ${choice.artist}`}
                      onClick={event => {
                        event.preventDefault();
                        setActivePressingReview(title);
                        jumpToReviewTarget(headingId);
                      }}>{action}</a>}
                    <button type="button" className="min-h-11 rounded-lg px-2 text-left text-sm text-gray-600 hover:bg-gray-100" disabled={busy}
                      aria-label={`Dismiss review notice for ${choice.album} by ${choice.artist}`} onClick={() => dismissNotice(title)}>Dismiss notice</button>
                  </div>
                </li>;
              })}
            </ul>
          </section>}

          {(hasCatalog || retryJobs.length > 0 || resumeJobs.length > 0 || recovery === 'error' ||
            (progress && progress.current < progress.total)) && (
            <div id="discogs-import-choices" tabIndex={-1} role="group" aria-label="Import choices" className="flex min-w-0 flex-wrap items-center gap-2">
              {recovery === 'error' && <button type="button" className={secondaryAction} disabled={busy} onClick={() => {
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
              {remaining.length > 0 && <div className="grid w-full min-w-0 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-1">
                  <label className="grid max-w-sm gap-1 text-sm font-semibold">
                    Find loaded titles
                    <input id="discogs-import-filter" className="min-h-11 min-w-0 rounded-lg border border-gray-300 px-2 font-normal"
                      type="search" placeholder="Artist or title" value={titleFilter} disabled={busy}
                      onChange={event => changeBrowseFilters(event.currentTarget.value, needsChoiceOnly)} />
                  </label>
                  {individualTitleCount > 0 && <p className="text-sm text-gray-600">
                    {counted(individualTitleCount, 'title')} excluded from bulk selection.
                  </p>}
                  <div className="flex flex-wrap items-center gap-1">
                    {unselectedEligible.length > 0 && <button type="button" className={secondaryAction} disabled={busy} onClick={chooseAll}>
                      Select all eligible {queryTerms.length ? 'matching' : 'loaded'} titles ({unselectedEligible.length} to add)
                    </button>}
                    {(selected.length > 0 || clearedSelection) && <button type="button" className="rh-lookup-link text-left"
                      disabled={busy || (!!clearedSelection && reviewCheck !== 'ready')} onClick={clearOrUndoSelection}>
                      {clearedSelection ? 'Undo clear selection' : 'Clear selection'}
                    </button>}
                  </div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <SaveShelfSelect value={progress?.destination ?? destination} disabled={busy || resumeJobs.length > 0}
                    onChange={shelf => { if (!operationInProgress.current) rememberDraft({ ...draftForReview(), destination: shelf }); }} />
                </div>
              </div>}
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

          {(queryTerms.length > 0 || needsChoiceOnly) && <div className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
            <p id="discogs-pressing-filter-scope" role="status">
              {needsChoiceOnly && queryTerms.length > 0
                ? `${counted(needingChoice.size, 'loaded title')} ${needingChoice.size === 1 ? 'needs' : 'need'} a pressing choice. ${counted(matchingNeeds.length, 'title')} ${matchingNeeds.length === 1 ? 'matches' : 'match'} your search within that group.`
                : needsChoiceOnly ? `Showing ${counted(matchingNeeds.length, 'loaded title')} that ${matchingNeeds.length === 1 ? 'needs' : 'need'} a pressing choice.`
                  : filteredTitleGroups.length ? `Showing ${counted(filteredTitleGroups.length, 'matching title')}` : 'No loaded titles match your search.'}
            </p>
            {queryTerms.length > 0 && needsChoiceOnly && <button type="button" className="rh-lookup-link" onClick={() => {
              focusPressingFilter.current = true;
              changeBrowseFilters('', true);
            }}>Clear artist/title search</button>}
            <button type="button" className="rh-lookup-link" onClick={() => {
              changeBrowseFilters('', false);
              jumpToReviewTarget('discogs-import-filter');
            }}>Clear filters</button>
          </div>}
          {visibleTitleGroups.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visibleTitleGroups.map(([title, pressings]) => {
              const first = pressings[0];
              if (pressings.length === 1) return renderRecord(first);
              const headingId = pressingHeadingId(first);
              const canChoose = !processedTitles.has(title);
              const selectedPressing = pressings.find(album => selectedIds.has(album.discogsId));
              const choices = <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {pressings.map(album => renderRecord(album, `${headingId}-choice`))}
              </div>;
              return <section key={title} className="col-span-full space-y-2 border-y border-gray-200 py-3"
                aria-label={`Pressings of ${first.album} by ${first.artist}`}>
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <h3 id={headingId} tabIndex={-1} aria-describedby={`${headingId}-details`}
                    className="text-sm font-semibold text-gray-900">{first.album}</h3>
                  <p id={`${headingId}-details`} className="text-sm text-gray-600">
                    {first.artist} · {pressings.length} pressings{canChoose && ' · Choose one pressing'}
                  </p>
                  {temporaryTitle === title && <p className="text-sm text-gray-600">Shown from signoff. Your filters are still active.</p>}
                </div>
                {canChoose ? <fieldset className="min-w-0 space-y-2 border-0 p-0">
                  <legend className="sr-only">Choose a pressing for {first.album} by {first.artist}</legend>
                  <ImportPressingEvidence pressings={pressings} onChoose={releaseId => jumpToReviewTarget(`discogs-import-release-${releaseId}`)} disabled={busy} />
                  {choices}
                  {selectedPressing && <button type="button" className="rh-lookup-link text-left" disabled={busy}
                    aria-label={`Clear pressing choice for ${first.album} by ${first.artist}`}
                    onClick={() => {
                      chooseAlbum(selectedPressing, false);
                      jumpToReviewTarget(headingId);
                    }}>Clear pressing choice</button>}
                </fieldset> : choices}
                {temporaryTitle === title && <button type="button" className="rh-lookup-link" onClick={() => {
                  setSignoffTarget(undefined);
                  jumpToReviewTarget('discogs-import-filter');
                }}>Return to filtered titles</button>}
                {activePressingReview === title && !selectedPressing && importChoicesLink('Back to import choices')}
              </section>;
            })}
          </div>}
        </div>
        {hasCatalog && !reviewingSelection && <footer ref={continuationBar} aria-label="Discogs import controls"
          className="rh-discogs-import-dock">
          <div className="rh-discogs-import-dock-status flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-gray-600">
            <p id="discogs-page-coverage" ref={coverageHeading} tabIndex={-1} className="font-semibold text-gray-900" role="status">
              <span className="rh-discogs-dock-wide">{coverageText}</span>
              <span className="rh-discogs-dock-short">{shortCoverageText}</span>
            </p>
            <p id="discogs-selection-count" role="status">{selected.length} selected · {shelfNames[destination]}</p>
            {fetchFailed && <p className="basis-full text-red-600" role="alert">{pageFailure}</p>}
            {fetchStatus === 'canceled' && <p className="basis-full" role="status">Page load canceled. Your review is kept.</p>}
          </div>
          <div className="rh-discogs-import-dock-actions">
            {(morePage || pageNotLoaded || fetchStatus === 'loading') && (
              <button type="button" className={`${secondaryAction} aria-disabled:opacity-55`}
                aria-label={pageActionLabel} aria-disabled={busy || reviewCheck !== 'ready'}
                aria-busy={fetchStatus === 'loading'} aria-describedby="discogs-page-coverage"
                onClick={() => { if (!busy && reviewCheck === 'ready') void fetchCollection(pageNotLoaded ? fetchPage : morePage ?? 1); }}>
                <span className="rh-discogs-dock-wide">{pageActionLabel}</span>
                <span className="rh-discogs-dock-short" aria-hidden="true">{compactPageActionLabel}</span>
              </button>
            )}
            {fetchStatus === 'loading' ? cancelPageButton : <>
              {(needingChoice.size > 0 || needsChoiceOnly) && <button type="button"
                className="rh-lookup-link aria-pressed:bg-gray-100"
                aria-label={`Needs a pressing choice (${needingChoice.size} loaded)`}
                aria-describedby={queryTerms.length > 0 || needsChoiceOnly ? 'discogs-pressing-filter-scope' : undefined}
                aria-pressed={needsChoiceOnly} disabled={busy} onClick={togglePressingFilter}>
                <span className="rh-discogs-dock-wide">Needs a pressing choice ({needingChoice.size})</span>
                <span className="rh-discogs-dock-short" aria-hidden="true">Needs pressing ({needingChoice.size})</span>
              </button>}
              {remaining.length > 0 && <button id="discogs-import-review" type="button" className={primaryAction}
                aria-label="Review selection" disabled={!canReviewSelection}
                aria-describedby={`discogs-selection-count discogs-page-coverage${morePage ? ' discogs-partial-import' : ''}${reviewStatus ? ' discogs-review-status' : ''}`}
                onClick={() => openSelectionReview('discogs-import-review')}>
                <span className="rh-discogs-dock-wide">Review selection</span>
                <span className="rh-discogs-dock-short" aria-hidden="true">Review</span>
              </button>}
            </>}
          </div>
        </footer>}
      </div>
    </ModalDialog>
  );
};
