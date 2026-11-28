import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import api, { type Album, type PressingDetails, type SearchCoverArtQuery, type SearchCoverArtResult, getCoverArtUrl } from '../services/api';
import { savedCatalogSource, savedCopyLabel } from '../albumDisplay';
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

function artworkReference(candidate: SearchCoverArtResult, choices: SearchCoverArtResult[]) {
  const repeatedTitle = choices.some(other => other !== candidate && other.source === candidate.source
    && other.title.trim().toLowerCase() === candidate.title.trim().toLowerCase());
  if (!repeatedTitle) return;
  return { full: `Release ${candidate.id}`, visible: `Release ${candidate.source === 'MusicBrainz' ? String(candidate.id).slice(0, 8) : candidate.id}` };
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
  const [candidates, setCandidates] = useState<SearchCoverArtResult[]>([]);
  const [imageDimensions, setImageDimensions] = useState<Record<string, string>>({});
  const [savingArtwork, setSavingArtwork] = useState(false);
  const [artworkNotice, setArtworkNotice] = useState<ArtworkNotice>();
  const [lastArtworkQuery, setLastArtworkQuery] = useState<SearchCoverArtQuery>();
  const [artworkQueryDraft, setArtworkQueryDraft] = useState<SearchCoverArtQuery>();
  const [artworkSaveFailed, setArtworkSaveFailed] = useState(false);
  const [failedCoverUrl, setFailedCoverUrl] = useState('');
  const savedPressingHeadingId = useId();
  const artworkNoticeId = useId();
  const artworkChooserId = useId();
  const savedPressingHeading = useRef<HTMLHeadingElement>(null);
  const artworkButtonRef = useRef<HTMLButtonElement>(null);
  const artworkArtistField = useRef<HTMLInputElement>(null);
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
      setRefetching(false);
      setSavingArtwork(false);
      setArtworkNotice(undefined);
      setLastArtworkQuery(undefined);
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
    setLastArtworkQuery(query ?? { artist: currentAlbum.artist_name, title: currentAlbum.title });
    setRefetching(true);
    setArtworkNotice(undefined);
    try {
      const data = await (query ? api.searchCoverArt(operation.albumId, query) : api.searchCoverArt(operation.albumId));
      if (artworkOperation.current !== operation) return;
      const seen = new Set([currentAlbum.cover_image_url]);
      const alternatives = (data.results ?? []).filter(candidate => {
        if (seen.has(candidate.url)) return false;
        seen.add(candidate.url);
        return true;
      });
      if (alternatives.length) {
        setCandidates(alternatives);
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
  const selectedReference = selectedArtwork && artworkReference(selectedArtwork, candidates);
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

  const artworkUrl = currentAlbum.cover_image_url;
  const artworkSource = artworkUrl?.includes('coverartarchive.org')
    ? 'MusicBrainz Cover Art Archive'
    : artworkUrl?.includes('discogs.com')
      ? 'Discogs'
      : artworkUrl
        ? 'External image'
        : currentAlbum.local_cover_path ? 'Saved artwork' : 'No cover art';

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
    artworkButtonRef.current?.focus();
  };
  const recordDimensions = (url: string, image: HTMLImageElement) => {
    const { naturalWidth, naturalHeight } = image;
    setImageDimensions(previous => ({ ...previous, [url]: `${naturalWidth} × ${naturalHeight}` }));
  };
  const markArtworkUnavailable = (url: string) => setImageDimensions(previous => ({ ...previous, [url]: 'Unavailable' }));
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
              aria-busy={refetching} aria-describedby={artworkNotice ? artworkNoticeId : undefined}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-100 aria-disabled:opacity-60">
              {refetching ? <><span className="rh-action-spinner" aria-hidden="true" />Searching for artwork…</>
                : artworkNotice === 'failed' ? 'Retry artwork search'
                  : artworkNotice === 'empty' ? 'Edit artwork search' : 'Find different artwork'}
            </button>
            {artworkNotice && <p id={artworkNoticeId} role={artworkNotice === 'failed' ? 'alert' : 'status'}
              className={`text-sm ${artworkNotice === 'failed' ? 'text-red-600' : 'text-gray-600'}`}>
              {artworkNotice === 'failed' ? 'Couldn’t search for artwork. Try again.'
                : artworkNotice === 'empty' && lastArtworkQuery
                  ? `No different cover art found for “${lastArtworkQuery.title}” by ${lastArtworkQuery.artist}.`
                  : 'Artwork updated.'}
            </p>}
            {artworkQueryDraft && <form className="grid w-full min-w-0 gap-2 rounded-lg border border-gray-300 p-3" onSubmit={event => {
              event.preventDefault();
              const artist = artworkQueryDraft.artist.trim();
              const title = artworkQueryDraft.title.trim();
              if (!artist || !title) return;
              closeArtworkQuery();
              void handleSearchArtwork({ artist, title });
            }}>
              <label className="grid gap-1 text-sm font-medium">Artist
                <input ref={artworkArtistField} type="text" name="artist" required maxLength={255} value={artworkQueryDraft.artist}
                  onChange={event => {
                    const artist = event.currentTarget.value;
                    setArtworkQueryDraft(current => current && { ...current, artist });
                  }} className="min-h-11 min-w-0 rounded-lg border border-gray-300 bg-gray-50 px-3 text-base" />
              </label>
              <label className="grid gap-1 text-sm font-medium">Album title
                <input type="text" name="title" required maxLength={255} value={artworkQueryDraft.title}
                  onChange={event => {
                    const title = event.currentTarget.value;
                    setArtworkQueryDraft(current => current && { ...current, title });
                  }} className="min-h-11 min-w-0 rounded-lg border border-gray-300 bg-gray-50 px-3 text-base" />
              </label>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" className="rh-lookup-link" onClick={closeArtworkQuery}>Cancel</button>
                <button type="submit" disabled={!artworkQueryDraft.artist.trim() || !artworkQueryDraft.title.trim()}
                  className="rh-primary-action px-3 text-sm font-semibold disabled:opacity-60">Search artwork</button>
              </div>
            </form>}
          </div>
        </div>
      </div>

      {showSelectionModal && (
        <ModalDialog labelledBy={artworkChooserId} onClose={closeArtworkPicker}
          onEscape={selectedArtwork ? backToArtworkChoices : closeArtworkPicker} returnFocusTo={artworkButtonRef}>
          <div className="rh-dialog-panel max-w-4xl flex flex-col">
            <div className="rh-dialog-header flex flex-none flex-wrap items-center justify-between gap-x-2 border-b border-gray-200 px-4 py-2 sm:px-6">
              <h2 id={artworkChooserId} ref={artworkChooserHeading} tabIndex={-1} className="text-xl font-bold text-gray-900">Choose cover art</h2>
              <button type="button" onClick={closeArtworkPicker} aria-disabled={savingArtwork}
                className="rh-lookup-link aria-disabled:opacity-60">Keep current artwork</button>
            </div>

            {selectedArtwork ? <div className="min-h-0 space-y-3 overflow-y-auto p-4 sm:p-6">
              <h3 ref={previewHeading} tabIndex={-1} className="text-base font-semibold">Compare artwork</h3>
              <div className="grid max-w-lg grid-cols-2 gap-3">
                <figure className="min-w-0">
                  <div className="aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {failedCoverUrl === coverUrl ? <p className="grid h-full place-items-center px-2 text-center text-xs text-gray-600">Image unavailable</p>
                      : <img src={coverUrl} alt="" className="size-full object-contain" onError={() => setFailedCoverUrl(coverUrl)} />}
                  </div>
                  <figcaption className="mt-1 break-words text-sm font-medium">Current artwork</figcaption>
                </figure>
                <figure className="min-w-0">
                  <div className="aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {selectedDimensions === 'Unavailable' ? <p className="grid h-full place-items-center px-2 text-center text-xs text-gray-600">Image unavailable</p>
                      : <img src={selectedArtwork.url} alt="" className="size-full object-contain"
                        onLoad={event => recordDimensions(selectedArtwork.url, event.currentTarget)}
                        onError={() => markArtworkUnavailable(selectedArtwork.url)} />}
                  </div>
                  <figcaption className="mt-1 break-words text-sm font-medium">Selected artwork</figcaption>
                  {selectedArtwork.title !== currentAlbum.title && <p className="break-words text-xs text-gray-600">{selectedArtwork.title}</p>}
                  <p className="break-words text-xs text-gray-600">
                    {[selectedArtwork.source, selectedArtwork.year, selectedDimensions && selectedDimensions !== 'Unavailable' && `${selectedDimensions} px`].filter(Boolean).join(' · ')}
                  </p>
                  {selectedReference && <p title={selectedReference.full} className="break-words text-xs text-gray-600">{selectedReference.visible}</p>}
                </figure>
              </div>
              {!selectedDimensions && <p role="status" className="text-sm text-gray-600">Loading selected artwork…</p>}
              {selectedDimensions === 'Unavailable' && <p role="alert" className="text-sm text-red-600">Couldn’t load this cover. Choose another or keep your current artwork.</p>}
              {savingArtwork && <p role="status" className="text-sm text-gray-600">Updating artwork…</p>}
              {artworkSaveFailed && <p role="alert" className="text-sm text-red-600">Couldn’t update the artwork. Try applying it again or keep your current artwork.</p>}
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-2">
                <button type="button" onClick={backToArtworkChoices} aria-disabled={savingArtwork}
                  className="rh-lookup-link aria-disabled:opacity-60">Back to artwork choices</button>
                <button type="button" onClick={() => void applyArtwork()} aria-disabled={!canApplyArtwork} aria-busy={savingArtwork}
                  className="rh-primary-action px-3 text-sm font-semibold aria-disabled:opacity-60">
                  {savingArtwork ? 'Applying artwork…' : 'Apply artwork'}
                </button>
              </div>
            </div> : <div className="min-h-0 space-y-3 overflow-y-auto p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 pb-3 text-sm">
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
                      className="group min-w-0 cursor-pointer rounded-lg text-left disabled:cursor-default aria-disabled:cursor-default"
                      disabled={failed}
                      onClick={() => { if (!failed) setSelectedArtwork(candidate); }}
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
