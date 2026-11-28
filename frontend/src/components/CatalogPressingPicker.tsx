import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Album, DiscogsAlbum, PressingDetails } from '../services/api';
import { withPressingEvidence } from '../services/pressingEvidence';
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
  const pressing = releases.find(release => release.discogsId === selectedId);
  const selectedChoice = choices.find(choice => choice.releaseId === selectedId);
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
    if (saveInProgress.current || duplicate || (!release && !onSaveWithoutPressing)) return;
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
        <header className="rh-dialog-header flex items-start justify-between gap-2 border-b border-gray-200 p-4 sm:px-6">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h2 id={headingId} className="text-xl font-semibold">Review pressings</h2>
            <p className="mt-1 line-clamp-2 text-sm text-gray-600">{album.album} · {album.artist}</p>
            <p className="mt-0.5 text-xs text-gray-600">Save to {shelf}</p>
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
          <div ref={evidenceRegion} className="rh-pressing-review__evidence p-4 sm:px-6" role="region" aria-label="Pressing evidence" tabIndex={0}>
            <PressingCandidates choices={choices} searchedNumber={searchedNumber} selectedId={selectedId}
              onSelect={setSelectedId} onReadEvidence={recordEvidence} disabled={!!saving || duplicate}
              uncertainAction={onSaveWithoutPressing ? 'If you’re unsure, you can save without pressing below.' : undefined} />
          </div>
          <footer className="rh-pressing-review__footer grid gap-2 px-4 py-2 sm:px-6" role="group" aria-label={duplicate ? 'Saved album' : 'Save album'}>
            {selectedChoice && !duplicate && <PressingSelectionSummary compact searchedNumber={searchedNumber}
              formats={choices.map(choice => choice.pressing?.format ?? '')}
              choice={withPressingEvidence(selectedChoice, evidence[selectedChoice.releaseId])} />}
            {!duplicate && <p id={saveGuidanceId} className="text-xs text-gray-600">
              {onSaveWithoutPressing
                ? `Save an exact Discogs release, or save the album to ${shelf} and identify its pressing later.`
                : `Choose an exact Discogs release to save to ${shelf}.`}
            </p>}
            {saveIssue && <p id={issueId} role="alert" className="text-sm text-red-600">{saveIssue}</p>}
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button type="button" className="rh-lookup-link aria-disabled:opacity-60" onClick={close}
                aria-disabled={!!saving}>Back to results</button>
              {duplicate ? onOpenDuplicate && (
                <button ref={openDuplicate} type="button" className="rh-primary-action px-3 text-sm font-semibold"
                  aria-describedby={saveIssue ? issueId : undefined} onClick={event => onOpenDuplicate(event.currentTarget)}>Open saved album</button>
              ) : (
                <>
                  {onSaveWithoutPressing && <button type="button" className="rh-lookup-link aria-disabled:opacity-60" onClick={() => save()}
                    aria-disabled={!!saving} aria-busy={saving === 'album'} aria-describedby={saveIssue ? issueId : saveGuidanceId}>
                    {saving === 'album' ? `Saving album to ${shelf}…` : `Save without pressing to ${shelf}`}
                  </button>}
                  <button type="submit" className="rh-primary-action px-3 text-sm font-semibold aria-disabled:opacity-60"
                    aria-disabled={!pressing || !!saving} aria-busy={saving === 'pressing'} aria-describedby={saveIssue ? issueId : saveGuidanceId}>
                    {saving === 'pressing' ? `Saving pressing to ${shelf}…` : `Save pressing to ${shelf}`}
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
