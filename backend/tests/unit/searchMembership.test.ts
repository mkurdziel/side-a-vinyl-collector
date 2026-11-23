import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const { query, searchByQuery, searchArtist, getArtistReleases, mbEnabled, mbArtist, mbReleases } = vi.hoisted(() => ({
  query: vi.fn(),
  searchByQuery: vi.fn(),
  searchArtist: vi.fn(),
  getArtistReleases: vi.fn(),
  mbEnabled: vi.fn(),
  mbArtist: vi.fn(),
  mbReleases: vi.fn(),
}));
vi.mock('../../src/config/database', () => ({ default: { query } }));
vi.mock('../../src/services/discogs', () => ({
  default: {
    isEnabled: () => true,
    searchArtist,
    getArtistReleases,
    searchByQuery,
  },
}));
vi.mock('../../src/services/musicbrainz', () => ({
  default: { isEnabled: mbEnabled, searchArtist: mbArtist, getArtistReleaseGroups: mbReleases },
}));
vi.mock('../../src/services/vision', () => ({
  default: { extractAlbumInfo: async () => ({ artist: 'John Coltrane', album: 'Giant Steps', provider: 'openai' }) },
}));

import { analyzeImage } from '../../src/controllers/imageController';
import { search } from '../../src/controllers/searchController';
import { annotateCatalogMembership } from '../../src/services/catalogMembership';

const catalogAlbum = { id: 101, discogsId: 101, artist: 'John Coltrane', album: 'Giant Steps' };
const savedAlbum = { id: 1, artist_name: 'John Coltrane', title: 'Giant Steps', status: 'wishlist' };
type Membership = { existingAlbumId: number | null; inCollection: boolean; inWishlist: boolean; existingMatch?: string };

function searchCatalog(): Promise<{ discogs: Membership[] }> {
  return new Promise((resolve, reject) => {
    const req = { query: { q: 'Coltrane' } } as unknown as Request;
    const res = { json: resolve } as unknown as Response;
    search(req, res, reject);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  searchByQuery.mockResolvedValue([catalogAlbum]);
  searchArtist.mockResolvedValue(null);
  mbEnabled.mockReturnValue(false);
});

describe('search result membership', () => {
  it('returns saved search results for the requested shelf without waiting for a catalog', async () => {
    query.mockResolvedValueOnce({ rows: [savedAlbum] });
    const result = await new Promise<{ local: typeof savedAlbum[]; discogs: unknown[] }>((resolve, reject) => {
      const req = { query: { q: 'Coltrane', scope: 'saved', shelf: 'wishlist' } } as unknown as Request;
      search(req, { json: resolve } as unknown as Response, reject);
    });

    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('collections.status = $2'), ['Coltrane', 'wishlist', 20, 0, null]);
    expect(result).toEqual({ local: [savedAlbum], discogs: [], errors: [] });
    expect(searchByQuery).not.toHaveBeenCalled();
  });

  it('uses the requested saved offset and only returns a continuation when another row exists', async () => {
    query.mockResolvedValueOnce({ rows: Array.from({ length: 21 }, (_, id) => ({ ...savedAlbum, id })) });
    const result = await new Promise<{ local: typeof savedAlbum[]; nextOffset?: number }>((resolve, reject) => {
      const req = { query: { q: 'Coltrane', scope: 'saved', offset: '20', sort: 'artist' } } as unknown as Request;
      search(req, { json: resolve } as unknown as Response, reject);
    });
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('LIMIT $3 OFFSET $4'), ['Coltrane', null, 21, 20, 'artist']);
    expect(result.local).toHaveLength(20);
    expect(result.nextOffset).toBe(40);
    expect(searchByQuery).not.toHaveBeenCalled();
  });

  it('returns the next catalog matches from the same provider window', async () => {
    searchByQuery.mockResolvedValueOnce(Array.from({ length: 40 }, (_, id) => ({
      ...catalogAlbum, id, discogsId: id, album: `Test album ${id}`,
    })));
    query.mockResolvedValue({ rows: [] });
    const result = await new Promise<{ discogs: { id: number }[]; catalogSampled: boolean; nextOffset?: number }>((resolve, reject) => {
      const req = { query: { q: 'Coltrane', scope: 'catalog', offset: '30' } } as unknown as Request;
      search(req, { json: resolve } as unknown as Response, reject);
    });
    expect(searchByQuery).toHaveBeenCalledExactlyOnceWith('Coltrane', 40);
    expect(result.discogs.map(album => album.id)).toEqual([30, 31, 32, 33, 34, 35, 36, 37, 38, 39]);
    expect(result.catalogSampled).toBe(true);
    expect(result.nextOffset).toBeUndefined();
  });

  it('ranks the exact numeric title above partial matches and skips artist expansions', async () => {
    const taylorSwift = { id: 912, discogsId: 912, artist: 'Taylor Swift', album: '1989' };
    mbEnabled.mockReturnValue(true);
    searchByQuery.mockResolvedValue([
      { id: 900, discogsId: 900, artist: '1989', album: 'The Right Life' },
      { id: 901, discogsId: 901, artist: 'Croatian Amor', album: '1989 Is Croatian Amor' },
      taylorSwift,
    ]);
    query.mockResolvedValue({ rows: [] });
    const result = await new Promise<{ discogs: { id: number }[] }>((resolve, reject) => {
      search({ query: { q: '1989', scope: 'catalog', offset: '0' } } as unknown as Request,
        { json: resolve } as unknown as Response, reject);
    });
    expect(result.discogs.map(album => album.id)).toEqual([912, 901]);
    expect(searchArtist).not.toHaveBeenCalled();
    expect(mbArtist).not.toHaveBeenCalled();
  });

  it('rejects unrelated provider matches and does not expand an unrelated artist', async () => {
    mbEnabled.mockReturnValue(true);
    searchArtist.mockResolvedValue({ id: 42, title: 'Croatian Amor' });
    mbArtist.mockResolvedValue({ id: 'no-match', name: 'Dan Gibson' });
    searchByQuery.mockResolvedValue([{ id: 19, discogsId: 19, artist: 'Dan Gibson', album: 'Ocean Surf' }]);
    const result = await new Promise<{ discogs: unknown[]; errors: unknown[] }>((resolve, reject) => {
      search({ query: { q: 'zzzxqv-047-no-record', scope: 'catalog' } } as unknown as Request,
        { json: resolve } as unknown as Response, reject);
    });
    expect(result).toMatchObject({ discogs: [], errors: [] });
    expect(getArtistReleases).not.toHaveBeenCalled();
    expect(mbReleases).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('expands an exact artist despite accents and Discogs disambiguation', async () => {
    const album = { id: 38, discogsId: 38, artist: '', album: 'Renaissance', discogsListing: 'release' };
    searchArtist.mockResolvedValue({ id: 42, title: 'Beyoncé (2)' });
    getArtistReleases.mockResolvedValue([album]);
    searchByQuery.mockResolvedValue([]);
    query.mockResolvedValue({ rows: [] });
    const result = await new Promise<{ discogs: unknown[] }>((resolve, reject) => {
      search({ query: { q: 'Beyonce', scope: 'catalog' } } as unknown as Request,
        { json: resolve } as unknown as Response, reject);
    });
    expect(getArtistReleases).toHaveBeenCalledExactlyOnceWith(42, 20);
    expect(result.discogs).toMatchObject([{ id: 38, artist: 'Beyoncé (2)', album: 'Renaissance' }]);
  });

  it('links the exact Discogs match even when another name match is in Collection', async () => {
    const collectionMatch = { ...savedAlbum, status: 'collection' };
    query.mockResolvedValueOnce({ rows: [collectionMatch] }).mockResolvedValueOnce({ rows: [
      collectionMatch,
      { ...savedAlbum, id: 2, discogs_id: catalogAlbum.discogsId },
    ] });

    const result = await searchCatalog();
    expect(result.discogs[0]).toMatchObject({
      existingAlbumId: 2,
      inCollection: false,
      inWishlist: true,
      existingMatch: 'release',
    });
  });

  it('links a normalized artist and title only when they identify a single saved album', async () => {
    const nameMatch = { ...savedAlbum, title: 'Giant Steps!' };
    query
      .mockResolvedValueOnce({ rows: [nameMatch] })
      .mockResolvedValueOnce({ rows: [nameMatch] })
      .mockResolvedValueOnce({ rows: [nameMatch] })
      .mockResolvedValueOnce({ rows: [nameMatch, { ...savedAlbum, id: 2 }] });

    const single = await searchCatalog();
    expect(single.discogs[0]).toMatchObject({ existingAlbumId: 1, inWishlist: true, existingMatch: 'title' });
    const ambiguous = await searchCatalog();
    expect(ambiguous.discogs[0]).toMatchObject({ existingAlbumId: null, inWishlist: true });
  });

  it('uses the same exact membership for photo matches', async () => {
    query.mockResolvedValueOnce({ rows: [
      { ...savedAlbum, id: 2, discogs_id: catalogAlbum.discogsId },
      { ...savedAlbum, status: 'collection' },
    ] });
    const result = await new Promise<{ discogsMatches: Membership[] }>((resolve, reject) => {
      const req = { body: { image: 'data:image/jpeg;base64,example' } } as Request;
      const res = { json: resolve } as unknown as Response;
      analyzeImage(req, res, reject);
    });

    expect(result.discogsMatches[0]).toMatchObject({
      existingAlbumId: 2,
      inCollection: false,
      inWishlist: true,
      existingMatch: 'release',
    });
  });

  it('does not describe a master listing as an exact saved release', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...savedAlbum, discogs_id: catalogAlbum.discogsId }] });
    const [match] = await annotateCatalogMembership([{ ...catalogAlbum, discogsListing: 'master' }]);
    expect(match).toMatchObject({ existingAlbumId: savedAlbum.id, existingMatch: 'title' });
  });
});
