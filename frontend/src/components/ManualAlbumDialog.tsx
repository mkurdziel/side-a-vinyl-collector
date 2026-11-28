import { useId, useLayoutEffect, useRef, useState } from 'react';
import api, { ApiError, type Album } from '../services/api';
import { discardManualAlbumDraft, saveManualAlbumDraft, type ManualAlbumValues, type StoredManualAlbumDraft } from '../services/manualAlbumDrafts';
import { ModalDialog } from './ModalDialog';
import { SaveShelfSelect } from './SaveDestinationActions';

export type ManualAlbumDraft = { artist?: string; album?: string; searchText?: string };
type Shelf = Album['status'];

interface Props {
  draft: ManualAlbumDraft;
  initialShelf: Shelf;
  resumeDraft?: StoredManualAlbumDraft;
  onClose: () => void;
  /** Refresh the library. The dialog keeps its receipt open until the collector chooses Done. */
  onSaved: (album: Album) => void;
  onOpenSaved: (id: number, opener: HTMLButtonElement) => Promise<void>;
}

export function ManualAlbumDialog({ draft, initialShelf, resumeDraft, onClose, onSaved, onOpenSaved }: Props) {
  const headingId = useId();
  const [values, setValues] = useState<ManualAlbumValues>(() => {
    const initial = resumeDraft ?? draft;
    return { artist: initial.artist?.slice(0, 255) ?? '', album: initial.album?.slice(0, 255) ?? '',
      searchText: initial.searchText?.slice(0, 255), shelf: resumeDraft?.shelf ?? initialShelf };
  });
  const latestValues = useRef(values);
  const draftId = useRef(resumeDraft?.id);
  const [draftInfo, setDraftInfo] = useState<{ id: string; durable: boolean } | undefined>(resumeDraft && {
    id: resumeDraft.id, durable: !resumeDraft.inMemoryOnly,
  });
  const [receipt, setReceipt] = useState<Album>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicateId, setDuplicateId] = useState<number>();
  const inFlight = useRef(false);
  const artistField = useRef<HTMLInputElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const addAnotherButton = useRef<HTMLButtonElement>(null);
  const openSavedButton = useRef<HTMLButtonElement>(null);
  const focusNewArtist = useRef(false);
  const label = values.shelf === 'collection' ? 'Collection' : 'Wishlist';
  const focusTitle = !!resumeDraft?.artist.trim() && !!values.artist.trim() && !values.album.trim();

  useLayoutEffect(() => {
    if (receipt) addAnotherButton.current?.focus();
    if (!receipt && focusNewArtist.current) {
      focusNewArtist.current = false;
      artistField.current?.focus();
    }
  }, [receipt]);

  useLayoutEffect(() => {
    if (duplicateId !== undefined) openSavedButton.current?.focus();
  }, [duplicateId]);

  const close = () => {
    if (!inFlight.current) onClose();
  };

  const clearIssue = () => {
    setError('');
    setDuplicateId(undefined);
  };

  const forgetDraft = () => {
    if (draftId.current) discardManualAlbumDraft(draftId.current);
    draftId.current = undefined;
    setDraftInfo(undefined);
  };

  const persist = (next: ManualAlbumValues) => {
    if (!next.artist.trim() && !next.album.trim() && !next.searchText?.trim()) {
      forgetDraft();
      return;
    }
    const savedDraft = saveManualAlbumDraft(next, draftId.current);
    draftId.current = savedDraft.id;
    setDraftInfo(current => current?.id === savedDraft.id && current.durable === savedDraft.durable ? current : savedDraft);
  };

  const change = (patch: Partial<ManualAlbumValues>, changesIdentity = false) => {
    const next = { ...latestValues.current, ...patch };
    latestValues.current = next;
    setValues(next);
    persist(next);
    if (changesIdentity) clearIssue();
  };

  const copyReferenceTo = (field: 'artist' | 'album') => {
    const text = latestValues.current.searchText?.trim();
    if (!text) return;
    change({ [field]: text }, true);
    (field === 'artist' ? artistField : titleField).current?.focus();
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || duplicateId !== undefined) return;
    const current = latestValues.current;
    const artist = current.artist.trim();
    const album = current.album.trim();
    if (!artist || !album) {
      setError('Enter an artist and album title.');
      return;
    }
    persist(current);
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const { album: saved } = await api.addAlbum({ artist, album, status: current.shelf });
      forgetDraft();
      setReceipt(saved);
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

  const addAnother = () => {
    if (!receipt) return;
    const next = { artist: '', album: '', shelf: receipt.status };
    latestValues.current = next;
    setValues(next);
    setReceipt(undefined);
    focusNewArtist.current = true;
  };

  return (
    <ModalDialog labelledBy={headingId} onClose={close}>
      <div className="rh-dialog-panel max-w-md">
        <header className="rh-dialog-header border-b border-gray-200 p-4 sm:p-5">
          <h2 id={headingId} className="text-xl font-bold">Add album manually</h2>
        </header>
        {receipt ? <div className="grid gap-3 p-4 sm:p-5">
          <p role="status" className="[overflow-wrap:anywhere]">
            “{receipt.title}” saved to {receipt.status === 'collection' ? 'Collection' : 'Wishlist'}.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={close} className="rh-lookup-link">Done</button>
            <button ref={addAnotherButton} type="button" onClick={addAnother} className="rh-primary-action px-3 text-sm font-semibold">
              Add another record
            </button>
          </div>
        </div> : <form onSubmit={save} className="space-y-4 p-4 sm:p-5">
          <fieldset disabled={saving} className="grid min-w-0 gap-3">
            {values.searchText !== undefined && <div className="grid gap-1 rounded-lg border border-gray-300 px-3 py-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Previous search
                <input maxLength={255} value={values.searchText} onChange={event => change({ searchText: event.target.value })}
                  className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base" />
              </label>
              <div className="-ml-2 flex flex-wrap gap-x-2">
                <button type="button" className="rh-lookup-link" onClick={() => copyReferenceTo('artist')}>Use as artist</button>
                <button type="button" className="rh-lookup-link" onClick={() => copyReferenceTo('album')}>Use as title</button>
              </div>
            </div>}
            <label className="grid gap-1.5 text-sm font-medium">
              Artist
              <input ref={artistField} autoFocus={!focusTitle} name="artist" required maxLength={255} value={values.artist}
                onChange={event => change({ artist: event.target.value }, true)}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Album title
              <input ref={titleField} autoFocus={focusTitle} name="album" required maxLength={255} value={values.album}
                onChange={event => change({ album: event.target.value }, true)}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base" />
            </label>
            <SaveShelfSelect value={values.shelf} onChange={shelf => change({ shelf })} />
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {saving && <p role="status" className="text-sm text-gray-600">Adding to {label}…</p>}
          {draftInfo && !saving && <p role="status" className="text-xs text-gray-600">
            {draftInfo.durable === false ? 'Draft available until you reload this tab.' : 'Draft available to resume from Add Album.'}
          </p>}
          <div className="flex flex-wrap justify-end gap-2">
            {draftInfo && <button type="button" className="rh-lookup-link" disabled={saving} onClick={() => {
              if (inFlight.current) return;
              forgetDraft();
              close();
            }}>Discard draft</button>}
            <button type="button" onClick={close} disabled={saving}
              className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm font-semibold disabled:opacity-60">
              {draftInfo ? 'Close and keep draft' : 'Cancel'}
            </button>
            {duplicateId !== undefined ? (
              <button ref={openSavedButton} type="button" className="rh-primary-action px-3 text-sm font-semibold"
                onClick={event => void onOpenSaved(duplicateId, event.currentTarget)}>Open saved album</button>
            ) : (
              <button type="submit" disabled={saving} className="rh-primary-action px-3 text-sm font-semibold disabled:opacity-60">
                {saving ? 'Saving…' : `Add to ${label}`}
              </button>
            )}
          </div>
        </form>}
      </div>
    </ModalDialog>
  );
}
