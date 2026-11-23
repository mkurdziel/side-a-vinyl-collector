import { describe, it, expect, beforeEach } from 'vitest';
import { getTestPool } from '../setup/testContainers';
import request from 'supertest';
import express from 'express';
import * as albumController from '../../src/controllers/albumController';
import { errorHandler } from '../../src/middleware/errorHandler';

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
});
