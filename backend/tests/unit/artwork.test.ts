import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, RequestHandler } from 'express';
import type { MusicBrainzAlbum } from '../../src/services/musicbrainz';

const { query, client, musicbrainz, storage, discogs } = vi.hoisted(() => ({
  query: vi.fn(),
  client: { query: vi.fn(), release: vi.fn() },
  musicbrainz: {
    isEnabled: vi.fn(), searchAndGetCoverArt: vi.fn(), getCoverArt: vi.fn(),
    searchReleasesWithCoverArt: vi.fn(), downloadCoverArt: vi.fn(),
  },
  storage: { saveCoverArt: vi.fn(), exists: vi.fn(), readCoverArt: vi.fn(), getMimeType: vi.fn() },
  discogs: { searchByQuery: vi.fn() },
}));

vi.mock('../../src/config/database', () => ({
  default: { query, connect: async () => client },
}));
vi.mock('../../src/services/musicbrainz', () => ({ default: musicbrainz }));
vi.mock('../../src/services/storage', () => ({ default: storage }));
vi.mock('../../src/services/discogs', () => ({ default: discogs }));

import { addAlbum } from '../../src/controllers/albumController';
import { fetchOfficialCoverArt, searchCoverArt, updateCoverArt } from '../../src/controllers/coverArtController';

const officialUrl = 'https://coverartarchive.org/release/mbid/front.jpg';
const fallbackUrl = 'https://i.discogs.com/fallback.jpg';
const officialAlbum = {
  mbid: 'mbid', artist: 'Portishead', album: 'Dummy', year: 1994,
  coverImageUrl: officialUrl, hasCoverArt: true,
} satisfies MusicBrainzAlbum;

function invoke(handler: RequestHandler, body = {}, search = {}, id = '42') {
  return new Promise<any>((resolve, reject) => {
    const response = {
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      json: resolve,
    } as unknown as Response;
    handler({ params: { id }, query: search, body } as unknown as Request, response, reject);
  });
}

function expectNoFetchedWrite() {
  expect(query.mock.calls.some(([sql]) => /cover_art_fetched\s*=\s*TRUE/i.test(sql))).toBe(false);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  musicbrainz.isEnabled.mockReturnValue(true);
  musicbrainz.searchAndGetCoverArt.mockResolvedValue(null);
  musicbrainz.getCoverArt.mockResolvedValue(null);
  musicbrainz.downloadCoverArt.mockResolvedValue(Buffer.from('image'));
  storage.saveCoverArt.mockResolvedValue('42_fallback.jpg');
  query.mockResolvedValue({ rows: [{
    id: 42, artist: 'Portishead', title: 'Dummy', musicbrainz_id: null,
    cover_image_url: fallbackUrl, local_cover_path: null, cover_art_fetched: false,
  }] });
  // Album already exists; adding it to the collection still starts the background lookup.
  client.query.mockResolvedValue({ rows: [{ id: 42 }], rowCount: 1 });
});
afterEach(() => vi.restoreAllMocks());

describe('automatic artwork on import', () => {
  const body = { artist: 'Portishead', album: 'Dummy', coverImageUrl: fallbackUrl };

  it('saves the MusicBrainz URL instead of falling back to Discogs', async () => {
    musicbrainz.searchAndGetCoverArt.mockResolvedValue(officialAlbum);
    await invoke(addAlbum, body);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/local_cover_path = NULL,[\s\S]*cover_art_fetched = TRUE[\s\S]*AND cover_art_provenance IS NULL/),
      ['mbid', officialUrl, 42],
    );
    expect(musicbrainz.downloadCoverArt).not.toHaveBeenCalled();
  });

  it.each([null, { ...officialAlbum, coverImageUrl: undefined, hasCoverArt: false }])(
    'keeps a missing MusicBrainz image retryable while caching the fallback (%j)', async (result) => {
      musicbrainz.searchAndGetCoverArt.mockResolvedValue(result);
      await invoke(addAlbum, body);
      await vi.waitFor(() => expect(query).toHaveBeenCalledWith(
        'UPDATE albums SET local_cover_path = $1 WHERE id = $2 AND cover_image_url = $3 AND local_cover_path IS NULL', ['42_fallback.jpg', 42, fallbackUrl],
      ));
      expectNoFetchedWrite();
      if (result) {
        expect(query).toHaveBeenCalledWith(
          'UPDATE albums SET musicbrainz_id = $1 WHERE id = $2', ['mbid', 42],
        );
      }
    },
  );

  it('does not mark artwork fetched if the fallback download fails', async () => {
    musicbrainz.downloadCoverArt.mockRejectedValue(new Error('download failed'));
    await invoke(addAlbum, body);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expectNoFetchedWrite();
    expect(storage.saveCoverArt).not.toHaveBeenCalled();
  });

  it('marks a saved fallback fetched when MusicBrainz is disabled', async () => {
    musicbrainz.isEnabled.mockReturnValue(false);
    await invoke(addAlbum, body);
    expect(query).toHaveBeenCalledWith(
      'UPDATE albums SET local_cover_path = $1, cover_art_fetched = TRUE WHERE id = $2 AND cover_image_url = $3 AND local_cover_path IS NULL',
      ['42_fallback.jpg', 42, fallbackUrl],
    );
    expect(musicbrainz.searchAndGetCoverArt).not.toHaveBeenCalled();
  });
});

describe('explicit artwork refresh', () => {
  it.each([null, 'mbid'])('retries legacy fetched records (existing MBID: %s)', async (mbid) => {
    query.mockResolvedValue({ rows: [{
      id: 42, artist: 'Portishead', title: 'Dummy', musicbrainz_id: mbid,
      cover_image_url: fallbackUrl, local_cover_path: 'old.jpg', cover_art_fetched: true,
    }] });
    musicbrainz.searchAndGetCoverArt.mockResolvedValue(officialAlbum);
    musicbrainz.getCoverArt.mockResolvedValue(officialUrl);
    const response = await invoke(fetchOfficialCoverArt);
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/local_cover_path = NULL,[\s\S]*cover_art_fetched = TRUE/),
      ['mbid', officialUrl, '42'],
    );
    expect(response.coverArtUrl).toBe('/api/cover-art/42');
    expect(response.album).toBeDefined();
    if (mbid) expect(musicbrainz.getCoverArt).toHaveBeenCalledWith(mbid);
    else expect(musicbrainz.searchAndGetCoverArt).toHaveBeenCalledWith('Portishead', 'Dummy');
  });

  it('retries after an empty lookup and accepts artwork on the next refresh', async () => {
    await invoke(fetchOfficialCoverArt);
    expectNoFetchedWrite();
    expect(query).toHaveBeenCalledWith(
      'UPDATE albums SET local_cover_path = $1 WHERE id = $2 AND cover_image_url = $3 AND local_cover_path IS NULL', ['42_fallback.jpg', '42', fallbackUrl],
    );
    musicbrainz.searchAndGetCoverArt.mockResolvedValue(officialAlbum);
    await invoke(fetchOfficialCoverArt);
    expect(musicbrainz.searchAndGetCoverArt).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('cover_image_url = $2'), ['mbid', officialUrl, '42']);
  });

  it('preserves the existing image and fetched state when a known MBID has no artwork', async () => {
    query.mockResolvedValue({ rows: [{
      id: 42, musicbrainz_id: 'mbid', cover_image_url: fallbackUrl,
      local_cover_path: 'old.jpg', cover_art_fetched: true,
    }] });
    await invoke(fetchOfficialCoverArt);
    expect(query.mock.calls.filter(([sql]) => /UPDATE albums/.test(sql))).toEqual([]);
    expect(musicbrainz.downloadCoverArt).not.toHaveBeenCalled();
  });

  it('does not mark failed fallback caching as fetched', async () => {
    storage.saveCoverArt.mockRejectedValue(new Error('disk full'));
    await invoke(fetchOfficialCoverArt);
    expectNoFetchedWrite();
    expect(query.mock.calls.filter(([sql]) => /UPDATE albums/.test(sql))).toEqual([]);
  });
});

describe('artwork candidates and manual selection', () => {
  it('returns usable MusicBrainz and Discogs image URLs and filters missing URLs', async () => {
    musicbrainz.searchReleasesWithCoverArt.mockResolvedValue([
      officialAlbum, { ...officialAlbum, coverImageUrl: undefined, hasCoverArt: false },
    ]);
    discogs.searchByQuery.mockResolvedValue([
      { album: 'Dummy', discogsId: 7, coverImageUrl: fallbackUrl }, { album: 'No image' },
    ]);
    const response = await invoke(searchCoverArt);
    expect(response.results).toEqual([
      { source: 'MusicBrainz', url: officialUrl, title: 'Dummy', year: 1994, id: 'mbid' },
      { source: 'Discogs', url: fallbackUrl, title: 'Dummy', id: 7 },
    ]);
    expect(musicbrainz.searchReleasesWithCoverArt).toHaveBeenCalledWith('Portishead', 'Dummy');
    expect(discogs.searchByQuery).toHaveBeenCalledWith('Portishead - Dummy', 5);
  });

  it('uses trimmed artwork search overrides without editing the saved album', async () => {
    musicbrainz.searchReleasesWithCoverArt.mockResolvedValue([]);
    discogs.searchByQuery.mockResolvedValue([]);

    await invoke(searchCoverArt, {}, { artist: '  David Bowie  ', title: ' "Heroes" ' });

    expect(musicbrainz.searchReleasesWithCoverArt).toHaveBeenCalledWith('David Bowie', '\\"Heroes\\"');
    expect(discogs.searchByQuery).toHaveBeenCalledWith('David Bowie - "Heroes"', 5);
    expect(query.mock.calls.filter(([sql]) => /UPDATE albums/.test(sql))).toEqual([]);
  });

  it.each([{ artist: ' ' }, { title: ['First', 'Second'] }, { title: 'x'.repeat(256) }, { title: 'Embedded\nseparator' }])(
    'rejects invalid artwork search input before contacting providers (%j)', async search => {
      await expect(invoke(searchCoverArt, {}, search)).rejects.toMatchObject({ statusCode: 400 });
      expect(musicbrainz.searchReleasesWithCoverArt).not.toHaveBeenCalled();
      expect(discogs.searchByQuery).not.toHaveBeenCalled();
    },
  );

  it('rejects artwork search for a missing or invalid record', async () => {
    await expect(invoke(searchCoverArt, {}, {}, '2147483648')).rejects.toMatchObject({ statusCode: 400 });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(invoke(searchCoverArt, {}, { title: 'Edited title' })).rejects.toMatchObject({ statusCode: 404 });
    expect(musicbrainz.searchReleasesWithCoverArt).not.toHaveBeenCalled();
    expect(discogs.searchByQuery).not.toHaveBeenCalled();
  });

  it('still marks successfully saved manual selections fetched', async () => {
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('collection_id,') && sql.includes('RETURNING expires_at') ? [] :
        [{ collection_id: null, artwork: {} }],
    }));
    await invoke(updateCoverArt, { url: fallbackUrl, source: 'Discogs' });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('cover_art_fetched = TRUE'), [fallbackUrl, '42_fallback.jpg', 42, null],
    );
  });

  it('stores optional selected artwork metadata separately from the album release', async () => {
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('RETURNING expires_at') ? [] : [{ collection_id: null, artwork: {} }],
    }));
    await invoke(updateCoverArt, { url: fallbackUrl, source: 'Discogs', provenance: { releaseId: 401, title: ' Dummy UK ', year: 1994 } });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('cover_art_provenance ='), [
      fallbackUrl, '42_fallback.jpg', 42, { source: 'Discogs', url: fallbackUrl, releaseId: 401, title: 'Dummy UK', year: 1994 },
    ]);
    const update = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE albums a'));
    expect(update?.[0]).not.toContain('discogs_id');
  });

  it.each([
    { source: 'Other', provenance: {} },
    { source: 'Discogs', provenance: { releaseId: '401' } },
    { source: 'MusicBrainz', provenance: { releaseId: 'not-a-release-id' } },
    { source: 'Discogs', provenance: { year: 1.5 } },
    { source: 'Discogs', provenance: { title: ['An album'] } },
    { source: 'Discogs', provenance: [] },
  ])('rejects invalid optional artwork details before downloading (%j)', async body => {
    await expect(invoke(updateCoverArt, { url: fallbackUrl, ...body })).rejects.toMatchObject({ statusCode: 400 });
    expect(musicbrainz.downloadCoverArt).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
