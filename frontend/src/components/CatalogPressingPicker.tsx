import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { discogsPressingSearch } from '../albumDisplay';
import { usePressingPreparation } from '../hooks/usePressingPreparation';
import type { Album, DiscogsAlbum, PressingDetails } from '../services/api';
import { catalogNumberKey, matchesPressingMedium, withPressingEvidence } from '../services/pressingEvidence';
import { ModalDialog } from './ModalDialog';
import { PressingCandidates, PressingSelectionSummary, type PressingCandidate } from './PressingCandidates';
import './PressingReview.css';

interface Props {
  album: DiscogsAlbum;
  destination: Album['status'];
  searchedNumber?: string;
  issue?: string;
  duplicate?: boolean;
  onClose: () => void;
  onSave: (release: DiscogsAlbum) => Promise<boolean>;
  onSaveWithoutPressing?: () => Promise<boolean>;
  onOpenDuplicate?: (opener: HTMLButtonElement) => void;
  opener: RefObject<HTMLButtonElement | null>;
  fallback: RefObject<HTMLElement | null>;
}

export function CatalogPressingPicker({ album, destination, searchedNumber, issue, duplicate, onClose, onSave,
  onSaveWithoutPressing, onOpenDuplicate, opener, fallback }: Props) {
  const headingId = useId();
  const issueId = useId();
  const saveGuidanceId = useId();
  const selectionSummaryId = useId();
  const sampleNoticeId = useId();
  const openDuplicate = useRef<HTMLButtonElement>(null);
  const evidenceRegion = useRef<HTMLDivElement>(null);
  const saveInProgress = useRef(false);
  const [selectedId, setSelectedId] = useState<number>();
  const [evidence, setEvidence] = useState<Partial<Record<number, PressingDetails>>>({});
  const [saving, setSaving] = useState<'pressing' | 'album'>();
  const [unexpectedIssue, setUnexpectedIssue] = useState<string>();
  const releases = album.pressingChoices?.length ? album.pressingChoices : [album];
  const choices: PressingCandidate[] = releases.map(release => ({
    releaseId: release.discogsId,
    pressing: release.pressing,
    year: release.year,
    catalogNumberMatch: release.catalogNumberMatch,
  }));
  const reviewKey = JSON.stringify(['catalog', album.artist, album.album,
    searchedNumber ? catalogNumberKey(searchedNumber) : album.masterId || album.discogsId || album.id]);
  const preparation = usePressingPreparation(reviewKey, choices, evidence);
  const { medium } = preparation;
  const pressing = releases.find(release => release.discogsId === selectedId);
  const selectedChoice = choices.find(choice => choice.releaseId === selectedId);
  const selectedWithEvidence = selectedChoice && withPressingEvidence(selectedChoice, evidence[selectedChoice.releaseId]);
  const morePressingsUrl = album.pressingSampled ? discogsPressingSearch(album.artist, album.album, searchedNumber) : undefined;
  const selectionOutsideMedia = !!selectedWithEvidence && !matchesPressingMedium(selectedWithEvidence, medium);
  const shelf = destination === 'collection' ? 'Collection' : 'Wishlist';
  const saveIssue = unexpectedIssue ?? issue;
  const recordEvidence = useCallback((releaseId: number, details: PressingDetails) => {
    setEvidence(current => current[releaseId] === details ? current : { ...current, [releaseId]: details });
  }, []);

  useEffect(() => {
    if (duplicate && !saving) openDuplicate.current?.focus();
  }, [duplicate, saving]);

  useLayoutEffect(() => {
    if (selectedId === undefined) return;
    const region = evidenceRegion.current;
    const focused = region?.ownerDocument?.activeElement;
    if (focused?.matches('input[type="radio"]') && region?.contains(focused)) {
      focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [selectedId]);

  const close = () => {
    if (!saveInProgress.current) onClose();
  };

  const save = async (release?: DiscogsAlbum) => {
    if (saveInProgress.current || duplicate || (release ? selectionOutsideMedia : !onSaveWithoutPressing)) return;
    saveInProgress.current = true;
    setUnexpectedIssue(undefined);
    setSaving(release ? 'pressing' : 'album');
    try {
      const saved = release ? await onSave(release) : await onSaveWithoutPressing?.();
      if (saved) onClose();
    } catch {
      setUnexpectedIssue('Couldn’t save this album. Try again.');
    } finally {
      saveInProgress.current = false;
      setSaving(undefined);
    }
  };

  return (
    <ModalDialog labelledBy={headingId} onClose={close} returnFocusTo={opener} fallbackFocusTo={fallback}>
      <div className="rh-dialog-panel rh-pressing-review max-w-xl">
        <header className="rh-dialog-header flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-2 sm:px-6 sm:py-3">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h2 id={headingId} className="text-xl font-semibold">Review pressings</h2>
            <p className="rh-pressing-identity text-sm text-gray-600">{album.album} · {album.artist}</p>
          </div>
          <button type="button" className="rh-dialog-close" aria-label="Close pressing review" onClick={close} aria-disabled={!!saving}>
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <form className="rh-pressing-review__content" onSubmit={event => {
          event.preventDefault();
          if (pressing) return save(pressing);
        }}>
          <div ref={evidenceRegion} className="rh-pressing-review__evidence px-4 py-2 sm:px-6 sm:py-4" role="region" aria-label="Pressing evidence" tabIndex={0}>
            <PressingCandidates choices={choices} searchedNumber={searchedNumber} selectedId={selectedId}
              onSelect={setSelectedId} onReadEvidence={recordEvidence} disabled={!!saving || duplicate} preparation={preparation}
              morePressingsUrl={morePressingsUrl}
              uncertainAction={onSaveWithoutPressing ? 'If you’re unsure, you can save without pressing below.' : undefined} />
          </div>
          <footer className="rh-pressing-review__footer grid gap-2 px-4 py-2 sm:px-6" role="group" aria-label={duplicate ? 'Saved album' : 'Save album'}>
            {!duplicate && <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <p className="text-xs font-semibold text-gray-900">Save to {shelf}</p>
              {selectedWithEvidence && <PressingSelectionSummary identityOnly id={selectionSummaryId} searchedNumber={searchedNumber}
                choice={selectedWithEvidence} />}
            </div>}
            {!duplicate && (!pressing || selectionOutsideMedia) && <p id={saveGuidanceId} role="status" className="text-xs text-gray-600">
              {selectionOutsideMedia ? `The selected pressing is outside the ${medium} filter. Show it in All media or choose another pressing.`
                : 'Choose a pressing to save it.'}
            </p>}
            {morePressingsUrl && pressing && !duplicate && <p id={sampleNoticeId} className="text-xs text-gray-600">Only part of the Discogs results are shown.</p>}
            {saveIssue && <p id={issueId} role="alert" className="text-sm text-red-600">{saveIssue}</p>}
            <div className="rh-pressing-review__actions">
              {(duplicate || !onSaveWithoutPressing) && <button type="button" className="rh-lookup-link aria-disabled:opacity-60" onClick={close}
                aria-disabled={!!saving}>Back to results</button>}
              {duplicate ? onOpenDuplicate && (
                <button ref={openDuplicate} type="button" className="rh-primary-action px-3 text-sm font-semibold"
                  aria-describedby={saveIssue ? issueId : undefined} onClick={event => onOpenDuplicate(event.currentTarget)}>Open saved album</button>
              ) : (
                <>
                  {onSaveWithoutPressing && <button type="button" className="rh-lookup-link aria-disabled:opacity-60" onClick={() => save()}
                    aria-disabled={!!saving} aria-busy={saving === 'album'} aria-describedby={saveIssue ? issueId : undefined}
                    aria-label={saving === 'album' ? undefined : `Save without pressing to ${shelf}`}>
                    {saving === 'album' ? 'Saving album…' : 'Save without pressing'}
                  </button>}
                  <button type="submit" className="rh-primary-action px-3 text-sm font-semibold aria-disabled:opacity-60"
                    aria-disabled={!pressing || !!saving || selectionOutsideMedia} aria-busy={saving === 'pressing'}
                    aria-describedby={[saveIssue && issueId, (!pressing || selectionOutsideMedia) && saveGuidanceId,
                      selectedWithEvidence && selectionSummaryId, morePressingsUrl && pressing && sampleNoticeId].filter(Boolean).join(' ') || undefined}
                    aria-label={saving === 'pressing' ? undefined : `Save pressing to ${shelf}`}>
                    {saving === 'pressing' ? 'Saving pressing…' : 'Save pressing'}
                  </button>
                </>
              )}
            </div>
          </footer>
        </form>
      </div>
    </ModalDialog>
  );
}
