import { Request, Response } from 'express';
import discogs from '../services/discogs';
import pool from '../config/database';

export const checkDiscogsConfig = async (req: Request, res: Response) => {
  try {
    const isConfigured = discogs.isConfigured();

    if (!isConfigured) {
      return res.json({ configured: false });
    }

    const identity = await discogs.getUserIdentity();

    res.json({
      configured: true,
      username: identity?.username
    });
  } catch (error) {
    console.error('Check Discogs config error:', error);
    res.status(500).json({ error: 'Failed to check Discogs configuration' });
  }
};

export const importCollection = async (req: Request, res: Response) => {
  try {
    if (!discogs.isConfigured()) {
      return res.status(400).json({ error: 'Discogs token not configured' });
    }

    const identity = await discogs.getUserIdentity();

    if (!identity?.username) {
      return res.status(400).json({ error: 'Failed to get Discogs user identity' });
    }

    const albums = await discogs.getUserCollection(identity.username);

    // Get all albums already in the collection
    const existingAlbumsResult = await pool.query(`
      SELECT LOWER(artists.name) as artist, LOWER(albums.title) as album
      FROM collections
      JOIN albums ON collections.album_id = albums.id
      JOIN artists ON albums.artist_id = artists.id
    `);

    // Create a set of existing album keys for fast lookup
    const existingAlbums = new Set(
      existingAlbumsResult.rows.map(row => `${row.artist}||${row.album}`)
    );

    // Filter out albums that are already in the collection
    const newAlbums = albums.filter(album => {
      const key = `${album.artist.toLowerCase()}||${album.album.toLowerCase()}`;
      return !existingAlbums.has(key);
    });

    res.json({
      albums: newAlbums,
      count: newAlbums.length
    });
  } catch (error: any) {
    console.error('Import Discogs collection error:', error);
    res.status(500).json({ error: error.message || 'Failed to import collection' });
  }
};
