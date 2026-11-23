import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const { query, searchByQuery } = vi.hoisted(() => ({
  query: vi.fn(),
  searchByQuery: vi.fn(),
}));
vi.mock('../../src/config/database', () => ({ default: { query } }));
vi.mock('../../src/services/discogs', () => ({
  default: {
    isEnabled: () => true,
    searchArtist: async () => null,
    searchByQuery,
  },
}));
vi.mock('../../src/services/musicbrainz', () => ({ default: { isEnabled: () => false } }));
vi.mock('../../src/services/vision', () => ({
  default: { extractAlbumInfo: async () => ({ artist: 'John Coltrane', album: 'Giant Steps', provider: 'openai' }) },
}));

import { analyzeImage } from '../../src/controllers/imageController';
import { search } from '../../src/controllers/searchController';

const catalogAlbum = { id: 101, discogsId: 101, artist: 'John Coltrane', album: 'Giant Steps' };
const savedAlbum = { id: 1, artist_name: 'John Coltrane', title: 'Giant Steps', status: 'wishlist' };
type Membership = { existingAlbumId: number | null; inCollection: boolean; inWishlist: boolean };

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
});

describe('search result membership', () => {
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
    expect(single.discogs[0]).toMatchObject({ existingAlbumId: 1, inWishlist: true });
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
    });
  });
});
