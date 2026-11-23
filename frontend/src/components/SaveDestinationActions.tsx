import { isExactSavedMatch, type SavedMatch, type SavedTitleMatch } from '../services/api';

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
  lookupReleaseId?: number;
  openingSaved?: boolean;
  pending?: DestinationAction;
  disabled?: boolean;
  onSelect: (action: DestinationAction) => void;
  onOpenSaved?: (id: number) => void;
}

interface DestinationChoice {
  shelf: Shelf;
  action?: DestinationAction;
}

export function SaveDestinationActions({
  albumTitle, preferred, existingStatus, existingMatch, existingAlbumId, titleMatches, lookupReleaseId,
  openingSaved, pending, disabled, onSelect, onOpenSaved,
}: SaveDestinationActionsProps) {
  const blocked = !!pending || !!disabled || !!openingSaved;
  if (existingStatus && !isExactSavedMatch(existingMatch)) {
    const canReview = onOpenSaved && (titleMatches?.length || existingAlbumId != null);
    return (
      <div className="rh-title-review" role="group" aria-label={`Saved title matches for ${albumTitle}`}>
        <p className="px-2 text-xs font-semibold text-gray-600">Same artist and title</p>
        {canReview && (
          <details className="rh-lookup-recovery">
            <summary>{titleMatches && titleMatches.length > 1 ? 'Compare saved albums' : 'Compare with saved album'}</summary>
            <div className="space-y-2 px-2 pb-2 text-sm">
              {lookupReleaseId != null && lookupReleaseId > 0 && (
                <p className="text-xs text-gray-600">Lookup Discogs release ID {lookupReleaseId}</p>
              )}
              {titleMatches?.length ? (
                <ul className="space-y-2">
                  {titleMatches.map(album => (
                    <li key={album.id} className="border-t border-gray-200 pt-2 leading-snug [overflow-wrap:anywhere]">
                      <p className="font-semibold">{album.title}</p>
                      <p className="text-xs text-gray-600">{album.artist_name}{album.year ? ` · ${album.year}` : ''}</p>
                      <p className="mt-1 text-xs text-gray-600">
                        {shelfNames[album.status]} · {album.discogs_id ? `Discogs release ID ${album.discogs_id}` : 'Release ID unavailable'}
                      </p>
                      <button type="button" className="rh-lookup-link" disabled={blocked}
                        aria-label={`Open saved ${album.title} by ${album.artist_name} in ${shelfNames[album.status]}${album.discogs_id ? `, release ${album.discogs_id}` : ''}`}
                        onClick={() => onOpenSaved(album.id)}>
                        Open saved album
                      </button>
                    </li>
                  ))}
                </ul>
              ) : existingAlbumId != null && (
                <button type="button" className="rh-lookup-link" disabled={blocked}
                  onClick={() => onOpenSaved(existingAlbumId)}>Open saved album</button>
              )}
            </div>
          </details>
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
        <button type="button" disabled={blocked} aria-busy={!!openingSaved}
          className="min-h-11 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100"
          aria-label={`Open saved album — ${albumTitle}`} onClick={() => onOpenSaved(existingAlbumId)}>
          {openingSaved ? 'Opening album…' : 'Open saved album'}
        </button>
      )}
    </div>
  );
}
