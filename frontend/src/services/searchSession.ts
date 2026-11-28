import type { Album } from './api';

type Shelf = Album['status'];
export type NameSearchScope = 'saved' | Shelf | 'catalog' | 'collection-catalog' | 'wishlist-catalog';
export type SearchScope = NameSearchScope | 'catalog-number';
export type LookupMode = 'name' | 'catalog-number';
export type ResultKind = 'saved' | 'catalog';

export interface LookupNavigation {
  query: string;
  scope: SearchScope;
  destination: Shelf;
  exactName?: boolean;
}

export interface AddSearchOrigin {
  shelf: Shelf;
  scope: NameSearchScope;
  destination: Shelf;
}

export interface LookupAnchor {
  kind: ResultKind;
  target: string;
  throughOffset: number;
}

export interface SearchSession {
  mode: LookupMode;
  shelf: Shelf;
  drafts: Partial<Record<LookupMode, LookupNavigation>>;
  addOrigin?: AddSearchOrigin;
  anchor?: LookupAnchor;
}

const key = 'side-a:search-session:v1';
const isShelf = (value: unknown): value is Shelf => value === 'collection' || value === 'wishlist';
const isNameScope = (value: unknown): value is NameSearchScope => value === 'saved' || value === 'catalog' ||
  value === 'collection-catalog' || value === 'wishlist-catalog' || isShelf(value);
export const lookupMode = (scope: SearchScope): LookupMode => scope === 'catalog-number' ? 'catalog-number' : 'name';
export const isSingleCharacterName = (query: string, scope: SearchScope) => scope !== 'catalog-number' && [...query.trim()].length === 1;
export const searchesCatalog = (scope: SearchScope) => scope === 'catalog' || scope === 'catalog-number' ||
  scope === 'collection-catalog' || scope === 'wishlist-catalog';

function parseNavigation(value: unknown, mode: LookupMode): LookupNavigation | undefined {
  if (!value || typeof value !== 'object') return;
  const { query, scope, destination, exactName } = value as Partial<LookupNavigation>;
  if (typeof query !== 'string' || !isShelf(destination)) return;
  if ((mode === 'name' && isNameScope(scope)) || (mode === 'catalog-number' && scope === 'catalog-number')) {
    return { query, scope, destination, ...(exactName === true && isSingleCharacterName(query, scope) ? { exactName } : {}) };
  }
}

function parseOrigin(value: unknown): AddSearchOrigin | undefined {
  if (!value || typeof value !== 'object') return;
  const { shelf, scope, destination } = value as Partial<AddSearchOrigin>;
  if (isShelf(shelf) && isNameScope(scope) && isShelf(destination)) return { shelf, scope, destination };
}

function parseAnchor(value: unknown, active?: LookupNavigation): LookupAnchor | undefined {
  if (!value || typeof value !== 'object' || !active || (active.query.trim().length < 2 && !active.exactName)) return;
  const { target, kind, throughOffset } = value as Partial<LookupAnchor>;
  if (typeof target !== 'string' || typeof throughOffset !== 'number' || !Number.isSafeInteger(throughOffset) || throughOffset < 0) return;
  if (kind === 'saved' && active.scope !== 'catalog-number' && /^saved-result-\d+$/.test(target)) return { target, kind, throughOffset };
  if (kind !== 'catalog' || !searchesCatalog(active.scope) || isSingleCharacterName(active.query, active.scope)) return;
  if (target.startsWith('catalog-result-') || (active.scope === 'catalog-number' && /^number-saved-result-\d+$/.test(target))) {
    return { target, kind, throughOffset };
  }
}

export function readSearchSession(): SearchSession | undefined {
  try {
    const raw = globalThis.sessionStorage.getItem(key);
    const session = (raw ? JSON.parse(raw) : null) as Partial<SearchSession> | null;
    if (!session || !isShelf(session.shelf) || (session.mode !== 'name' && session.mode !== 'catalog-number')) return;
    const drafts = {
      name: parseNavigation(session.drafts?.name, 'name'),
      'catalog-number': parseNavigation(session.drafts?.['catalog-number'], 'catalog-number'),
    };
    const mode = drafts[session.mode] ? session.mode : 'name';
    return { mode, shelf: session.shelf, drafts, addOrigin: parseOrigin(session.addOrigin), anchor: parseAnchor(session.anchor, drafts[mode]) };
  } catch {
    // The lookup can continue in memory if tab storage is unavailable or damaged.
  }
}

export function writeSearchSession(session: SearchSession) {
  try {
    globalThis.sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Tab navigation still works when the browser cannot retain a session.
  }
}
