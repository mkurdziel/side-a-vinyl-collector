type Shelf = 'collection' | 'wishlist';
export type DestinationAction = Shelf | 'move';

const shelfNames: Record<Shelf, string> = { collection: 'Collection', wishlist: 'Wishlist' };

interface SaveDestinationActionsProps {
  albumTitle: string;
  preferred: Shelf;
  existingStatus?: Shelf;
  canMove?: boolean;
  openingSaved?: boolean;
  pending?: DestinationAction;
  disabled?: boolean;
  onSelect: (action: DestinationAction) => void;
  onOpenSaved?: () => void;
}

interface DestinationChoice {
  shelf: Shelf;
  action?: DestinationAction;
}

export function SaveDestinationActions({
  albumTitle, preferred, existingStatus, canMove, openingSaved, pending, disabled, onSelect, onOpenSaved,
}: SaveDestinationActionsProps) {
  const alternative = preferred === 'collection' ? 'wishlist' : 'collection';
  const choices: DestinationChoice[] = existingStatus
    ? [{ shelf: existingStatus }]
    : [{ shelf: preferred, action: preferred }];

  if (existingStatus === 'wishlist' && canMove) choices.push({ shelf: 'collection', action: 'move' });

  const renderChoice = ({ shelf, action }: DestinationChoice) => {
    const name = shelfNames[shelf];
    const moving = action === 'move';
    const blocked = !action || !!pending || !!disabled || !!openingSaved;
    const busy = !!action && pending === action;
    const label = action ? `${moving ? 'Move' : 'Add'} to ${name}` : `In ${name}`;
    const accessibleLabel = action
      ? `${moving ? 'Move' : 'Add'} ${albumTitle} to ${name}`
      : `${albumTitle} is in ${name}`;
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
        aria-disabled={blocked}
        aria-busy={busy}
        tabIndex={action ? undefined : -1}
        className={`min-h-11 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${color}`}
        onClick={() => { if (action && !blocked) onSelect(action); }}
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
      {onOpenSaved && (
        <button type="button" disabled={!!pending || !!disabled || !!openingSaved} aria-busy={!!openingSaved}
          className="min-h-11 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100"
          aria-label={`Open saved album — ${albumTitle}`} onClick={onOpenSaved}>
          {openingSaved ? 'Opening album…' : 'Open saved album'}
        </button>
      )}
    </div>
  );
}
