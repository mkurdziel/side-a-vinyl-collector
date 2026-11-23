import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPool } from '../setup/testContainers';
import request from 'supertest';
import express from 'express';
import AdmZip from 'adm-zip';
import backupRoutes from '../../src/routes/backup';
import * as albumController from '../../src/controllers/albumController';
import { errorHandler } from '../../src/middleware/errorHandler';
import storage from '../../src/services/storage';
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
    app.use('/api/backup', backupRoutes);
    app.use(errorHandler);
  });

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

  it('previews without modifying data and round-trips IDs, mappings, notes and artwork', async () => {
    const { rows: [artist] } = await testPool.query("INSERT INTO artists (name, discogs_id) VALUES ('Test band', 654) RETURNING id");
    const mbid = '59a5cdbc-55c5-48bc-a687-937638f96ad9';
    const { rows: [album] } = await testPool.query(
      "INSERT INTO albums (artist_id, title, discogs_id, musicbrainz_id) VALUES ($1, 'Test record', 987, $2) RETURNING id",
      [artist.id, mbid],
    );
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    const artwork = await storage.saveCoverArt(bytes, album.id);
    await testPool.query('UPDATE albums SET local_cover_path = $1 WHERE id = $2', [artwork, album.id]);
    await testPool.query("INSERT INTO collections (album_id, status, notes) VALUES ($1, 'wishlist', 'test notes')", [album.id]);
    await testPool.query("INSERT INTO barcodes (album_id, barcode) VALUES ($1, '0123456789012')", [album.id]);
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
    expect(saved).toMatchObject({ id: album.id, artist_discogs: 654, discogs_id: 987, musicbrainz_id: mbid, barcode: '0123456789012', status: 'wishlist', notes: 'test notes' });
    expect(await storage.readCoverArt(saved.local_cover_path)).toEqual(bytes);
    const inserted = await testPool.query("INSERT INTO artists (name) VALUES ('Next artist') RETURNING id");
    expect(inserted.rows[0].id).toBeGreaterThan(artist.id);
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
    expect((await testPool.query('SELECT title, local_cover_path FROM albums')).rows).toEqual([{ title: 'Saved album', local_cover_path: null }]);
  });
});
