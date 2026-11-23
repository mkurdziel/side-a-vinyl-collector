import { useId, useState, type RefObject } from 'react';
import type { Album, SavedTitleMatch } from '../services/api';
import { savedCopyLabel } from '../albumDisplay';
import { ModalDialog } from './ModalDialog';

export type OpenSavedAlbum = (id: number, opener: HTMLButtonElement, inlineError?: boolean) => Promise<boolean>;

export interface LookupPressing {
  artist: string;
  year?: number;
  releaseId?: number;
  source?: { label: string; url?: string };
}

interface PressingComparisonProps {
  title: string;
  lookup?: LookupPressing;
  matches: SavedTitleMatch[];
  onClose: () => void;
  onOpenSaved: OpenSavedAlbum;
  onSearch?: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}

export function PressingComparison({
  title, lookup, matches, onClose, onOpenSaved, onSearch, returnFocusTo,
}: PressingComparisonProps) {
  const headingId = useId();
  const [opening, setOpening] = useState<number>();
  const [failed, setFailed] = useState<number>();

  const inspect = async (id: number, opener: HTMLButtonElement) => {
    if (opening !== undefined) return;
    setOpening(id);
    setFailed(undefined);
    if (!await onOpenSaved(id, opener, true)) setFailed(id);
    setOpening(undefined);
  };

  const renderEvidence = (year?: number, releaseId?: number, shelf?: Album['status']) => (
    <dl className="rh-pressing-evidence">
      {shelf && <div><dt>Shelf</dt><dd>{shelf === 'wishlist' ? 'Wishlist' : 'Collection'}</dd></div>}
      <div><dt>Year</dt><dd>{year || 'Unknown'}</dd></div>
      <div><dt>Discogs release ID</dt><dd>{releaseId || 'Unavailable'}</dd></div>
    </dl>
  );

  return (
    <ModalDialog labelledBy={headingId} onClose={onClose} returnFocusTo={returnFocusTo}>
      <div className="rh-dialog-panel max-w-3xl">
        <div className="rh-dialog-header flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-6">
          <h2 id={headingId} className="text-xl font-semibold">Compare pressings</h2>
          <button type="button" className="rh-dialog-close" onClick={onClose} aria-label="Close pressing comparison">
            <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="grid gap-4 p-4 sm:gap-5 sm:p-6">
          <p className="max-w-prose text-sm text-gray-600">
            Check the release details to identify the pressing. Side A’s add form allows one saved entry per artist and title.
          </p>
          <div className="rh-pressing-grid">
            <section className="rh-pressing-lookup">
              <h3 className="font-semibold">Lookup result</h3>
              <p className="mt-2 text-sm font-semibold">{title}</p>
              {lookup?.artist && <p className="text-sm text-gray-600">{lookup.artist}</p>}
              {renderEvidence(lookup?.year, lookup?.releaseId)}
              {lookup?.source?.url && (
                <a className="rh-lookup-link inline-flex items-center" href={lookup.source.url} target="_blank" rel="noreferrer">
                  View lookup on {lookup.source.label} <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </section>
            <section className="min-w-0">
              <h3 className="font-semibold">{matches.length === 1 ? 'Saved copy' : 'Saved copies'}</h3>
              <ul className="rh-pressing-saved">
                {matches.map(album => {
                  const action = opening === album.id ? 'Opening saved copy…'
                    : failed === album.id ? 'Retry opening saved copy' : 'Open saved album';
                  return <li key={album.id}>
                    <p className="text-sm font-semibold">{album.title}</p>
                    <p className="text-sm text-gray-600">{album.artist_name}</p>
                    {renderEvidence(album.year, album.discogs_id ?? undefined, album.status)}
                    <button type="button" className="rh-lookup-link text-left"
                      aria-label={`${action} · ${savedCopyLabel(album)}`} aria-haspopup="dialog"
                      aria-disabled={opening !== undefined} aria-busy={opening === album.id}
                      onClick={event => void inspect(album.id, event.currentTarget)}>
                      {action}
                    </button>
                    {failed === album.id && <p role="alert" className="px-2 text-sm text-red-600">Couldn’t open this saved copy. Try again.</p>}
                  </li>;
                })}
              </ul>
            </section>
          </div>
          {onSearch && (
            <div className="border-t border-gray-200 pt-2">
              <button type="button" className="rh-lookup-link" onClick={onSearch}>Edit album search</button>
            </div>
          )}
        </div>
      </div>
    </ModalDialog>
  );
}
