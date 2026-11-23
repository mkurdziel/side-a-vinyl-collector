import type { ManualAlbumDraft } from './ManualAlbumDialog';

interface Props {
  draft?: ManualAlbumDraft;
  disabled?: boolean;
  direct?: boolean;
  onSearchByName: (query?: string, draft?: ManualAlbumDraft) => void;
  onManual: (draft?: ManualAlbumDraft) => void;
}

export function LookupRecovery({ draft, disabled, direct, onSearchByName, onManual }: Props) {
  const search = [draft?.artist, draft?.album].filter(Boolean).join(' ');
  const actions = (
    <div className="flex flex-wrap gap-x-2">
      <button type="button" className="rh-lookup-link" disabled={disabled}
        onClick={() => onSearchByName(search || undefined, draft)}>
        Search by name
      </button>
      <button type="button" className="rh-lookup-link" disabled={disabled} onClick={() => onManual(draft)}>
        Add album manually
      </button>
    </div>
  );
  return direct ? actions : (
    <details className="rh-lookup-recovery">
      <summary>None of these</summary>
      {actions}
    </details>
  );
}
