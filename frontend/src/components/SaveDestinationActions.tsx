import { useId, useRef, useState } from 'react';
import { isExactSavedMatch, type SavedMatch, type SavedTitleMatch } from '../services/api';
import { savedCopyLabel, savedPressingLabel } from '../albumDisplay';
import { PressingComparison, type LookupPressing, type OpenSavedAlbum } from './PressingComparison';

type Shelf = 'collection' | 'wishlist';
export type DestinationAction = Shelf | 'move';

const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };

interface SaveDestinationActionsProps {
  albumTitle: string;
  catalogLabel?: string;
  preferred: Shelf;
  existingStatus?: Shelf;
  existingMatch?: SavedMatch | null;
  existingAlbumId?: number | null;
  savedHere?: boolean;
  titleMatches?: SavedTitleMatch[];
  lookup?: LookupPressing;
  onSearch?: () => void;
  searchLabel?: string;
  openingSaved?: boolean;
  pending?: DestinationAction;
  disabled?: boolean;
  onSelect: (action: DestinationAction) => void;
  onOpenSaved?: OpenSavedAlbum;
  onReviewPressings?: (opener: HTMLButtonElement) => void;
}

interface DestinationChoice {
  shelf: Shelf;
  action?: DestinationAction;
}

export function SaveDestinationActions({
  albumTitle, catalogLabel, preferred, existingStatus, existingMatch, existingAlbumId, savedHere, titleMatches, lookup, onSearch, searchLabel,
  openingSaved, pending, disabled, onSelect, onOpenSaved, onReviewPressings,
}: SaveDestinationActionsProps) {
  const [comparing, setComparing] = useState(false);
  const statusId = useId();
  const compareButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const blocked = !!pending || !!disabled || !!openingSaved;
  const titleOnly = existingStatus && !isExactSavedMatch(existingMatch);
  const matches = titleMatches?.length ? titleMatches : !titleOnly || existingAlbumId == null ? [] : [{
    id: existingAlbumId, title: albumTitle, artist_name: lookup?.artist ?? '', status: existingStatus,
  }];
  const savedId = existingAlbumId ?? (matches.length === 1 ? matches[0].id : undefined);
  const savedShelfNames = [...new Set(matches.map(copy => shelfNames[copy.status]))];
  const matchedShelves = savedShelfNames.length ? savedShelfNames.join(' and ') : existingStatus && shelfNames[existingStatus];
  const savedPressing = matches.length === 1 ? savedPressingLabel(matches[0]) : undefined;
  const comparison = comparing && onOpenSaved && (
    <PressingComparison title={albumTitle} lookup={lookup} matches={matches}
      returnFocusTo={compareButton} fallbackFocusTo={addButton} onClose={() => setComparing(false)} onOpenSaved={onOpenSaved}
      searchLabel={searchLabel} onSearch={onSearch && (() => { setComparing(false); onSearch(); })} />
  );

  if (catalogLabel) {
    const destination = pending && pending !== 'move' ? pending : preferred;
    const name = shelfNames[destination];
    const canOpen = !!onOpenSaved && savedId != null;
    const canCompare = titleOnly && !!onOpenSaved && matches.length > 0;
    const compareFirst = canCompare && (!savedHere || !canOpen);
    const canMove = existingStatus === 'wishlist' && existingAlbumId != null && isExactSavedMatch(existingMatch);
    const opensDialog = !!existingStatus && (canOpen || canCompare);
    const savedRecordLabel = titleOnly && matches.length === 1 ? savedCopyLabel(matches[0]) : catalogLabel;
    const primaryLabel = !existingStatus ? (pending === destination ? `Adding to ${name}…` : `Add to ${name}`)
      : compareFirst ? 'Compare pressings' : openingSaved ? 'Opening album…' : canOpen ? 'Open saved album' : 'Saved album';
    const savedLabel = titleOnly && !savedHere ? `Title already in ${matchedShelves}`
      : `${existingMatch === 'release' ? 'This pressing' : 'Album'} saved in ${matchedShelves}`;
    const savedEdition = matches.length === 1 && matches[0].discogs_id
      ? `Saved Discogs release ${matches[0].discogs_id}` : 'Saved pressing unconfirmed';
    const compare = () => setComparing(true);
    return (
      <div className="rh-destination-actions grid min-w-0 gap-1">
        <p id={statusId} role="status" className={existingStatus ? 'rh-saved-outcome' : 'sr-only'}>
          {existingStatus && <>{savedLabel}{titleOnly && savedPressing && ` · ${savedEdition}`}</>}
        </p>
        {titleOnly && !savedHere && <p className="rh-album-level-hint">One saved entry per artist and title.</p>}
        {!existingStatus && onReviewPressings && <p className="rh-album-level-hint">Add the album, or check a pressing first.</p>}
        {/* The Add control becomes the saved-record action on the same DOM node. */}
        <button type="button" data-catalog-primary ref={compareFirst ? compareButton : addButton}
          className={existingStatus ? 'rh-lookup-link text-left' : 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-2 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-50'}
          aria-label={compareFirst ? `Compare pressings for ${catalogLabel}` : `${primaryLabel} · ${canOpen ? savedRecordLabel : catalogLabel}`}
          aria-describedby={existingStatus ? statusId : undefined}
          aria-disabled={blocked || (!!existingStatus && !opensDialog)} aria-busy={!!pending || !!openingSaved}
          aria-haspopup={opensDialog ? 'dialog' : undefined}
          onClick={event => {
            if (blocked) return;
            if (!existingStatus) onSelect(destination);
            else if (compareFirst) compare();
            else if (canOpen) void onOpenSaved(savedId, event.currentTarget);
          }}>
          {primaryLabel}
        </button>
        {!existingStatus && onReviewPressings && <button type="button" className="rh-lookup-link text-left"
          aria-disabled={blocked} aria-haspopup="dialog" aria-label={`Check pressings for ${catalogLabel}`}
          onClick={event => { if (!blocked) onReviewPressings(event.currentTarget); }}>Check pressings</button>}
        {canCompare && !compareFirst && <button ref={compareButton} type="button" className="rh-lookup-link text-left"
          aria-disabled={blocked} aria-haspopup="dialog" aria-label={`Compare pressings for ${catalogLabel}`}
          onClick={() => { if (!blocked) compare(); }}>Compare pressings</button>}
        {compareFirst && canOpen && <button type="button" className="rh-lookup-link text-left"
          aria-haspopup="dialog" aria-disabled={blocked} aria-label={`Open saved album · ${savedRecordLabel}`}
          onClick={event => { if (!blocked) void onOpenSaved(savedId, event.currentTarget); }}>{openingSaved ? 'Opening album…' : 'Open saved album'}</button>}
        {canMove && <button type="button" className="rh-lookup-link text-left"
          aria-label={`Move to Collection · ${catalogLabel}`} aria-busy={pending === 'move'} aria-disabled={blocked}
          onClick={() => { if (!blocked) onSelect('move'); }}>{pending === 'move' ? 'Moving to Collection…' : 'Move to Collection'}</button>}
        {comparison}
      </div>
    );
  }

  if (titleOnly) {
    return (
      <>
        <div className="rh-title-review" role="group" aria-label={`Saved title matches for ${catalogLabel ?? albumTitle}`}>
          <p className="rh-saved-outcome">Saved in {matchedShelves}{savedPressing && ` · ${savedPressing}`}</p>
          {onOpenSaved && matches.length > 0 && (
            <button ref={compareButton} type="button" className="rh-lookup-link text-left" disabled={blocked}
              aria-haspopup="dialog" aria-label={`Compare pressings for ${catalogLabel ?? albumTitle}`} onClick={() => setComparing(true)}>
              Compare pressings
            </button>
          )}
        </div>
        {comparison}
      </>
    );
  }

  const firstShelf = preferred;
  const alternative = firstShelf === 'collection' ? 'wishlist' : 'collection';
  const choices: DestinationChoice[] = existingStatus
    ? [{ shelf: existingStatus }]
    : [{ shelf: firstShelf, action: firstShelf }];

  if (existingStatus === 'wishlist' && existingAlbumId != null && isExactSavedMatch(existingMatch)) {
    choices.push({ shelf: 'collection', action: 'move' });
  }

  const renderChoice = ({ shelf, action }: DestinationChoice) => {
    const name = shelfNames[shelf];
    const moving = action === 'move';
    const unavailable = !action || blocked;
    const busy = !!action && pending === action;
    const label = action ? `${moving ? 'Move' : 'Add'} to ${name}` : `Saved in ${name}`;
    const matchReason = existingMatch === 'release' ? 'Matched by Discogs release' : 'Matched by barcode';
    const accessibleLabel = action
      ? `${moving ? 'Move' : 'Add'} ${albumTitle} to ${name}`
      : `${albumTitle}: ${label}`;
    const color = !action
      ? 'border-gray-300 text-gray-600'
      : moving || shelf === firstShelf
        ? 'rh-filled-action border-transparent bg-purple-600 hover:bg-purple-700'
        : 'border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-50';

    return (
      // Keep the destination's control mounted when its label becomes a saved status, so focus stays put.
      <button
        key={shelf}
        ref={shelf === firstShelf && action === firstShelf ? addButton : undefined}
        type="button"
        aria-label={accessibleLabel}
        aria-description={action ? undefined : matchReason}
        aria-disabled={unavailable}
        aria-busy={busy}
        tabIndex={action ? undefined : -1}
        className={`min-h-11 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${color}`}
        onClick={() => { if (action && !unavailable) onSelect(action); }}
      >
        {busy ? `${moving ? 'Moving' : 'Adding'} to ${name}…` : label}
        {!action && <span className="block font-normal">{matchReason}</span>}
      </button>
    );
  };

  return (
    <>
      <div className="rh-destination-actions grid min-w-0 gap-1.5">
        {!existingStatus && lookup?.source?.kind === 'album' && (
          <p className="rh-album-level-hint">Saves the album. Pressing unconfirmed.</p>
        )}
        {choices.map(renderChoice)}
        {!existingStatus && (
          <details className="rh-destination-options min-w-0">
            <summary aria-label={`Other shelf for ${catalogLabel ?? albumTitle}`}>Other shelf</summary>
            <div className="grid">{renderChoice({ shelf: alternative, action: alternative })}</div>
          </details>
        )}
        {onOpenSaved && existingAlbumId != null && (
          <button type="button" aria-disabled={blocked} aria-busy={!!openingSaved}
            className="min-h-11 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100"
            aria-haspopup="dialog" aria-label={`Open saved album — ${catalogLabel ?? albumTitle}`}
            onClick={event => { if (!blocked) void onOpenSaved(existingAlbumId, event.currentTarget); }}>
            {openingSaved ? 'Opening album…' : 'Open saved album'}
          </button>
        )}
      </div>
      {comparison}
    </>
  );
}
