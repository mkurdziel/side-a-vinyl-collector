import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestPool } from '../setup/testContainers';
import request from 'supertest';
import express from 'express';
import AdmZip from 'adm-zip';
import backupRoutes from '../../src/routes/backup';
import * as albumController from '../../src/controllers/albumController';
import { fetchOfficialCoverArt, undoCoverArt, updateCoverArt } from '../../src/controllers/coverArtController';
import { errorHandler } from '../../src/middleware/errorHandler';
import storage from '../../src/services/storage';
import musicbrainz from '../../src/services/musicbrainz';
import fs from 'fs';
import path from 'path';

describe('Backup and Restore', () => {
  let app: express.Application;
  let testPool: any;

  beforeEach(async () => {
    testPool = getTestPool();
    
    // Clear database
    await testPool.query('DELETE FROM collections');
    await testPool.query('DELETE FROM albums');
    await testPool.query('DELETE FROM artists');

    // Setup Express app for testing
    app = express();
    app.use(express.json());
    app.post('/api/albums', albumController.addAlbum);
    app.get('/api/albums', albumController.getAllAlbums);
    app.get('/api/albums/:id', albumController.getAlbumById);
    app.delete('/api/albums/:id', albumController.deleteAlbum);
    app.post('/api/albums/:id/removal/undo', albumController.undoAlbumRemoval);
    app.patch('/api/albums/:id/status', albumController.updateAlbumStatus);
    app.post('/api/albums/:id/status/undo', albumController.undoAlbumMove);
    app.post('/api/cover-art/:id/update', updateCoverArt);
    app.post('/api/cover-art/:id/undo', undoCoverArt);
    app.post('/api/cover-art/:id/fetch', fetchOfficialCoverArt);
    app.use('/api/backup', backupRoutes);
    app.use(errorHandler);
  });
  afterEach(() => vi.restoreAllMocks());

  it('should export albums with cover art', async () => {
    // Add test albums
    await request(app)
      .post('/api/albums')
      .send({
        artist: 'Test Artist',
        album: 'Test Album',
        year: 2024,
        status: 'collection'
      });

    await request(app)
      .post('/api/albums')
      .send({
        artist: 'Test Artist 2',
        album: 'Test Album 2',
        year: 2023,
        status: 'wishlist'
      });

    // Export backup
    const response = await request(app)
      .get('/api/backup/export')
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => done(null, Buffer.concat(chunks)));
        response.on('error', done);
      })
      .expect(200);

    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toContain('vinyl-collector-backup');
  });

  it('should import albums and restore database', async () => {
    // First, create a backup
    await request(app)
      .post('/api/albums')
      .send({
        artist: 'Original Artist',
        album: 'Original Album',
        year: 2024,
        status: 'collection'
      });

    const exportResponse = await request(app)
      .get('/api/backup/export')
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => done(null, Buffer.concat(chunks)));
        response.on('error', done);
      });

    const backupFile = exportResponse.body;

    // Clear database
    await testPool.query('DELETE FROM collections');
    await testPool.query('DELETE FROM albums');
    await testPool.query('DELETE FROM artists');

    // Verify database is empty
    const emptyCheck = await request(app)
      .get('/api/albums?status=collection');
    expect(emptyCheck.body.albums).toHaveLength(0);

    // Import backup
    const tempPath = path.join('/tmp', `test-backup-${Date.now()}.zip`);
    fs.writeFileSync(tempPath, backupFile);

    const importResponse = await request(app)
      .post('/api/backup/import')
      .attach('backup', tempPath)
      .expect(200);

    expect(importResponse.body.message).toContain('restored');

    // Verify albums are restored
    const restoredAlbums = await request(app)
      .get('/api/albums?status=collection');

    expect(restoredAlbums.body.albums).toHaveLength(1);
    expect(restoredAlbums.body.albums[0].title).toBe('Original Album');
    expect(restoredAlbums.body.albums[0].artist_name).toBe('Original Artist');

    // Cleanup
    fs.unlinkSync(tempPath);
  });

  it('should preserve album status (collection vs wishlist) on restore', async () => {
    // Add albums with different statuses
    await request(app)
      .post('/api/albums')
      .send({
        artist: 'Collection Artist',
        album: 'Collection Album',
        status: 'collection'
      });

    await request(app)
      .post('/api/albums')
      .send({
        artist: 'Wishlist Artist',
        album: 'Wishlist Album',
        status: 'wishlist'
      });

    // Export
    const exportResponse = await request(app)
      .get('/api/backup/export')
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => done(null, Buffer.concat(chunks)));
        response.on('error', done);
      });

    // Clear and import
    await testPool.query('DELETE FROM collections');
    await testPool.query('DELETE FROM albums');
    await testPool.query('DELETE FROM artists');

    const tempPath = path.join('/tmp', `test-backup-${Date.now()}.zip`);
    fs.writeFileSync(tempPath, exportResponse.body);

    await request(app)
      .post('/api/backup/import')
      .attach('backup', tempPath);

    // Verify collection
    const collectionAlbums = await request(app)
      .get('/api/albums?status=collection');
    expect(collectionAlbums.body.albums).toHaveLength(1);
    expect(collectionAlbums.body.albums[0].title).toBe('Collection Album');

    // Verify wishlist
    const wishlistAlbums = await request(app)
      .get('/api/albums?status=wishlist');
    expect(wishlistAlbums.body.albums).toHaveLength(1);
    expect(wishlistAlbums.body.albums[0].title).toBe('Wishlist Album');

    // Cleanup
    fs.unlinkSync(tempPath);
  });

  it('previews without modifying data and round-trips IDs, mappings, notes and selected artwork provenance', async () => {
    const { rows: [artist] } = await testPool.query("INSERT INTO artists (name, discogs_id) VALUES ('Test band', 654) RETURNING id");
    const mbid = '59a5cdbc-55c5-48bc-a687-937638f96ad9';
    const { rows: [album] } = await testPool.query(
      "INSERT INTO albums (artist_id, title, discogs_id, musicbrainz_id) VALUES ($1, 'Test record', 987, $2) RETURNING id",
      [artist.id, mbid],
    );
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    vi.spyOn(musicbrainz, 'downloadCoverArt').mockResolvedValueOnce(bytes);
    const source = 'Discogs';
    const url = 'https://i.discogs.com/test-cover.png';
    const provenance = { releaseId: 1203, title: 'Test record artwork edition', year: 1987 };
    const savedProvenance = { ...provenance, url, source };
    await testPool.query("INSERT INTO collections (album_id, status, notes) VALUES ($1, 'wishlist', 'test notes')", [album.id]);
    await testPool.query("INSERT INTO barcodes (album_id, barcode) VALUES ($1, '0123456789012')", [album.id]);
    const applied = await request(app).post(`/api/cover-art/${album.id}/update`).send({ url, source, provenance }).expect(200);
    expect(applied.body.album).toMatchObject({ discogs_id: 987, musicbrainz_id: mbid, cover_art_provenance: savedProvenance });
    const reopened = await request(app).get(`/api/albums/${album.id}`).expect(200);
    expect(reopened.body.album).toMatchObject({ discogs_id: 987, cover_art_provenance: savedProvenance });
    const exported = await request(app)
      .get('/api/backup/export')
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => done(null, Buffer.concat(chunks)));
        response.on('error', done);
      })
      .expect(200);

    const preview = await request(app).post('/api/backup/preview').attach('backup', exported.body, 'backup.zip').expect(200);
    expect(preview.body).toMatchObject({ albums: 1, artwork: 1, wishlist: 1, collection: 0, barcodes: 1, warnings: [] });
    expect((await testPool.query('SELECT id FROM barcodes')).rowCount).toBe(1);
    await testPool.query('DELETE FROM artists');

    const restored = await request(app).post('/api/backup/import').attach('backup', exported.body, 'backup.zip').expect(200);
    expect(restored.body).toMatchObject({ stats: { albums: 1, artwork: 1, barcodes: 1 }, warnings: [], skippedArtwork: [] });
    const { rows: [saved] } = await testPool.query(
      'SELECT albums.*, collections.notes, collections.status, artists.discogs_id AS artist_discogs, barcodes.barcode FROM albums JOIN artists ON artists.id = albums.artist_id JOIN collections ON collections.album_id = albums.id JOIN barcodes ON barcodes.album_id = albums.id',
    );
    expect(saved).toMatchObject({ id: album.id, artist_discogs: 654, discogs_id: 987, musicbrainz_id: mbid, barcode: '0123456789012', status: 'wishlist', notes: 'test notes', cover_art_provenance: savedProvenance });
    expect(await storage.readCoverArt(saved.local_cover_path)).toEqual(bytes);
    const inserted = await testPool.query("INSERT INTO artists (name) VALUES ('Next artist') RETURNING id");
    expect(inserted.rows[0].id).toBeGreaterThan(artist.id);
  });

  it('clears selected artwork provenance when another artwork path replaces the image', async () => {
    const mbid = '59a5cdbc-55c5-48bc-a687-937638f96ad9';
    const { rows: [artist] } = await testPool.query("INSERT INTO artists (name) VALUES ('Test artist') RETURNING id");
    const { rows: [album] } = await testPool.query(
      "INSERT INTO albums (artist_id, title, discogs_id, musicbrainz_id) VALUES ($1, 'Test album', 987, $2) RETURNING id",
      [artist.id, mbid],
    );
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    vi.spyOn(musicbrainz, 'downloadCoverArt').mockResolvedValue(bytes);
    const selected = { url: 'https://i.discogs.com/selected.png', source: 'Discogs', provenance: { releaseId: 1203 } };
    const updatePath = `/api/cover-art/${album.id}/update`;
    await request(app).post(updatePath).send(selected).expect(200);
    const same = await request(app).post(updatePath).send({ url: selected.url, source: selected.source }).expect(200);
    expect(same.body.album.cover_art_provenance).toMatchObject({ releaseId: 1203 });

    const different = await request(app).post(updatePath).send({ url: 'https://i.discogs.com/a-different-image.png' }).expect(200);
    expect(different.body.album).toMatchObject({ discogs_id: 987, cover_art_provenance: null });

    await request(app).post(updatePath).send(selected).expect(200);
    const official = `https://coverartarchive.org/release/${mbid}/front`;
    vi.spyOn(musicbrainz, 'getCoverArt').mockResolvedValueOnce(official);
    const refreshed = await request(app).post(`/api/cover-art/${album.id}/fetch`).expect(200);
    expect(refreshed.body.album).toMatchObject({ discogs_id: 987, cover_art_provenance: null, cover_image_url: official });
  });

  it('undoes exactly the last artwork change once without changing the pressing or shelf', async () => {
    const { rows: [artist] } = await testPool.query("INSERT INTO artists (name) VALUES ('Test artist') RETURNING id");
    const { rows: [album] } = await testPool.query(
      "INSERT INTO albums (artist_id, title, discogs_id) VALUES ($1, 'Test record', 987) RETURNING id", [artist.id],
    );
    await testPool.query("INSERT INTO collections (album_id, status, notes) VALUES ($1, 'wishlist', 'Keep these notes')", [album.id]);
    const originalBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    const nextBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);
    const original = { url: 'https://i.discogs.com/old.png', source: 'Discogs', provenance: { releaseId: 1203, year: 1987 } };
    const next = { url: 'https://i.discogs.com/new.png', source: 'Discogs', provenance: { releaseId: 1500, year: 1996 } };
    const base = `/api/cover-art/${album.id}`;
    const download = vi.spyOn(musicbrainz, 'downloadCoverArt').mockResolvedValueOnce(originalBytes).mockResolvedValueOnce(nextBytes);
    const first = await request(app).post(`${base}/update`).send(original).expect(200);
    const second = await request(app).post(`${base}/update`).send(next).expect(200);
    expect(second.body.album.cover_art_provenance.releaseId).toBe(1500);
    expect(second.headers['cache-control']).toBe('no-store');
    expect(second.body.undoToken).toMatch(/^[a-zA-Z0-9_-]{43}$/);
    await request(app).post(`${base}/undo`).send({ undoToken: first.body.undoToken }).expect(409);

    const responses = await Promise.all([1, 2].map(() => request(app).post(`${base}/undo`).send({ undoToken: second.body.undoToken })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const restored = responses.find(response => response.status === 200)!.body.album;
    expect(restored).toMatchObject({
      discogs_id: 987, status: 'wishlist', notes: 'Keep these notes',
      cover_image_url: original.url, local_cover_path: first.body.album.local_cover_path,
      cover_art_fetched: true,
      cover_art_provenance: { ...original.provenance, source: original.source, url: original.url },
    });
    expect(await storage.readCoverArt(restored.local_cover_path)).toEqual(originalBytes);
    expect((await request(app).get(`/api/albums/${album.id}`).expect(200)).body.album).toEqual(restored);
    expect(download).toHaveBeenCalledTimes(2);

    download.mockResolvedValueOnce(nextBytes);
    const pending = await request(app).post(`${base}/update`).send(next).expect(200);
    await testPool.query('UPDATE albums SET cover_image_url = $1, cover_art_provenance = NULL WHERE id = $2', [original.url, album.id]);
    await request(app).post(`${base}/undo`).send({ undoToken: pending.body.undoToken }).expect(409);
    expect((await request(app).get(`/api/albums/${album.id}`).expect(200)).body.album.cover_art_provenance).toBeNull();
  });

  it('reports legacy and missing artwork, and preserves the library when restore data is invalid', async () => {
    const zip = new AdmZip();
    const data = {
      version: '1.1',
      artists: [{ id: 43, name: 'Saved artist' }],
      albums: [{ id: 25, artist_id: 43, title: 'Saved album', local_cover_path: 'missing.jpg' }],
      collections: [{ id: 16, album_id: 25, status: 'collection' }],
    };
    zip.addFile('data.json', Buffer.from(JSON.stringify(data)));
    const preview = await request(app).post('/api/backup/preview').attach('backup', zip.toBuffer(), 'older.zip').expect(200);
    expect(preview.body.warnings).toHaveLength(2);
    const restored = await request(app).post('/api/backup/import').attach('backup', zip.toBuffer(), 'older.zip').expect(200);
    expect(restored.body).toMatchObject({
      message: 'Backup restored with warnings',
      skippedArtwork: [{ album: 'Saved album', reason: 'Missing from the archive' }],
    });
    zip.updateFile('data.json', Buffer.from(JSON.stringify({
      ...data,
      albums: [{ ...data.albums[0], musicbrainz_id: 'not a UUID' }],
    })));
    await request(app).post('/api/backup/import').attach('backup', zip.toBuffer(), 'invalid.zip').expect(400);
    expect((await testPool.query('SELECT title, local_cover_path, cover_art_provenance FROM albums')).rows).toEqual([
      { title: 'Saved album', local_cover_path: null, cover_art_provenance: null },
    ]);
    zip.updateFile('data.json', Buffer.from(JSON.stringify({
      ...data,
      albums: [{ ...data.albums[0], cover_image_url: 'https://example.com/new.png', cover_art_provenance: {
        url: 'https://example.com/old.png', source: 'Discogs', releaseId: 1203,
      } }],
    })));
    await request(app).post('/api/backup/import').attach('backup', zip.toBuffer(), 'stale-artwork.zip').expect(200);
    expect((await testPool.query('SELECT cover_image_url, cover_art_provenance FROM albums')).rows).toEqual([
      { cover_image_url: 'https://example.com/new.png', cover_art_provenance: null },
    ]);
  });

  it('omits pending undo receipts from export and invalidates them when the same library IDs are restored', async () => {
    const added = await request(app).post('/api/albums')
      .send({ artist: 'Test artist', album: 'Removed album', status: 'wishlist' }).expect(201);
    const { id } = added.body.album;
    const { body: { undoToken } } = await request(app).delete(`/api/albums/${id}`).expect(200);
    const { body: { album: moved } } = await request(app).post('/api/albums')
      .send({ artist: 'Test artist', album: 'Moved album', status: 'wishlist' }).expect(201);
    const { body: { undoToken: moveToken } } = await request(app).patch(`/api/albums/${moved.id}/status`)
      .send({ status: 'collection' }).expect(200);
    const exported = await request(app).get('/api/backup/export').buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => done(null, Buffer.concat(chunks)));
      response.on('error', done);
    }).expect(200);
    const backupJson = new AdmZip(exported.body).readAsText('data.json');
    const snapshot = JSON.parse(backupJson);
    expect(snapshot).not.toHaveProperty('album_removal_undo');
    expect(snapshot).not.toHaveProperty('album_move_undo');
    expect(backupJson).not.toContain(undoToken);
    expect(backupJson).not.toContain(moveToken);
    expect(snapshot.albums).toEqual(expect.arrayContaining([expect.objectContaining({ id }), expect.objectContaining({ id: moved.id })]));
    expect(snapshot.collections).toMatchObject([{ album_id: moved.id, status: 'collection' }]);

    const invalid = new AdmZip();
    invalid.addFile('data.json', Buffer.from(JSON.stringify({
      ...snapshot,
      albums: snapshot.albums.map((album: { id: number }) => album.id === id ? { ...album, musicbrainz_id: 'not a UUID' } : album),
    })));
    await request(app).post('/api/backup/import').attach('backup', invalid.toBuffer(), 'invalid.zip').expect(400);
    expect((await testPool.query('SELECT album_id FROM album_removal_undo')).rows).toEqual([{ album_id: id }]);
    expect((await testPool.query('SELECT expected_status FROM album_move_undo')).rows).toEqual([{ expected_status: 'collection' }]);

    const restored = await request(app).post('/api/backup/import').attach('backup', exported.body, 'backup.zip').expect(200);
    expect(Number.isFinite(Date.parse(restored.body.restoredAt))).toBe(true);
    await request(app).post(`/api/albums/${id}/removal/undo`).send({ undoToken }).expect(409);
    await request(app).post(`/api/albums/${moved.id}/status/undo`).send({ undoToken: moveToken }).expect(409);
    expect((await testPool.query('SELECT album_id FROM album_removal_undo')).rows).toEqual([]);
    expect((await request(app).get('/api/albums?status=wishlist').expect(200)).body.albums).toEqual([]);
  });
});
