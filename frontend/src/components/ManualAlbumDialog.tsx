import { useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { ApiError, type Album } from '../services/api';
import { ModalDialog } from './ModalDialog';
import { SaveShelfSelect } from './SaveDestinationActions';

export type ManualAlbumDraft = { artist?: string; album?: string; searchText?: string };
type Shelf = Album['status'];

interface Props {
  draft: ManualAlbumDraft;
  initialShelf: Shelf;
  onClose: () => void;
  onSaved: (album: Album) => void;
  onOpenSaved: (id: number) => Promise<void>;
}

export function ManualAlbumDialog({ draft, initialShelf, onClose, onSaved, onOpenSaved }: Props) {
  const [destination, setDestination] = useState(initialShelf);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicateId, setDuplicateId] = useState<number>();
  const inFlight = useRef(false);
  const reference = useRef<HTMLInputElement>(null);
  const artistField = useRef<HTMLInputElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const label = destination === 'collection' ? 'Collection' : 'Wishlist';

  const close = () => {
    if (!inFlight.current) onClose();
  };

  const clearIssue = () => {
    setError('');
    setDuplicateId(undefined);
  };

  const copyReferenceTo = (field: HTMLInputElement | null) => {
    const text = reference.current?.value.trim();
    if (!field || !text) return;
    field.value = text;
    clearIssue();
    field.focus();
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || duplicateId !== undefined) return;
    const fields = new FormData(event.currentTarget);
    const artist = String(fields.get('artist') ?? '').trim();
    const album = String(fields.get('album') ?? '').trim();
    if (!artist || !album) {
      setError('Enter an artist and album title.');
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const { album: saved } = await api.addAlbum({ artist, album, status: destination });
      toast.success(`“${saved.title}” added to ${label}.`);
      onSaved(saved);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        setError('This album is already saved.');
        setDuplicateId(failure.existingAlbumId);
      } else {
        setError(failure instanceof Error ? failure.message : 'Could not save this album. Try again.');
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <ModalDialog labelledBy="manual-album-title" onClose={close}>
      <div className="rh-dialog-panel max-w-md">
        <header className="rh-dialog-header border-b border-gray-200 p-4 sm:p-5">
          <h2 id="manual-album-title" className="text-xl font-bold">Add album manually</h2>
        </header>
        <form onSubmit={save} className="space-y-4 p-4 sm:p-5">
          <fieldset disabled={saving} className="grid min-w-0 gap-3">
            {draft.searchText && <div className="grid gap-1 rounded-lg border border-gray-300 px-3 py-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Previous search
                <input ref={reference} maxLength={255} defaultValue={draft.searchText}
                  className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base" />
              </label>
              <div className="-ml-2 flex flex-wrap gap-x-2">
                <button type="button" className="rh-lookup-link" onClick={() => copyReferenceTo(artistField.current)}>Use as artist</button>
                <button type="button" className="rh-lookup-link" onClick={() => copyReferenceTo(titleField.current)}>Use as title</button>
              </div>
            </div>}
            <label className="grid gap-1.5 text-sm font-medium">
              Artist
              <input ref={artistField} autoFocus name="artist" required maxLength={255} defaultValue={draft.artist?.slice(0, 255)} onChange={clearIssue}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Album title
              <input ref={titleField} name="album" required maxLength={255} defaultValue={draft.album?.slice(0, 255)} onChange={clearIssue}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base" />
            </label>
            <SaveShelfSelect value={destination} onChange={shelf => { setDestination(shelf); clearIssue(); }} />
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {saving && <p role="status" className="text-sm text-gray-600">Adding to {label}…</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={close} disabled={saving}
              className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm font-semibold disabled:opacity-60">Cancel</button>
            {duplicateId !== undefined ? (
              <button type="button" autoFocus className="rh-primary-action px-3 text-sm font-semibold"
                onClick={() => void onOpenSaved(duplicateId)}>Open saved album</button>
            ) : (
              <button type="submit" disabled={saving} className="rh-primary-action px-3 text-sm font-semibold disabled:opacity-60">
                {saving ? 'Saving…' : `Add to ${label}`}
              </button>
            )}
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
