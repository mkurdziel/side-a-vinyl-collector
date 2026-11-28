import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTestPool } from '../setup/testContainers';
import request from 'supertest';
import express from 'express';
import * as albumController from '../../src/controllers/albumController';
import { AppError, errorHandler } from '../../src/middleware/errorHandler';
import discogs from '../../src/services/discogs';

vi.mock('../../src/services/discogs', () => ({
  default: { isEnabled: () => true, getRelease: vi.fn() },
}));

describe('Album CRUD Operations', () => {
  let app: express.Application;
  let testPool: any;

  beforeEach(async () => {
    testPool = getTestPool();
    
    // Clear database
    await testPool.query('DELETE FROM collections');
    await testPool.query('DELETE FROM albums');
    await testPool.query('DELETE FROM artists');

    // Setup Express app
    app = express();
    app.use(express.json());
    app.get('/api/albums', albumController.getAllAlbums);
    app.get('/api/albums/:id', albumController.getAlbumById);
    app.post('/api/albums', albumController.addAlbum);
    app.delete('/api/albums/:id', albumController.deleteAlbum);
    app.patch('/api/albums/:id/notes', albumController.updateAlbumNotes);
    app.patch('/api/albums/:id/status', albumController.updateAlbumStatus);
    app.patch('/api/albums/:id/pressing', albumController.updateAlbumPressing);
    app.post('/api/albums/:id/pressing/undo', albumController.undoAlbumPressing);
    app.use(errorHandler);
  });

  describe('POST /api/albums', () => {
    it('should create a new album in collection', async () => {
      const response = await request(app)
        .post('/api/albums')
        .send({
          artist: 'Pink Floyd',
          album: 'The Dark Side of the Moon',
          year: 1973,
          status: 'collection'
        })
        .expect(201);

      expect(response.body.album).toBeDefined();
      expect(response.body.album.title).toBe('The Dark Side of the Moon');
      expect(response.body.album.artist_name).toBe('Pink Floyd');
      expect(response.body.album.year).toBe(1973);
    });

    it('should create a new album in wishlist', async () => {
      const response = await request(app)
        .post('/api/albums')
        .send({
          artist: 'Led Zeppelin',
          album: 'IV',
          year: 1971,
          status: 'wishlist'
        })
        .expect(201);

      expect(response.body.album.status).toBe('wishlist');
    });

    it('should default to collection if status not specified', async () => {
      const response = await request(app)
        .post('/api/albums')
        .send({
          artist: 'The Beatles',
          album: 'Abbey Road',
          year: 1969
        })
        .expect(201);

      expect(response.body.album.status).toBe('collection');
    });

    it('returns the current record for concurrent manual duplicates without changing its shelf', async () => {
      const record = { artist: ' Fixture Artist ', album: ' Fixture Album ', status: 'wishlist' };
      const responses = await Promise.all([record, { ...record, artist: 'fixture artist', album: 'fixture album' }]
        .map(data => request(app).post('/api/albums').send(data)));
      const created = responses.find(response => response.status === 201);
      const duplicate = responses.find(response => response.status === 409);
      expect(created?.body.album.status).toBe('wishlist');
      expect(duplicate?.body.existingAlbumId).toBe(created?.body.album.id);
      expect((await request(app).get('/api/albums?status=wishlist')).body.albums).toHaveLength(1);
      await request(app).post('/api/albums').send({ artist: ' ', album: 'Fixture Album' }).expect(400);
    });

    it('identifies an already saved Discogs release even if its listing title changes', async () => {
      const created = await request(app).post('/api/albums')
        .send({ artist: 'Original Artist', album: 'Original title', discogsId: 2219 }).expect(201);
      const duplicate = await request(app).post('/api/albums')
        .send({ artist: 'Different listing credit', album: 'Revised title', discogsId: 2219 }).expect(409);
      expect(duplicate.body.existingAlbumId).toBe(created.body.album.id);
    });

    it('preserves album-level sources without attaching a default release', async () => {
      const catalogListing = { source: 'discogs', kind: 'master', id: 12345 };
      const actualRelease = await request(app).post('/api/albums')
        .send({ artist: 'Other Artist', album: 'Other record', discogsId: 2219 }).expect(201);
      const albumOnly = await request(app).post('/api/albums')
        .send({ artist: 'Fixture Artist', album: 'Album overview', discogsId: 2219, catalogListing }).expect(201);

      expect(albumOnly.body.album.id).not.toBe(actualRelease.body.album.id);
      const saved = await request(app).get(`/api/albums/${albumOnly.body.album.id}`).expect(200);
      expect(saved.body.album).toMatchObject({ discogs_id: null, catalog_listing: catalogListing });
      await request(app).post('/api/albums')
        .send({ artist: 'Fixture Artist', album: 'Invalid overview', catalogListing: { ...catalogListing, id: '12345' } })
        .expect(400);
    });
  });

  describe('GET /api/albums', () => {
    beforeEach(async () => {
      // Add test data
      await request(app).post('/api/albums').send({
        artist: 'Artist 1',
        album: 'Album 1',
        status: 'collection'
      });
      await request(app).post('/api/albums').send({
        artist: 'Artist 2',
        album: 'Album 2',
        status: 'wishlist'
      });
    });

    it('should get all collection albums', async () => {
      const response = await request(app)
        .get('/api/albums?status=collection')
        .expect(200);

      expect(response.body.albums).toHaveLength(1);
      expect(response.body.albums[0].title).toBe('Album 1');
    });

    it('should get all wishlist albums', async () => {
      const response = await request(app)
        .get('/api/albums?status=wishlist')
        .expect(200);

      expect(response.body.albums).toHaveLength(1);
      expect(response.body.albums[0].title).toBe('Album 2');
    });
  });

  describe('PATCH /api/albums/:id/status', () => {
    it('should move album from wishlist to collection', async () => {
      // Create wishlist album
      const createResponse = await request(app)
        .post('/api/albums')
        .send({
          artist: 'Test Artist',
          album: 'Test Album',
          status: 'wishlist'
        });

      const albumId = createResponse.body.album.id;

      // Move to collection
      await request(app)
        .patch(`/api/albums/${albumId}/status`)
        .send({ status: 'collection' })
        .expect(200);

      // Verify it's in collection
      const collectionResponse = await request(app)
        .get('/api/albums?status=collection');

      expect(collectionResponse.body.albums).toHaveLength(1);
      expect(collectionResponse.body.albums[0].id).toBe(albumId);

      // Verify it's not in wishlist
      const wishlistResponse = await request(app)
        .get('/api/albums?status=wishlist');

      expect(wishlistResponse.body.albums).toHaveLength(0);
    });
  });

  it('guards a removal or undo against a record that has moved to another shelf', async () => {
    const created = await request(app)
      .post('/api/albums')
      .send({ artist: 'Test Artist', album: 'Saved Record', status: 'wishlist' })
      .expect(201);
    const albumUrl = `/api/albums/${created.body.album.id}`;
    await request(app).patch(`${albumUrl}/notes`).send({ notes: 'Original pressing' }).expect(200);

    await request(app)
      .patch(`${albumUrl}/status`)
      .send({ status: 'collection', expectedStatus: 'wishlist' })
      .expect(200);
    await request(app).delete(`${albumUrl}?expectedStatus=wishlist`).expect(409);
    await request(app)
      .patch(`${albumUrl}/status`)
      .send({ status: 'collection', expectedStatus: 'wishlist' })
      .expect(409);
    await request(app)
      .patch(`${albumUrl}/status`)
      .send({ status: 'wishlist', expectedStatus: 'collection' })
      .expect(200);

    const restored = await request(app).get(albumUrl).expect(200);
    expect(restored.body.album).toMatchObject({
      id: created.body.album.id,
      added_at: created.body.album.added_at,
      status: 'wishlist',
      notes: 'Original pressing',
    });
    await request(app).delete(`${albumUrl}?expectedStatus=wishlist`).expect(200);
  });

  describe('DELETE /api/albums/:id', () => {
    it('should delete an album', async () => {
      const createResponse = await request(app)
        .post('/api/albums')
        .send({
          artist: 'Test Artist',
          album: 'Test Album'
        });

      const albumId = createResponse.body.album.id;

      await request(app)
        .delete(`/api/albums/${albumId}`)
        .expect(200);

      // Verify it's deleted
      const getResponse = await request(app)
        .get('/api/albums?status=collection');

      expect(getResponse.body.albums).toHaveLength(0);
    });
  });

  describe('PATCH /api/albums/:id/notes', () => {
    it('should update album notes', async () => {
      const createResponse = await request(app)
        .post('/api/albums')
        .send({
          artist: 'Test Artist',
          album: 'Test Album'
        });

      const albumId = createResponse.body.album.id;

      await request(app)
        .patch(`/api/albums/${albumId}/notes`)
        .send({ notes: 'First pressing, mint condition' })
        .expect(200);

      // Verify notes were updated
      const getResponse = await request(app)
        .get(`/api/albums/${albumId}`);

      expect(getResponse.body.album.notes).toBe('First pressing, mint condition');
    });
  });

  describe('PATCH /api/albums/:id/pressing', () => {
    const getRelease = vi.mocked(discogs.getRelease);
    const release = { id: 101, discogsId: 101, artist: 'Björk (2)', album: 'Debut – Live', year: 2020 };
    const otherPressing = { ...release, id: 102, discogsId: 102 };
    const barcode = '0123456789012';
    let albumId: number;

    beforeEach(async () => {
      getRelease.mockReset();
      getRelease.mockImplementation(async id => id === release.id ? release : otherPressing);
      const created = await request(app).post('/api/albums').send({
        artist: 'bjork', album: 'Debut - Live', year: 1993, status: 'wishlist', barcode,
        catalogListing: { source: 'discogs', kind: 'master', id: 60 },
      }).expect(201);
      albumId = created.body.album.id;
    });

    const changePressing = (discogsId: number, expectedDiscogsId: number | null) => request(app)
      .patch(`/api/albums/${albumId}/pressing`).send({ discogsId, expectedDiscogsId });
    const undoPressing = (undoToken?: string, id = albumId) => request(app)
      .post(`/api/albums/${id}/pressing/undo`).send({ undoToken });

    it('confirms and corrects a pressing, changing only the Discogs reference', async () => {
      await testPool.query(`UPDATE albums SET cover_image_url = 'https://example.com/cover.jpg',
        local_cover_path = '/stored/cover.jpg', cover_art_fetched = TRUE,
        musicbrainz_id = '317df805-36be-42cc-87a5-8ce7f438ed3a' WHERE id = $1`, [albumId]);
      await request(app).patch(`/api/albums/${albumId}/notes`).send({ notes: 'Original sleeve' }).expect(200);
      const before = await request(app).get(`/api/albums/${albumId}`).expect(200);
      const mappingsBefore = await testPool.query('SELECT * FROM barcodes WHERE album_id = $1', [albumId]);

      const confirmed = await changePressing(release.id, null).expect(200);
      const corrected = await changePressing(otherPressing.id, release.id).expect(200);
      expect(confirmed.body.album).toEqual({ ...before.body.album, discogs_id: release.id, catalog_listing: null });
      const expected = { ...before.body.album, discogs_id: otherPressing.id, catalog_listing: null };
      expect(corrected.body.album).toEqual(expected);
      expect((await request(app).get('/api/albums?status=wishlist').expect(200)).body.albums).toEqual([expected]);
      expect((await testPool.query('SELECT * FROM barcodes WHERE album_id = $1', [albumId])).rows).toEqual(mappingsBefore.rows);
      expect(mappingsBefore.rows).toHaveLength(1);
      expect(getRelease).toHaveBeenCalledWith(release.id, { reportUnavailable: true });
    });

    it('restores an unconfirmed pressing and its catalog listing, retaining later shelf and notes edits', async () => {
      const confirmed = await changePressing(release.id, null).expect(200);
      expect(confirmed.headers['cache-control']).toBe('no-store');
      const { undoToken } = confirmed.body;
      expect(undoToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      await request(app).patch(`/api/albums/${albumId}/status`).send({ status: 'collection', expectedStatus: 'wishlist' }).expect(200);
      await request(app).patch(`/api/albums/${albumId}/notes`).send({ notes: 'Notes after the pressing change' }).expect(200);
      const edited = await request(app).get(`/api/albums/${albumId}`).expect(200);

      const restored = await undoPressing(undoToken).expect(200);
      expect(restored.body.album).toEqual({ ...edited.body.album, discogs_id: null,
        catalog_listing: { source: 'discogs', kind: 'master', id: 60 } });
      expect((await testPool.query('SELECT barcode FROM barcodes WHERE album_id = $1', [albumId])).rows).toEqual([{ barcode }]);
      expect(getRelease).toHaveBeenCalledTimes(1);
      await undoPressing(undoToken).expect(409);
    });

    it('restores a previous release and rejects a superseded token even after that release is restored', async () => {
      const confirmed = await changePressing(release.id, null).expect(200);
      const corrected = await changePressing(otherPressing.id, release.id).expect(200);
      await undoPressing(confirmed.body.undoToken).expect(409);
      const restored = await undoPressing(corrected.body.undoToken).expect(200);
      expect(restored.body.album).toEqual(confirmed.body.album);
      await undoPressing(confirmed.body.undoToken).expect(409);
    });

    it('rejects missing, malformed, forged, cross-record and expired undo tokens', async () => {
      const confirmed = await changePressing(release.id, null).expect(200);
      const other = await request(app).post('/api/albums').send({ artist: 'Another artist', album: 'Another album' }).expect(201);
      await undoPressing().expect(400);
      await undoPressing('invalid').expect(400);
      await undoPressing('w'.repeat(43)).expect(409);
      await undoPressing(confirmed.body.undoToken, other.body.album.id).expect(409);
      await testPool.query('UPDATE album_pressing_undo SET expires_at = clock_timestamp()');
      await undoPressing(confirmed.body.undoToken).expect(409);
      expect((await request(app).get(`/api/albums/${albumId}`).expect(200)).body.album).toEqual(confirmed.body.album);
    });

    it('lets only one concurrent call consume an undo token', async () => {
      const { body } = await changePressing(release.id, null).expect(200);
      const responses = await Promise.all([undoPressing(body.undoToken), undoPressing(body.undoToken)]);
      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      expect((await request(app).get(`/api/albums/${albumId}`).expect(200)).body.album.discogs_id).toBeNull();
    });

    it('rejects undo if the previous release is now associated with another album', async () => {
      await changePressing(release.id, null).expect(200);
      const { body } = await changePressing(otherPressing.id, release.id).expect(200);
      await request(app).post('/api/albums').send({ artist: 'Another artist', album: 'Another album', discogsId: release.id }).expect(201);
      const attempted = await undoPressing(body.undoToken).expect(409);
      expect(attempted.body.error).toContain('linked to another album');
      expect((await request(app).get(`/api/albums/${albumId}`).expect(200)).body.album).toEqual(body.album);
    });

    it('invalidates undo when the album is removed, even if it is saved again', async () => {
      const { body } = await changePressing(release.id, null).expect(200);
      await request(app).delete(`/api/albums/${albumId}`).expect(200);
      await undoPressing(body.undoToken).expect(404);
      const readded = await request(app).post('/api/albums').send({ artist: 'bjork', album: 'Debut - Live' }).expect(201);
      expect(readded.body.album.id).toBe(albumId);
      await undoPressing(body.undoToken).expect(409);
      expect((await request(app).get(`/api/albums/${albumId}`).expect(200)).body.album.discogs_id).toBe(release.id);
    });

    it.each([{ artist: 'Another artist' }, { album: 'Another album' }])('rejects a different release identity %j', async mismatch => {
      getRelease.mockResolvedValueOnce({ ...release, ...mismatch });
      await changePressing(release.id, null).expect(422);
      expect((await request(app).get(`/api/albums/${albumId}`)).body.album.discogs_id).toBeNull();
    });

    it('rejects conflicting Discogs artist suffixes', async () => {
      await testPool.query('UPDATE artists SET name = $1 WHERE id = (SELECT artist_id FROM albums WHERE id = $2)', ['Björk (3)', albumId]);
      await changePressing(release.id, null).expect(422);
    });

    it('lets only one concurrent edit with the same expected pressing succeed', async () => {
      const bothLookups = Promise.withResolvers<void>();
      let lookupCount = 0;
      getRelease.mockImplementation(async id => {
        if (++lookupCount === 2) bothLookups.resolve();
        await bothLookups.promise;
        return id === release.id ? release : otherPressing;
      });
      const responses = await Promise.all([changePressing(release.id, null), changePressing(otherPressing.id, null)]);
      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      const winningId = responses.find(response => response.status === 200)?.body.album.discogs_id;
      expect((await request(app).get(`/api/albums/${albumId}`)).body.album.discogs_id).toBe(winningId);
    });

    it('rejects a release already linked to a different record', async () => {
      await request(app).post('/api/albums').send({ artist: 'Legacy artist', album: 'Legacy album', discogsId: release.id }).expect(201);
      const response = await changePressing(release.id, null).expect(409);
      expect(response.body.error).toContain('already linked');
      expect((await request(app).get(`/api/albums/${albumId}`)).body.album.discogs_id).toBeNull();
    });

    it('rejects a removed record before contacting Discogs', async () => {
      await request(app).delete(`/api/albums/${albumId}`).expect(200);
      await changePressing(release.id, null).expect(404);
      expect(getRelease).not.toHaveBeenCalled();
    });

    it('rechecks shelf membership after Discogs verification', async () => {
      const lookupStarted = Promise.withResolvers<void>();
      const lookupResult = Promise.withResolvers<typeof release>();
      getRelease.mockImplementationOnce(() => {
        lookupStarted.resolve();
        return lookupResult.promise;
      });
      const pending = changePressing(release.id, null).then(response => response);
      await lookupStarted.promise;
      try {
        await request(app).delete(`/api/albums/${albumId}`).expect(200);
      } finally {
        lookupResult.resolve(release);
      }
      expect((await pending).status).toBe(404);
      const result = await testPool.query('SELECT discogs_id FROM albums WHERE id = $1', [albumId]);
      expect(result.rows[0].discogs_id).toBeNull();
    });

    it('distinguishes a missing release from a retryable provider failure', async () => {
      getRelease.mockResolvedValueOnce(null);
      await changePressing(release.id, null).expect(422);
      getRelease.mockRejectedValueOnce(new AppError('Discogs took too long to respond. Please try again.', 503));
      const response = await changePressing(release.id, null).expect(503);
      expect(response.body.error).toContain('try again');
      expect((await request(app).get(`/api/albums/${albumId}`)).body.album.discogs_id).toBeNull();
    });

    it.each([
      { discogsId: 101 }, { discogsId: 0, expectedDiscogsId: null },
      { discogsId: '101', expectedDiscogsId: null }, { discogsId: 2_147_483_648, expectedDiscogsId: null },
      { discogsId: 101, expectedDiscogsId: 2_147_483_648 },
    ])('validates release IDs and requires an explicit expectation %j', async body => {
      await request(app).patch(`/api/albums/${albumId}/pressing`).send(body).expect(400);
      expect(getRelease).not.toHaveBeenCalled();
    });

    it('rejects saved album IDs out of database range', async () => {
      await request(app).patch('/api/albums/2147483648/pressing').send({ discogsId: release.id, expectedDiscogsId: null }).expect(400);
      expect(getRelease).not.toHaveBeenCalled();
    });
  });
});
