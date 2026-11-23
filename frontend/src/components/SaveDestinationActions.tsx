import { useRef, useState } from 'react';
import { isExactSavedMatch, type SavedMatch, type SavedTitleMatch } from '../services/api';
import { PressingComparison, type LookupPressing, type OpenSavedAlbum } from './PressingComparison';

type Shelf = 'collection' | 'wishlist';
export type DestinationAction = Shelf | 'move';

const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };

interface SaveDestinationActionsProps {
  albumTitle: string;
  preferred: Shelf;
  existingStatus?: Shelf;
  existingMatch?: SavedMatch | null;
  existingAlbumId?: number | null;
  titleMatches?: SavedTitleMatch[];
  lookup?: LookupPressing;
  onSearch?: () => void;
  openingSaved?: boolean;
  pending?: DestinationAction;
  disabled?: boolean;
  onSelect: (action: DestinationAction) => void;
  onOpenSaved?: OpenSavedAlbum;
}

interface DestinationChoice {
  shelf: Shelf;
  action?: DestinationAction;
}

export function SaveDestinationActions({
  albumTitle, preferred, existingStatus, existingMatch, existingAlbumId, titleMatches, lookup, onSearch,
  openingSaved, pending, disabled, onSelect, onOpenSaved,
}: SaveDestinationActionsProps) {
  const [comparing, setComparing] = useState(false);
  const compareButton = useRef<HTMLButtonElement>(null);
  const blocked = !!pending || !!disabled || !!openingSaved;
  if (existingStatus && !isExactSavedMatch(existingMatch)) {
    const matches = titleMatches?.length ? titleMatches : existingAlbumId == null ? [] : [{
      id: existingAlbumId, title: albumTitle, artist_name: lookup?.artist ?? '', status: existingStatus,
    }];
    return (
      <div className="rh-title-review" role="group" aria-label={`Saved title matches for ${albumTitle}`}>
        <p className="px-2 text-xs font-medium text-gray-600">Same artist and title</p>
        {onOpenSaved && matches.length > 0 && (
          <>
            <button ref={compareButton} type="button" className="rh-lookup-link text-left" disabled={blocked}
              aria-haspopup="dialog" aria-label={`Compare pressings for ${albumTitle}`} onClick={() => setComparing(true)}>
              Compare pressings
            </button>
            {comparing && <PressingComparison title={albumTitle} lookup={lookup} matches={matches}
              returnFocusTo={compareButton} onClose={() => setComparing(false)} onOpenSaved={onOpenSaved}
              onSearch={onSearch && (() => { setComparing(false); onSearch(); })} />}
          </>
        )}
      </div>
    );
  }

  const alternative = preferred === 'collection' ? 'wishlist' : 'collection';
  const choices: DestinationChoice[] = existingStatus
    ? [{ shelf: existingStatus }]
    : [{ shelf: preferred, action: preferred }];

  if (existingStatus === 'wishlist' && existingAlbumId != null && isExactSavedMatch(existingMatch)) {
    choices.push({ shelf: 'collection', action: 'move' });
  }

  const renderChoice = ({ shelf, action }: DestinationChoice) => {
    const name = shelfNames[shelf];
    const moving = action === 'move';
    const unavailable = !action || blocked;
    const busy = !!action && pending === action;
    const matchLabel = existingMatch === 'release' ? 'Release ID' : existingMatch === 'barcode' ? 'Barcode' : 'Title';
    const label = action ? `${moving ? 'Move' : 'Add'} to ${name}` : `${matchLabel} in ${name}`;
    const accessibleLabel = action
      ? `${moving ? 'Move' : 'Add'} ${albumTitle} to ${name}`
      : `${albumTitle}: ${label}`;
    const color = !action
      ? 'border-gray-300 text-gray-600'
      : moving || shelf === preferred
        ? 'rh-filled-action border-transparent bg-purple-600 hover:bg-purple-700'
        : 'border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-50';

    return (
      // Keep the destination's control mounted when its label becomes a saved status, so focus stays put.
      <button
        key={shelf}
        type="button"
        aria-label={accessibleLabel}
        aria-disabled={unavailable}
        aria-busy={busy}
        tabIndex={action ? undefined : -1}
        className={`min-h-11 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${color}`}
        onClick={() => { if (action && !unavailable) onSelect(action); }}
      >
        {busy ? `${moving ? 'Moving' : 'Adding'} to ${name}…` : label}
      </button>
    );
  };

  return (
    <div className="rh-destination-actions grid min-w-0 gap-1.5">
      {choices.map(renderChoice)}
      {!existingStatus && (
        <details className="rh-destination-options min-w-0">
          <summary aria-label={`Other shelf for ${albumTitle}`}>Other shelf</summary>
          <div className="grid">{renderChoice({ shelf: alternative, action: alternative })}</div>
        </details>
      )}
      {onOpenSaved && existingAlbumId != null && (
        <button type="button" aria-disabled={blocked} aria-busy={!!openingSaved}
          className="min-h-11 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100"
          aria-haspopup="dialog" aria-label={`Open saved album — ${albumTitle}`}
          onClick={event => { if (!blocked) void onOpenSaved(existingAlbumId, event.currentTarget); }}>
          {openingSaved ? 'Opening album…' : 'Open saved album'}
        </button>
      )}
    </div>
  );
}
