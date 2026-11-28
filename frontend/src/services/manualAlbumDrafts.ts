import type { Album } from './api';

export interface ManualAlbumValues {
  artist: string;
  album: string;
  searchText?: string;
  shelf: Album['status'];
}

export interface StoredManualAlbumDraft extends ManualAlbumValues {
  id: string;
  updatedAt: number;
  inMemoryOnly?: true;
}

const prefix = 'side-a:manual-album-draft:v1:';
const tabDrafts = new Map<string, StoredManualAlbumDraft | null>();

function parseDraft(value: string | null, id: string): StoredManualAlbumDraft | undefined {
  try {
    const draft = (value ? JSON.parse(value) : null) as Partial<StoredManualAlbumDraft> | null;
    if (draft?.id !== id || typeof draft.artist !== 'string' || typeof draft.album !== 'string'
      || (draft.searchText !== undefined && typeof draft.searchText !== 'string')
      || (draft.shelf !== 'collection' && draft.shelf !== 'wishlist')
      || typeof draft.updatedAt !== 'number' || !Number.isFinite(draft.updatedAt)) return;
    return { id, artist: draft.artist, album: draft.album, shelf: draft.shelf, searchText: draft.searchText, updatedAt: draft.updatedAt };
  } catch {
    // Ignore a damaged draft while retaining the other entries.
  }
}

export function saveManualAlbumDraft(values: ManualAlbumValues, previousId?: string) {
  const id = previousId ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const draft = { ...values, id, updatedAt: Date.now() };
  try {
    globalThis.localStorage.setItem(prefix + id, JSON.stringify(draft));
    tabDrafts.delete(id);
    return { id, durable: true };
  } catch {
    tabDrafts.set(id, { ...draft, inMemoryOnly: true });
    return { id, durable: false };
  }
}

export function discardManualAlbumDraft(id: string) {
  try {
    globalThis.localStorage.removeItem(prefix + id);
    tabDrafts.delete(id);
  } catch {
    tabDrafts.set(id, null);
  }
}

export function readManualAlbumDrafts(): StoredManualAlbumDraft[] {
  const drafts = new Map<string, StoredManualAlbumDraft>();
  try {
    const storage = globalThis.localStorage;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      const draft = parseDraft(storage.getItem(key), id);
      if (draft) drafts.set(id, draft);
    }
  } catch {
    // The current tab can still resume edits made with browser storage unavailable.
  }
  for (const [id, draft] of tabDrafts) {
    if (draft) drafts.set(id, draft);
    else drafts.delete(id);
  }
  return [...drafts.values()].sort((first, second) => second.updatedAt - first.updatedAt);
}
