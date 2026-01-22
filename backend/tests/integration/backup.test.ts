import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPool } from '../setup/testContainers';
import request from 'supertest';
import express from 'express';
import backupRoutes from '../../src/routes/backup';
import * as albumController from '../../src/controllers/albumController';
import fs from 'fs';
import path from 'path';

describe('Backup and Restore', () => {
  let app: express.Application;
  let testPool: any;

  beforeEach(async () => {
    testPool = getTestPool();
    
    // Clear database
    await testPool.query('DELETE FROM collection');
    await testPool.query('DELETE FROM albums');
    await testPool.query('DELETE FROM artists');

    // Setup Express app for testing
    app = express();
    app.use(express.json());
    app.post('/api/albums', albumController.addAlbum);
    app.get('/api/albums', albumController.getAllAlbums);
    app.use('/api/backup', backupRoutes);
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
      .get('/api/backup/export');

    const backupFile = exportResponse.body;

    // Clear database
    await testPool.query('DELETE FROM collection');
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
      .get('/api/backup/export');

    // Clear and import
    await testPool.query('DELETE FROM collection');
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
});
