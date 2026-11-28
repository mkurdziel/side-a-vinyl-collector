import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import api, { type Album, type PressingDetails, type SearchCoverArtQuery, type SearchCoverArtResult, getCoverArtUrl } from '../services/api';
import { discogsReleaseSource, savedCatalogSource, savedCopyLabel } from '../albumDisplay';
import { ModalDialog } from './ModalDialog';

interface AlbumDetailModalProps {
  album: Album;
  onClose: () => void;
  shelfActions?: ReactNode;
  onRefresh: (updatedAlbum?: Album) => void;
  onFindPressing?: (album: Album, opener: HTMLButtonElement) => void;
  backToMatches?: boolean;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

type PressingResult = { status: 'loading' | 'failed' } | { status: 'ready'; pressing: PressingDetails | null };
type ArtworkOperation = { kind: 'search' | 'save'; albumId: number };
type ArtworkNotice = 'empty' | 'failed' | 'updated';

function artworkRelease(source: SearchCoverArtResult['source'] | undefined, id: string | number | undefined) {
  if (source === 'Discogs' && typeof id === 'number') {
    const url = discogsReleaseSource(id)?.url;
    if (url) return { url, full: `Release ${id}`, visible: `Release ${id}` };
  }
  if (source === 'MusicBrainz' && typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return { url: `https://musicbrainz.org/release/${id}`, full: `Release ${id}`, visible: `Release ${id.slice(0, 8)}` };
  }
}

function artworkReference(candidate: SearchCoverArtResult, choices: SearchCoverArtResult[]) {
  const repeatedTitle = choices.some(other => other !== candidate && other.source === candidate.source
    && other.title.trim().toLowerCase() === candidate.title.trim().toLowerCase());
  if (repeatedTitle) return artworkRelease(candidate.source, candidate.id);
}

function artworkFromUrl(url: string | undefined, cached: boolean) {
  let image: URL | undefined;
  try {
    if (url) image = new URL(url);
  } catch {
    // A relative or malformed image URL provides no catalog provenance.
  }
  const host = image?.protocol === 'https:' || image?.protocol === 'http:' ? image.hostname : undefined;
  if (host === 'coverartarchive.org') {
    const releaseId = image?.pathname.match(/^\/release\/([^/]+)\//)?.[1];
    return { source: 'MusicBrainz Cover Art Archive', identified: true, release: artworkRelease('MusicBrainz', releaseId) };
  }
  if (host === 'discogs.com' || host?.endsWith('.discogs.com')) return { source: 'Discogs', identified: true };
  return { source: url ? 'External image' : cached ? 'Saved artwork' : 'Source unlisted', identified: false };
}

function ArtworkFigure({ label, title, source, sourceIdentified = true, year, release, dimensions, unavailable, children }: {
  label: string;
  title?: string;
  source: string;
  sourceIdentified?: boolean;
  year?: number;
  release?: ReturnType<typeof artworkRelease>;
  dimensions?: string;
  unavailable?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  const hasYear = typeof year === 'number' && year > 0;
  const gap = [!sourceIdentified && 'artwork provider', !title && 'artwork title', !hasYear && 'release year', !release && 'release link']
    .filter(part => typeof part === 'string');
  return (
    <figure aria-labelledby={headingId} className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
      <figcaption id={headingId} className="text-sm font-semibold">{label}</figcaption>
      <div className="aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
        {unavailable ? <p className="grid h-full place-items-center p-2 text-center text-xs text-gray-600">Image unavailable</p> : children}
      </div>
      <div className="space-y-0.5 text-xs text-gray-600">
        {title && <p className="text-sm font-medium text-gray-900">{title}</p>}
        <p>{source}{hasYear && <> · <span className="sr-only">Release year </span>{year}</>}{dimensions && ` · ${dimensions} px`}</p>
        {release && (
          <a className="rh-comparison-source" href={release.url} target="_blank" rel="noreferrer"
            aria-label={`${release.full} for ${label.toLowerCase()} (opens in a new tab)`}>
            {release.visible}
          </a>
        )}
        {gap.length > 0 && <p>No {new Intl.ListFormat('en', { type: 'disjunction' }).format(gap)} available.</p>}
      </div>
    </figure>
  );
}

function SavedPressingEvidence({ releaseId, heading }: { releaseId: number; heading: RefObject<HTMLHeadingElement | null> }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<PressingResult>({ status: 'loading' });

  useEffect(() => {
    const request = new AbortController();
    void api.getPressingDetails(releaseId, request.signal).then(({ pressing }) => {
      if (!request.signal.aborted) setResult({ status: 'ready', pressing });
    }).catch(() => {
      if (!request.signal.aborted) setResult({ status: 'failed' });
    });
    return () => request.abort();
  }, [releaseId, attempt]);

  const pressing = result.status === 'ready' ? result.pressing : null;
  const fields = [
    ['Catalog number', pressing?.catalogNumber?.trim()],
    ['Label', pressing?.label?.trim()],
    ['Format', pressing?.format?.trim()],
    ['Country', pressing?.country?.trim()],
    ['Release year', pressing?.year],
  ].filter(([, value]) => value);

  const message = result.status === 'loading' ? 'Checking Discogs…'
    : result.status === 'failed' ? 'Couldn’t load saved pressing details.'
      : fields.length ? 'Saved pressing details loaded.' : 'Discogs has no pressing details for this release.';

  return (
    <>
      <p role="status" className={fields.length ? 'sr-only' : 'text-sm text-gray-600'}>{message}</p>
      {result.status === 'failed' && (
        <button type="button" className="rh-lookup-link -ml-2 w-fit" onClick={() => {
          heading.current?.focus({ preventScroll: true });
          setResult({ status: 'loading' });
          setAttempt(current => current + 1);
        }}>Retry pressing details</button>
      )}
      {fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {fields.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-gray-600">{label}</dt>
              <dd className="font-medium text-gray-900">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

export const AlbumDetailModal = ({ album, onClose, onRefresh, onFindPressing, shelfActions, backToMatches, returnFocusTo }: AlbumDetailModalProps) => {
  const [refetching, setRefetching] = useState(false);
  const [currentAlbum, setCurrentAlbum] = useState<Album>(album);
  const [receivedAlbum, setReceivedAlbum] = useState(album);

  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [selectedArtwork, setSelectedArtwork] = useState<SearchCoverArtResult>();
  const [currentArtwork, setCurrentArtwork] = useState<SearchCoverArtResult>();
  const [candidates, setCandidates] = useState<SearchCoverArtResult[]>([]);
  const [imageDimensions, setImageDimensions] = useState<Record<string, string>>({});
  const [savingArtwork, setSavingArtwork] = useState(false);
  const [artworkNotice, setArtworkNotice] = useState<ArtworkNotice>();
  const [lastArtworkQuery, setLastArtworkQuery] = useState<SearchCoverArtQuery>();
  const [artworkResultsQuery, setArtworkResultsQuery] = useState<SearchCoverArtQuery>();
  const [artworkQueryDraft, setArtworkQueryDraft] = useState<SearchCoverArtQuery>();
  const [artworkSaveFailed, setArtworkSaveFailed] = useState(false);
  const [failedCoverUrl, setFailedCoverUrl] = useState('');
  const savedPressingHeadingId = useId();
  const artworkNoticeId = useId();
  const artworkChooserId = useId();
  const artworkQueryId = useId();
  const savedPressingHeading = useRef<HTMLHeadingElement>(null);
  const artworkButtonRef = useRef<HTMLButtonElement>(null);
  const artworkArtistField = useRef<HTMLInputElement>(null);
  const editArtworkButton = useRef<HTMLButtonElement>(null);
  const artworkChooserHeading = useRef<HTMLHeadingElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const candidateButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoreCandidate = useRef<string | undefined>(undefined);
  const artworkOperation = useRef<ArtworkOperation | undefined>(undefined);
  const coverVersion = currentAlbum.local_cover_path ? `?v=${encodeURIComponent(currentAlbum.local_cover_path)}` : '';
  const coverUrl = getCoverArtUrl(currentAlbum.id) + coverVersion;

  // Reset local artwork edits when the parent supplies a different album value.
  // React retries this render before committing children, avoiding a stale frame.
  if (receivedAlbum !== album) {
    setReceivedAlbum(album);
    setCurrentAlbum(album);
    if (receivedAlbum.id !== album.id) {
      setShowSelectionModal(false);
      setSelectedArtwork(undefined);
      setCurrentArtwork(undefined);
      setRefetching(false);
      setSavingArtwork(false);
      setArtworkNotice(undefined);
      setLastArtworkQuery(undefined);
      setArtworkResultsQuery(undefined);
      setArtworkQueryDraft(undefined);
      setArtworkSaveFailed(false);
    }
  }

  useLayoutEffect(() => () => {
    artworkOperation.current = undefined;
    restoreCandidate.current = undefined;
  }, [album.id]);

  const editingArtworkQuery = artworkQueryDraft !== undefined;
  useLayoutEffect(() => {
    if (editingArtworkQuery) artworkArtistField.current?.focus();
  }, [editingArtworkQuery]);

  useLayoutEffect(() => {
    if (showSelectionModal && artworkResultsQuery) artworkChooserHeading.current?.focus();
  }, [showSelectionModal, artworkResultsQuery]);

  useLayoutEffect(() => {
    if (selectedArtwork) previewHeading.current?.focus();
    else if (restoreCandidate.current) {
      const candidate = candidateButtons.current.get(restoreCandidate.current);
      if (candidate && !candidate.disabled) candidate.focus();
      else artworkChooserHeading.current?.focus();
      restoreCandidate.current = undefined;
    }
  }, [selectedArtwork]);

  const handleSearchArtwork = async (query?: SearchCoverArtQuery) => {
    if (artworkOperation.current) return;
    const operation: ArtworkOperation = { kind: 'search', albumId: currentAlbum.id };
    artworkOperation.current = operation;
    const requestedQuery = query ?? { artist: currentAlbum.artist_name, title: currentAlbum.title };
    setLastArtworkQuery(requestedQuery);
    setRefetching(true);
    setArtworkNotice(undefined);
    try {
      const data = await (query ? api.searchCoverArt(operation.albumId, query) : api.searchCoverArt(operation.albumId));
      if (artworkOperation.current !== operation) return;
      const results = data.results ?? [];
      const matchesCurrent = results.filter(candidate => candidate.url === currentAlbum.cover_image_url);
      if (matchesCurrent.length === 1) setCurrentArtwork(matchesCurrent[0]);
      const seen = new Set([currentAlbum.cover_image_url]);
      const alternatives = results.filter(candidate => {
        if (seen.has(candidate.url)) return false;
        seen.add(candidate.url);
        return true;
      });
      if (alternatives.length) {
        setCandidates(alternatives);
        setArtworkResultsQuery(requestedQuery);
        setImageDimensions({});
        setSelectedArtwork(undefined);
        setArtworkSaveFailed(false);
        setShowSelectionModal(true);
      } else {
        setArtworkNotice('empty');
      }
    } catch {
      if (artworkOperation.current === operation) setArtworkNotice('failed');
    } finally {
      if (artworkOperation.current === operation) {
        artworkOperation.current = undefined;
        setRefetching(false);
      }
    }
  };

  const closeArtworkPicker = () => {
    if (artworkOperation.current?.kind === 'save') return;
    if (artworkOperation.current?.kind === 'search') {
      artworkOperation.current = undefined;
      setRefetching(false);
    }
    setArtworkNotice(undefined);
    setArtworkQueryDraft(undefined);
    setSelectedArtwork(undefined);
    setShowSelectionModal(false);
  };

  const backToArtworkChoices = () => {
    if (!selectedArtwork || artworkOperation.current?.kind === 'save') return;
    restoreCandidate.current = selectedArtwork.url;
    setArtworkSaveFailed(false);
    setSelectedArtwork(undefined);
  };

  const selectedDimensions = selectedArtwork && imageDimensions[selectedArtwork.url];
  const canApplyArtwork = !!selectedDimensions && selectedDimensions !== 'Unavailable' && !savingArtwork;

  const applyArtwork = async () => {
    if (!selectedArtwork || !canApplyArtwork || artworkOperation.current) return;
    const operation: ArtworkOperation = { kind: 'save', albumId: currentAlbum.id };
    artworkOperation.current = operation;
    setSavingArtwork(true);
    setArtworkSaveFailed(false);
    try {
      const data = await api.updateCoverArt(operation.albumId, selectedArtwork.url, selectedArtwork.source);
      if (artworkOperation.current !== operation) return;
      const updatedAlbum = { ...currentAlbum, ...data.album };

      setCurrentAlbum(updatedAlbum);
      setCurrentArtwork(selectedArtwork);
      setArtworkNotice('updated');
      setSelectedArtwork(undefined);
      setShowSelectionModal(false);
      onRefresh(updatedAlbum);
    } catch {
      if (artworkOperation.current === operation) setArtworkSaveFailed(true);
    } finally {
      if (artworkOperation.current === operation) {
        artworkOperation.current = undefined;
        setSavingArtwork(false);
      }
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const currentImage = artworkFromUrl(currentAlbum.cover_image_url, !!currentAlbum.local_cover_path);
  const knownArtwork = currentArtwork?.url === currentAlbum.cover_image_url ? currentArtwork : undefined;
  const artworkSource = knownArtwork?.source ?? currentImage.source;

  const source = savedCatalogSource(currentAlbum);
  const pressingId = source?.kind === 'pressing' ? currentAlbum.discogs_id : undefined;
  const startArtworkSearch = () => {
    if (refetching) return;
    if (artworkNotice === 'empty' && lastArtworkQuery) {
      if (artworkQueryDraft) artworkArtistField.current?.focus();
      else setArtworkQueryDraft(lastArtworkQuery);
    } else void handleSearchArtwork(artworkNotice === 'failed' ? lastArtworkQuery : undefined);
  };
  const closeArtworkQuery = () => {
    setArtworkQueryDraft(undefined);
    (showSelectionModal ? editArtworkButton : artworkButtonRef).current?.focus();
  };
  const recordDimensions = (url: string, image: HTMLImageElement) => {
    const { naturalWidth, naturalHeight } = image;
    const dimensions = naturalWidth > 0 && naturalHeight > 0 ? `${naturalWidth} × ${naturalHeight}` : 'Unavailable';
    setImageDimensions(previous => ({ ...previous, [url]: dimensions }));
  };
  const markArtworkUnavailable = (url: string) => setImageDimensions(previous => ({ ...previous, [url]: 'Unavailable' }));
  const artworkQueryEditor = artworkQueryDraft && (
    <form id={artworkQueryId} aria-label="Edit artwork search" className="grid w-full min-w-0 gap-3 rounded-lg border border-gray-300 p-3"
      onSubmit={event => {
        event.preventDefault();
        const artist = artworkQueryDraft.artist.trim();
        const title = artworkQueryDraft.title.trim();
        if (!artist || !title || refetching) return;
        closeArtworkQuery();
        void handleSearchArtwork({ artist, title });
      }}>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-sm font-medium">Artist
          <input ref={artworkArtistField} type="text" name="artist" required maxLength={255} value={artworkQueryDraft.artist}
            onChange={event => {
              const artist = event.currentTarget.value;
              setArtworkQueryDraft(current => current && { ...current, artist });
            }} className="min-h-11 w-full min-w-0 rounded-lg border border-gray-300 bg-gray-50 px-3 text-base" />
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-medium">Album title
          <input type="text" name="title" required maxLength={255} value={artworkQueryDraft.title}
            onChange={event => {
              const title = event.currentTarget.value;
              setArtworkQueryDraft(current => current && { ...current, title });
            }} className="min-h-11 w-full min-w-0 rounded-lg border border-gray-300 bg-gray-50 px-3 text-base" />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="rh-lookup-link" onClick={closeArtworkQuery}>Cancel</button>
        <button type="submit" disabled={refetching || !artworkQueryDraft.artist.trim() || !artworkQueryDraft.title.trim()}
          className="rh-primary-action px-3 text-sm font-semibold disabled:opacity-60">Search artwork</button>
      </div>
    </form>
  );

  const emptyArtworkMessage = lastArtworkQuery && `No different cover art found for “${lastArtworkQuery.title}” by ${lastArtworkQuery.artist}.`;
  const detailArtworkNotice = showSelectionModal ? undefined : artworkNotice;
  return (
    <ModalDialog labelledBy="album-details-title" onClose={onClose}
      onEscape={editingArtworkQuery ? closeArtworkQuery : onClose} returnFocusTo={returnFocusTo}>
      <div className="rh-dialog-panel max-w-2xl">
        {/* Header */}
        <div className="rh-dialog-header flex flex-wrap items-center justify-between gap-x-2 border-b border-gray-200 p-4 sm:p-6">
          <h2 id="album-details-title" className="text-xl font-bold text-gray-900">Album details</h2>
          {backToMatches ? (
            <button type="button" onClick={onClose} className="rh-lookup-link">Back to matches</button>
          ) : <button
            onClick={onClose}
            className="rh-dialog-close"
            aria-label="Close album details"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>}
        </div>

        <div className="space-y-4 p-4 sm:space-y-5 sm:p-6">
          <div className="rh-details-identity">
            <div className="aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
              {failedCoverUrl !== coverUrl ? (
                <img src={coverUrl} alt="" className="size-full object-cover" onError={() => setFailedCoverUrl(coverUrl)} />
              ) : (
                <div className="flex h-full items-center justify-center p-1 text-center text-xs text-gray-600">Cover unavailable</div>
              )}
            </div>
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <h3 className="text-xl font-bold text-gray-900 sm:text-2xl">{currentAlbum.title}</h3>
              <p className="mt-1 text-base text-gray-600">{currentAlbum.artist_name}</p>
              <p className="mt-2 text-sm font-medium text-gray-700">
                {currentAlbum.status === 'wishlist' ? 'Wishlist' : 'Collection'}
                {currentAlbum.year ? ` · Saved year ${currentAlbum.year}` : ''}
              </p>
            </div>
          </div>

          <section aria-labelledby={savedPressingHeadingId} className="grid gap-2 border-t border-gray-200 pt-4 [overflow-wrap:anywhere]">
            <h4 id={savedPressingHeadingId} ref={savedPressingHeading} tabIndex={-1} className="font-semibold text-gray-900">Saved pressing</h4>
            {pressingId
              ? <SavedPressingEvidence key={pressingId} releaseId={pressingId} heading={savedPressingHeading} />
              : <p className="text-sm text-gray-600">Pressing unconfirmed</p>}
            {(onFindPressing || source?.url) && (
              <div className="-ml-2 flex flex-wrap items-center gap-x-2">
                {onFindPressing && <button type="button" aria-haspopup="dialog" className="rh-lookup-link text-left"
                  onClick={event => onFindPressing(currentAlbum, event.currentTarget)}>Review pressings</button>}
                {source?.url && (
                  <a className="rh-comparison-source" href={source.url} target="_blank" rel="noreferrer">
                    {pressingId ? `Discogs release ${pressingId}` : `${source.label} · ${source.type}`}
                    <span className="sr-only"> · {savedCopyLabel(currentAlbum)} (opens in a new tab)</span>
                  </a>
                )}
              </div>
            )}
          </section>

          {shelfActions && <div className="border-t border-gray-200 pt-3">{shelfActions}</div>}

          <dl className="grid grid-cols-2 gap-3 border-t border-gray-200 pt-4">
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <dt className="text-sm font-medium text-gray-700">Cover image source</dt>
              <dd className="text-sm text-gray-600">
                <p>{artworkSource}</p>
                {!currentAlbum.cover_art_fetched && (
                  <p className="mt-1"><span className="font-medium text-amber-600">Unverified artwork.</span> A fallback image may be shown until Side A finds a cover or you choose one.</p>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-700">First saved</dt>
              <dd className="text-sm text-gray-600">{formatDate(currentAlbum.added_at)}</dd>
            </div>
            {currentAlbum.notes && (
              <div className="col-span-full min-w-0">
                <dt className="text-sm font-medium text-gray-700">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-600 [overflow-wrap:anywhere]">{currentAlbum.notes}</dd>
              </div>
            )}
          </dl>

          <div className="grid justify-items-start gap-2">
            <button ref={artworkButtonRef} type="button" onClick={startArtworkSearch} aria-disabled={refetching}
              aria-busy={refetching} aria-describedby={detailArtworkNotice ? artworkNoticeId : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-100 aria-disabled:opacity-60">
              {refetching ? <><span className="rh-action-spinner" aria-hidden="true" />Searching for artwork…</>
                : detailArtworkNotice === 'failed' ? 'Retry artwork search'
                  : detailArtworkNotice === 'empty' ? 'Edit artwork search' : 'Find different artwork'}
            </button>
            {detailArtworkNotice && <p id={artworkNoticeId} role={detailArtworkNotice === 'failed' ? 'alert' : 'status'}
              className={`text-sm [overflow-wrap:anywhere] ${detailArtworkNotice === 'failed' ? 'text-red-600' : 'text-gray-600'}`}>
              {detailArtworkNotice === 'failed' ? 'Couldn’t search for artwork. Try again.'
                : detailArtworkNotice === 'empty' ? emptyArtworkMessage : 'Artwork updated.'}
            </p>}
            {!showSelectionModal && artworkQueryEditor}
          </div>
        </div>
      </div>

      {showSelectionModal && (
        <ModalDialog labelledBy={artworkChooserId} onClose={closeArtworkPicker}
          onEscape={editingArtworkQuery ? closeArtworkQuery : selectedArtwork ? backToArtworkChoices : closeArtworkPicker} returnFocusTo={artworkButtonRef}>
          <div className="rh-dialog-panel max-w-4xl flex flex-col">
            <div className="rh-dialog-header flex flex-none flex-wrap items-center justify-between gap-x-2 border-b border-gray-200 px-4 py-2 sm:px-6">
              <h2 id={artworkChooserId} ref={selectedArtwork ? previewHeading : artworkChooserHeading} tabIndex={-1}
                className="text-xl font-bold text-gray-900">{selectedArtwork ? 'Compare artwork' : 'Choose cover art'}</h2>
              <button type="button" onClick={closeArtworkPicker} aria-disabled={savingArtwork}
                className="rh-lookup-link aria-disabled:opacity-60">Keep current artwork</button>
            </div>

            {selectedArtwork ? <>
              <div className="min-h-0 space-y-3 overflow-y-auto p-4 sm:p-6">
                <div className="grid max-w-lg grid-cols-2 gap-3 sm:gap-5">
                  <ArtworkFigure label="Current artwork" title={knownArtwork?.title} source={artworkSource} year={knownArtwork?.year}
                    sourceIdentified={!!knownArtwork || currentImage.identified}
                    release={artworkRelease(knownArtwork?.source, knownArtwork?.id) ?? currentImage.release}
                    dimensions={imageDimensions[coverUrl] === 'Unavailable' ? undefined : imageDimensions[coverUrl]} unavailable={failedCoverUrl === coverUrl}>
                    <img src={coverUrl} alt="Cover currently saved for this album" className="size-full object-contain"
                      onLoad={event => recordDimensions(coverUrl, event.currentTarget)} onError={() => setFailedCoverUrl(coverUrl)} />
                  </ArtworkFigure>
                  <ArtworkFigure label="Selected artwork" title={selectedArtwork.title} source={selectedArtwork.source} year={selectedArtwork.year}
                    release={artworkRelease(selectedArtwork.source, selectedArtwork.id)}
                    dimensions={selectedDimensions === 'Unavailable' ? undefined : selectedDimensions} unavailable={selectedDimensions === 'Unavailable'}>
                    <img src={selectedArtwork.url} alt="Proposed replacement cover for this album" className="size-full object-contain"
                      onLoad={event => recordDimensions(selectedArtwork.url, event.currentTarget)} onError={() => markArtworkUnavailable(selectedArtwork.url)} />
                  </ArtworkFigure>
                </div>
                {!selectedDimensions && <p role="status" className="text-sm text-gray-600">Loading selected artwork…</p>}
                {selectedDimensions === 'Unavailable' && <p role="alert" className="text-sm text-red-600">Couldn’t load this cover. Choose another or keep your current artwork.</p>}
              </div>
              <div className="flex flex-none flex-wrap items-center justify-end gap-x-2 border-t border-gray-200 px-4 py-2 sm:px-6">
                {savingArtwork && <p role="status" className="basis-full text-sm text-gray-600">Updating artwork…</p>}
                {artworkSaveFailed && <p role="alert" className="basis-full text-sm text-red-600">Couldn’t update the artwork. Try applying it again or keep your current artwork.</p>}
                <button type="button" onClick={backToArtworkChoices} aria-disabled={savingArtwork}
                  className="rh-lookup-link aria-disabled:opacity-60">Back to choices</button>
                <button type="button" onClick={() => void applyArtwork()} aria-disabled={!canApplyArtwork} aria-busy={savingArtwork}
                  className="rh-primary-action px-3 text-sm font-semibold aria-disabled:opacity-60">
                  {savingArtwork ? 'Applying artwork…' : 'Apply artwork'}
                </button>
              </div>
            </> : <div className="min-h-0 space-y-3 overflow-y-auto p-4 sm:p-6">
              <div className="grid min-w-0 gap-2 border-b border-gray-200 pb-3 [overflow-wrap:anywhere]">
                <div className="flex flex-wrap items-center justify-between gap-x-3">
                  {artworkResultsQuery && <p className="min-w-0 flex-1 basis-36 text-sm text-gray-600">
                    Results for <strong className="font-medium text-gray-900">“{artworkResultsQuery.title}”</strong> by {artworkResultsQuery.artist}
                  </p>}
                  <button ref={editArtworkButton} type="button" className="rh-lookup-link -ml-2 text-left aria-disabled:opacity-60 sm:ml-0"
                    aria-expanded={editingArtworkQuery} aria-controls={editingArtworkQuery ? artworkQueryId : undefined} aria-disabled={refetching}
                    onClick={() => {
                      if (refetching) return;
                      if (editingArtworkQuery) artworkArtistField.current?.focus();
                      else setArtworkQueryDraft(lastArtworkQuery ?? artworkResultsQuery);
                    }}>Edit artwork search</button>
                </div>
                {artworkQueryEditor}
                {refetching && <p role="status" className="text-sm text-gray-600">Searching for artwork…</p>}
                {artworkNotice === 'empty' && <p role="status" className="text-sm text-gray-600">{emptyArtworkMessage} Previous results are still available.</p>}
                {artworkNotice === 'failed' && (
                  <div className="flex flex-wrap items-center gap-x-2">
                    <p role="alert" className="min-w-0 flex-1 basis-44 text-sm text-red-600">
                      {lastArtworkQuery ? `Couldn’t search for “${lastArtworkQuery.title}” by ${lastArtworkQuery.artist}.` : 'Couldn’t search for artwork.'} Previous results are still available.
                    </p>
                    <button type="button" className="rh-lookup-link" onClick={() => {
                      closeArtworkQuery();
                      void handleSearchArtwork(lastArtworkQuery);
                    }}>Retry artwork search</button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                {failedCoverUrl !== coverUrl && <img src={coverUrl} alt="" className="size-12 rounded object-cover"
                  onError={() => setFailedCoverUrl(coverUrl)} />}
                <p className="font-medium">{failedCoverUrl === coverUrl ? 'Current artwork unavailable' : 'Current artwork'}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {candidates.map(candidate => {
                  const key = candidate.url;
                  const dimensions = imageDimensions[key];
                  const failed = dimensions === 'Unavailable';
                  const reference = artworkReference(candidate, candidates);
                  const evidence = [candidate.year, dimensions && !failed ? `${dimensions} px` : undefined, reference?.full].filter(Boolean);
                  const accessibleName = [`Preview ${candidate.title} cover from ${candidate.source}`, ...evidence].join(', ');

                  return (
                    <button
                      type="button"
                      ref={button => {
                        if (button) candidateButtons.current.set(key, button);
                        else candidateButtons.current.delete(key);
                      }}
                      key={key}
                      className="group min-w-0 cursor-pointer rounded-lg text-left disabled:cursor-default"
                      disabled={failed || refetching}
                      onClick={() => {
                        if (failed || refetching) return;
                        setArtworkQueryDraft(undefined);
                        setSelectedArtwork(candidate);
                      }}
                      aria-label={accessibleName}
                    >
                      <span className="block aspect-square overflow-hidden rounded-lg border border-gray-300 bg-gray-100 group-hover:border-purple-500">
                        {failed ? (
                          <span className="grid h-full place-items-center px-2 text-xs text-gray-400">Image unavailable</span>
                        ) : (
                          <img
                            src={candidate.url}
                            alt=""
                            loading="lazy"
                            className="w-full h-full object-cover"
                            onLoad={event => recordDimensions(key, event.currentTarget)}
                            onError={() => markArtworkUnavailable(key)}
                          />
                        )}
                      </span>
                      <span className="block pt-2 [overflow-wrap:anywhere]">
                        <span className="block text-sm font-medium text-gray-900">{candidate.title}</span>
                        <span className="block text-xs text-gray-600">{candidate.source}{candidate.year ? ` · ${candidate.year}` : ''}</span>
                        {!failed && dimensions && <span className="block text-xs text-gray-600">{dimensions} px</span>}
                        {reference && <span title={reference.full} className="block text-xs text-gray-600">{reference.visible}</span>}
                        {failed ? null : (
                          <span className="mt-1 block text-sm font-medium text-purple-700">
                            Preview cover
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>}
          </div>
        </ModalDialog>
      )}
    </ModalDialog>
  );
};
