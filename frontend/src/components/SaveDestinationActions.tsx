import { useId, useRef, useState } from 'react';
import { isExactSavedMatch, type SavedMatch, type SavedTitleMatch } from '../services/api';
import { savedCopyLabel, savedPressingLabel } from '../albumDisplay';
import { PressingComparison, type LookupPressing, type OpenSavedAlbum, type SavePressing, type UndoPressing } from './PressingComparison';

type Shelf = 'collection' | 'wishlist';
export type DestinationAction = Shelf | 'move';

const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };

export function SaveShelfSelect({ value, onChange, albumTitle, disabled }: {
  value: Shelf; onChange: (shelf: Shelf) => void; albumTitle?: string; disabled?: boolean;
}) {
  return <label className="rh-save-destination">
    <span>Save to</span>
    <select value={value} disabled={disabled} aria-label={albumTitle ? `Save to · ${albumTitle}` : undefined}
      onChange={event => onChange(event.target.value as Shelf)}>
      <option value="collection">Collection</option>
      <option value="wishlist">Wishlist</option>
    </select>
  </label>;
}

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
  lookupChoices?: LookupPressing[];
  searchedNumber?: string;
  onSearch?: () => void;
  searchLabel?: string;
  openingSaved?: boolean;
  pending?: DestinationAction;
  disabled?: boolean;
  onSelect: (action: DestinationAction) => void;
  onOpenSaved?: OpenSavedAlbum;
  onReviewPressings?: (destination: Shelf, opener: HTMLButtonElement) => void;
  onReviewNewPressings?: (destination: Shelf, opener: HTMLButtonElement) => void;
  reviewFirst?: boolean;
  onSavePressing?: SavePressing;
  onUndoPressing?: UndoPressing;
  onSavedCopyRemoved?: (id: number) => void;
}

interface DestinationChoice {
  shelf: Shelf;
  action?: DestinationAction;
}

export function SaveDestinationActions({
  albumTitle, catalogLabel, preferred, existingStatus, existingMatch, existingAlbumId, savedHere, titleMatches, lookup, lookupChoices, searchedNumber, onSearch, searchLabel,
  openingSaved, pending, disabled, onSelect, onOpenSaved, onReviewPressings, onReviewNewPressings, reviewFirst,
  onSavePressing, onUndoPressing, onSavedCopyRemoved,
}: SaveDestinationActionsProps) {
  const [comparing, setComparing] = useState(false);
  const [chosenShelf, setChosenShelf] = useState<Shelf>();
  const destination = pending && pending !== 'move' ? pending : chosenShelf ?? preferred;
  const statusId = useId();
  const guidanceId = useId();
  const compareButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const blocked = !!pending || !!disabled || !!openingSaved;
  const titleOnly = existingStatus && !isExactSavedMatch(existingMatch);
  const matches = titleMatches?.length ? titleMatches : !existingStatus || existingAlbumId == null ? [] : [{
    id: existingAlbumId, title: albumTitle, artist_name: lookup?.artist ?? '', status: existingStatus,
    discogs_id: existingMatch === 'release' ? lookup?.releaseId : undefined,
  }];
  const savedId = existingAlbumId ?? (matches.length === 1 ? matches[0].id : undefined);
  const savedShelfNames = [...new Set(matches.map(copy => shelfNames[copy.status]))];
  const matchedShelves = savedShelfNames.length ? savedShelfNames.join(' and ') : existingStatus && shelfNames[existingStatus];
  const savedPressing = matches.length === 1 ? savedPressingLabel(matches[0]) : undefined;
  const reviewLabel = `Review pressings for ${catalogLabel ?? albumTitle}`;
  const canReviewSaved = !!onOpenSaved && matches.length > 0;
  const canReviewNew = !!(catalogLabel ? onReviewPressings : onReviewNewPressings);
  const existingEntry = matches.length === 1 ? `your ${shelfNames[matches[0].status]} entry` : 'the saved entry you choose';
  const newSaveGuidance = `Save the album to ${shelfNames[destination]} and identify its pressing later.${
    canReviewNew ? ' Review to confirm an exact Discogs release.' : ''}`;
  const savedTitleGuidance = `Side A saves one entry per artist and title.${canReviewSaved && onSavePressing
    ? ` Confirming a pressing updates ${existingEntry}.` : ''}`;
  const comparison = comparing && onOpenSaved && (
    <PressingComparison title={albumTitle} lookup={lookup} lookupChoices={lookupChoices} matches={matches} onSavePressing={onSavePressing}
      searchedNumber={searchedNumber}
      onUndoPressing={onUndoPressing} onSavedCopyRemoved={onSavedCopyRemoved}
      returnFocusTo={compareButton} fallbackFocusTo={addButton} onClose={() => setComparing(false)} onOpenSaved={onOpenSaved}
      searchLabel={searchLabel} onSearch={onSearch && (() => { setComparing(false); onSearch(); })} />
  );

  if (catalogLabel) {
    const name = shelfNames[destination];
    const canOpen = !!onOpenSaved && savedId != null;
    const canCompare = (titleOnly || !!lookupChoices?.some(choice => choice.releaseId !== lookup?.releaseId)) && canReviewSaved;
    const compareFirst = canCompare && ((titleOnly && !savedHere) || !canOpen);
    const reviewIsPrimary = !existingStatus && !!onReviewPressings && !!reviewFirst;
    const canMove = existingStatus === 'wishlist' && existingAlbumId != null && isExactSavedMatch(existingMatch);
    const opensDialog = reviewIsPrimary || (!!existingStatus && (canOpen || canCompare));
    const savedRecordLabel = titleOnly && matches.length === 1 ? savedCopyLabel(matches[0]) : catalogLabel;
    const primaryLabel = !existingStatus ? (pending === destination ? `Adding to ${name}…`
      : reviewIsPrimary ? 'Review pressings' : onReviewPressings ? `Save without pressing to ${name}` : `Add to ${name}`)
      : compareFirst ? 'Review pressings' : openingSaved ? 'Opening album…' : canOpen ? 'Open saved album' : 'Saved album';
    const savedLabel = titleOnly && !savedHere ? `Title already in ${matchedShelves}`
      : `${existingMatch === 'release' ? 'This pressing' : 'Album'} saved in ${matchedShelves}`;
    const savedEdition = matches.length === 1 && matches[0].discogs_id
      ? `Saved Discogs release ${matches[0].discogs_id}` : 'Saved pressing unconfirmed';
    const guidance = !existingStatus ? newSaveGuidance : titleOnly && (!savedHere || (canCompare && onSavePressing)) ? savedTitleGuidance : undefined;
    const actionDescription = [existingStatus && statusId, guidance && guidanceId].filter(Boolean).join(' ');
    const compare = () => setComparing(true);
    return (
      <div className="rh-destination-actions grid min-w-0 gap-1">
        <p id={statusId} role="status" className={existingStatus ? 'rh-saved-outcome' : 'sr-only'}>
          {existingStatus && <>{savedLabel}{titleOnly && savedPressing && ` · ${savedEdition}`}</>}
        </p>
        {!existingStatus && <SaveShelfSelect value={destination} onChange={setChosenShelf} albumTitle={albumTitle} disabled={blocked} />}
        {guidance && <p id={guidanceId} className="rh-album-level-hint">{guidance}</p>}
        {/* The Add control becomes the saved-record action on the same DOM node. */}
        <button type="button" data-catalog-primary ref={element => {
          addButton.current = element;
          if (compareFirst) compareButton.current = element;
        }}
          className={existingStatus ? 'rh-lookup-link text-left' : 'min-h-11 rounded-lg border border-gray-300 bg-gray-100 px-2 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-50'}
          aria-label={compareFirst || reviewIsPrimary ? reviewLabel : `${primaryLabel} · ${canOpen ? savedRecordLabel : catalogLabel}`}
          aria-describedby={actionDescription || undefined}
          aria-disabled={blocked || (!!existingStatus && !opensDialog)} aria-busy={!!pending || !!openingSaved}
          aria-haspopup={opensDialog ? 'dialog' : undefined}
          onClick={event => {
            if (blocked) return;
            if (reviewIsPrimary) onReviewPressings(destination, event.currentTarget);
            else if (!existingStatus) onSelect(destination);
            else if (compareFirst) compare();
            else if (canOpen) void onOpenSaved(savedId, event.currentTarget);
          }}>
          {primaryLabel}
        </button>
        {reviewIsPrimary && <button type="button" className="rh-lookup-link text-left" aria-disabled={blocked}
          aria-label={`Save without pressing to ${name} · ${catalogLabel}`} aria-describedby={guidanceId}
          onClick={() => { if (!blocked) onSelect(destination); }}>Save without pressing to {name}</button>}
        {!existingStatus && onReviewPressings && !reviewIsPrimary && <button type="button" className="rh-lookup-link text-left"
          aria-disabled={blocked} aria-haspopup="dialog" aria-label={reviewLabel} aria-describedby={guidanceId}
          onClick={event => { if (!blocked) onReviewPressings(destination, event.currentTarget); }}>Review pressings</button>}
        {canCompare && !compareFirst && <button ref={compareButton} type="button" className="rh-lookup-link text-left"
          aria-disabled={blocked} aria-haspopup="dialog" aria-label={reviewLabel} aria-describedby={guidance ? guidanceId : undefined}
          onClick={() => { if (!blocked) compare(); }}>Review pressings</button>}
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
          <p id={guidanceId} className="rh-album-level-hint">{savedTitleGuidance}</p>
          {canReviewSaved && (
            <button ref={compareButton} type="button" className="rh-lookup-link text-left" disabled={blocked}
              aria-haspopup="dialog" aria-label={reviewLabel} aria-describedby={guidanceId} onClick={() => setComparing(true)}>
              Review pressings
            </button>
          )}
        </div>
        {comparison}
      </>
    );
  }

  const choices: DestinationChoice[] = existingStatus
    ? [{ shelf: existingStatus }]
    : [{ shelf: destination, action: destination }];

  if (existingStatus === 'wishlist' && existingAlbumId != null && isExactSavedMatch(existingMatch)) {
    choices.push({ shelf: 'collection', action: 'move' });
  }

  const renderChoice = ({ shelf, action }: DestinationChoice) => {
    const name = shelfNames[shelf];
    const moving = action === 'move';
    const unavailable = !action || blocked;
    const busy = !!action && pending === action;
    const canReview = action === shelf && !!onReviewNewPressings;
    const label = canReview ? `Save without pressing to ${name}` : action ? `${moving ? 'Move' : 'Add'} to ${name}` : `Saved in ${name}`;
    const matchReason = existingMatch === 'release' ? 'Matched by Discogs release' : 'Matched by barcode';
    const accessibleLabel = canReview ? `${label} · ${albumTitle}` : action
      ? `${moving ? 'Move' : 'Add'} ${albumTitle} to ${name}`
      : `${albumTitle}: ${label}`;
    const color = !action
      ? 'border-gray-300 text-gray-600'
      : moving || shelf === destination
        ? 'rh-filled-action border-transparent bg-purple-600 hover:bg-purple-700'
        : 'border-gray-300 bg-gray-100 text-gray-900 hover:bg-gray-50';

    return (
      <div key={shelf} className="grid gap-1">
        {canReview && <button type="button" className="rh-lookup-link text-left" aria-haspopup="dialog" aria-disabled={blocked}
          aria-label={`Review pressings for ${albumTitle} in ${name}`} aria-describedby={guidanceId} onClick={event => {
            if (!blocked) onReviewNewPressings(shelf, event.currentTarget);
          }}>Review pressings</button>}
        <button
          ref={shelf === destination && action === destination ? addButton : undefined}
          type="button"
          aria-label={accessibleLabel}
          aria-describedby={!existingStatus && action === shelf ? guidanceId : undefined}
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
      </div>
    );
  };

  return (
    <>
      <div className="rh-destination-actions grid min-w-0 gap-1.5">
        {!existingStatus && <SaveShelfSelect value={destination} onChange={setChosenShelf} albumTitle={albumTitle} disabled={blocked} />}
        {!existingStatus && <p id={guidanceId} className="rh-album-level-hint">{newSaveGuidance}</p>}
        {choices.map(renderChoice)}
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
