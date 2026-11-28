import { useId, useState, type RefObject } from 'react';
import { discogsReleaseSource } from '../albumDisplay';
import type { Album, DiscogsAlbum } from '../services/api';
import { ModalDialog } from './ModalDialog';

interface Props {
  album: DiscogsAlbum;
  destination: Album['status'];
  issue?: string;
  duplicate?: boolean;
  onClose: () => void;
  onSave: (release: DiscogsAlbum) => Promise<boolean>;
  onOpenDuplicate?: () => void;
  opener: RefObject<HTMLButtonElement | null>;
  fallback: RefObject<HTMLElement | null>;
}

export function CatalogPressingPicker({ album, destination, issue, duplicate, onClose, onSave, onOpenDuplicate, opener, fallback }: Props) {
  const headingId = useId();
  const radioName = useId();
  const [selectedId, setSelectedId] = useState<number>();
  const [saving, setSaving] = useState(false);
  const choices = album.pressingChoices?.length ? album.pressingChoices : [album];
  const pressing = choices.find(choice => choice.discogsId === selectedId);
  const shelf = destination === 'collection' ? 'Collection' : 'Wishlist';
  const close = () => { if (!saving) onClose(); };

  return (
    <ModalDialog labelledBy={headingId} onClose={close} returnFocusTo={opener} fallbackFocusTo={fallback}>
      <div className="rh-dialog-panel rh-pressing-picker max-w-xl">
        <header className="rh-dialog-header flex items-start justify-between gap-2 border-b border-gray-200 p-4 sm:px-6">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <h2 id={headingId} className="text-xl font-semibold">Check the pressing</h2>
            <p className="mt-1 text-sm text-gray-600">{album.album} · {album.artist}</p>
          </div>
          <button type="button" className="rh-dialog-close" aria-label="Close pressing choices" onClick={close} aria-disabled={saving}>
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <form className="grid gap-3 p-4 sm:px-6" onSubmit={async event => {
          event.preventDefault();
          if (!pressing || saving || duplicate) return;
          setSaving(true);
          if (await onSave(pressing)) onClose();
          else setSaving(false);
        }}>
          <p className="text-sm text-gray-600">Compare the catalog number, label, and format with your sleeve or record. You can add the album without choosing a pressing from the search result.</p>
          <fieldset disabled={saving || duplicate}>
            <legend className="mb-1 text-sm font-semibold">Pressing from Discogs</legend>
            {choices.map(choice => {
              const source = discogsReleaseSource(choice.discogsId);
              const details = choice.pressing;
              return (
                <div key={choice.discogsId} className="rh-pressing-choice">
                  <label className="flex min-h-11 min-w-0 items-start gap-2 py-2 text-sm [overflow-wrap:anywhere]">
                    <input type="radio" name={radioName} value={choice.discogsId} checked={selectedId === choice.discogsId}
                      className="mt-1 shrink-0" onChange={() => setSelectedId(choice.discogsId)} />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="font-semibold">{details?.catalogNumber ?? 'Catalog number unavailable'}</span>
                      <span className="text-gray-600">{[details?.format, choice.year, details?.country].filter(Boolean).join(' · ') || 'No format or year listed'}</span>
                      {details?.label && <span className="text-gray-600">{details.label}</span>}
                      {choice.catalogNumberMatch === 'unverified' && <span className="text-gray-600">Check the number on the listing.</span>}
                    </span>
                  </label>
                  {source?.url && <a className="rh-comparison-source" href={source.url} target="_blank" rel="noreferrer">
                    Discogs {choice.discogsId}<span className="sr-only"> (opens in a new tab)</span>
                  </a>}
                </div>
              );
            })}
          </fieldset>
          {issue && <p role="alert" className="text-sm text-red-600">{issue}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="rh-lookup-link" onClick={close} aria-disabled={saving}>Back to results</button>
            {onOpenDuplicate && duplicate ? <button type="button" className="rh-primary-action px-3 text-sm font-semibold"
              onClick={onOpenDuplicate}>Open saved album</button> : (
              <button type="submit" className="rh-primary-action px-3 text-sm font-semibold" aria-busy={saving}
                aria-disabled={!pressing || saving || duplicate}>
                {saving ? `Saving to ${shelf}…` : `Save pressing to ${shelf}`}
              </button>
            )}
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
