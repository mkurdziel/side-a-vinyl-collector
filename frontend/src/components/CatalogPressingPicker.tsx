import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { Album, DiscogsAlbum } from '../services/api';
import { ModalDialog } from './ModalDialog';
import { PressingCandidates, type PressingCandidate } from './PressingCandidates';

interface Props {
  album: DiscogsAlbum;
  destination: Album['status'];
  searchedNumber?: string;
  issue?: string;
  duplicate?: boolean;
  onClose: () => void;
  onSave: (release: DiscogsAlbum) => Promise<boolean>;
  onSaveWithoutPressing: () => Promise<boolean>;
  onOpenDuplicate?: () => void;
  opener: RefObject<HTMLButtonElement | null>;
  fallback: RefObject<HTMLElement | null>;
}

export function CatalogPressingPicker({ album, destination, searchedNumber, issue, duplicate, onClose, onSave,
  onSaveWithoutPressing, onOpenDuplicate, opener, fallback }: Props) {
  const headingId = useId();
  const issueId = useId();
  const openDuplicate = useRef<HTMLButtonElement>(null);
  const saveInProgress = useRef(false);
  const [selectedId, setSelectedId] = useState<number>();
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
  const shelf = destination === 'collection' ? 'Collection' : 'Wishlist';
  const saveIssue = unexpectedIssue ?? issue;

  useEffect(() => {
    if (duplicate && !saving) openDuplicate.current?.focus();
  }, [duplicate, saving]);

  const close = () => {
    if (!saveInProgress.current) onClose();
  };

  const save = async (release?: DiscogsAlbum) => {
    if (saveInProgress.current || duplicate) return;
    saveInProgress.current = true;
    setUnexpectedIssue(undefined);
    setSaving(release ? 'pressing' : 'album');
    try {
      const saved = release ? await onSave(release) : await onSaveWithoutPressing();
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
      <div className="rh-dialog-panel max-w-xl">
        <header className="rh-dialog-header flex items-start justify-between gap-2 border-b border-gray-200 p-4 sm:px-6">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h2 id={headingId} className="text-xl font-semibold">Review pressings</h2>
            <p className="mt-1 text-sm text-gray-600">{album.album} · {album.artist}</p>
          </div>
          <button type="button" className="rh-dialog-close" aria-label="Close pressing review" onClick={close} aria-disabled={!!saving}>
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <form className="grid gap-3 p-4 sm:px-6" onSubmit={event => {
          event.preventDefault();
          if (pressing) return save(pressing);
        }}>
          <PressingCandidates choices={choices} searchedNumber={searchedNumber} selectedId={selectedId}
            onSelect={setSelectedId} disabled={!!saving || duplicate} />
          {saveIssue && <p id={issueId} role="alert" className="text-sm text-red-600">{saveIssue}</p>}
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button type="button" className="rh-lookup-link aria-disabled:opacity-60" onClick={close}
              aria-disabled={!!saving}>Back to results</button>
            {duplicate ? onOpenDuplicate && (
              <button ref={openDuplicate} type="button" className="rh-primary-action px-3 text-sm font-semibold"
                aria-describedby={saveIssue ? issueId : undefined} onClick={onOpenDuplicate}>Open saved album</button>
            ) : (
              <>
                <button type="button" className="rh-lookup-link aria-disabled:opacity-60" onClick={() => save()}
                  aria-disabled={!!saving} aria-busy={saving === 'album'} aria-describedby={saveIssue ? issueId : undefined}>
                  {saving === 'album' ? `Saving album to ${shelf}…` : `Save without pressing to ${shelf}`}
                </button>
                <button type="submit" className="rh-primary-action px-3 text-sm font-semibold aria-disabled:opacity-60"
                  aria-disabled={!pressing || !!saving} aria-busy={saving === 'pressing'} aria-describedby={saveIssue ? issueId : undefined}>
                  {saving === 'pressing' ? `Saving pressing to ${shelf}…` : `Save pressing to ${shelf}`}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
