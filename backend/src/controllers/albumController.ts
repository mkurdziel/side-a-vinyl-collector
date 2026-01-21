import { Request, Response } from 'express';
import pool from '../config/database';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { AlbumWithArtist } from '../types';

export const getAllAlbums = asyncHandler(async (req: Request, res: Response) => {
  const result = await pool.query<AlbumWithArtist>(`
    SELECT
      albums.*,
      artists.name as artist_name,
      collections.notes,
      collections.added_at
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    ORDER BY collections.added_at DESC
  `);

  res.json({ albums: result.rows });
});

export const getAlbumById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await pool.query<AlbumWithArtist>(`
    SELECT
      albums.*,
      artists.name as artist_name,
      collections.notes,
      collections.added_at
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    WHERE albums.id = $1
  `, [id]);

  if (result.rows.length === 0) {
    throw new AppError('Album not found', 404);
  }

  res.json({ album: result.rows[0] });
});

export const addAlbum = asyncHandler(async (req: Request, res: Response) => {
  const { artist, album, year, coverImageUrl, discogsId, barcode } = req.body;

  if (!artist || !album) {
    throw new AppError('Artist and album are required', 400);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if artist exists, otherwise create
    let artistResult = await client.query(
      'SELECT id FROM artists WHERE LOWER(name) = LOWER($1)',
      [artist]
    );

    let artistId: number;
    if (artistResult.rows.length === 0) {
      // Note: discogsId from request is the album's ID, not the artist's ID
      // So we don't set discogs_id for the artist here
      const insertArtist = await client.query(
        'INSERT INTO artists (name) VALUES ($1) RETURNING id',
        [artist]
      );
      artistId = insertArtist.rows[0].id;
    } else {
      artistId = artistResult.rows[0].id;
    }

    // Check if album exists, otherwise create
    let albumResult = await client.query(
      'SELECT id FROM albums WHERE artist_id = $1 AND LOWER(title) = LOWER($2)',
      [artistId, album]
    );

    let albumId: number;
    if (albumResult.rows.length === 0) {
      const insertAlbum = await client.query(
        `INSERT INTO albums (artist_id, title, year, cover_image_url, discogs_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [artistId, album, year || null, coverImageUrl || null, discogsId || null]
      );
      albumId = insertAlbum.rows[0].id;
    } else {
      albumId = albumResult.rows[0].id;
    }

    // Add to collection (check for duplicates)
    try {
      await client.query(
        'INSERT INTO collections (album_id) VALUES ($1)',
        [albumId]
      );
    } catch (error: any) {
      if (error.code === '23505') { // Unique violation
        throw new AppError('Album already in collection', 409);
      }
      throw error;
    }

    // If barcode provided, store mapping
    if (barcode) {
      await client.query(
        'INSERT INTO barcodes (barcode, album_id) VALUES ($1, $2) ON CONFLICT (barcode) DO NOTHING',
        [barcode, albumId]
      );
    }

    await client.query('COMMIT');

    // Fetch the complete album with artist info
    const finalResult = await client.query<AlbumWithArtist>(`
      SELECT
        albums.*,
        artists.name as artist_name
      FROM albums
      JOIN artists ON albums.artist_id = artists.id
      WHERE albums.id = $1
    `, [albumId]);

    res.status(201).json({ album: finalResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export const deleteAlbum = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await pool.query(
    'DELETE FROM collections WHERE album_id = $1 RETURNING *',
    [id]
  );

  if (result.rowCount === 0) {
    throw new AppError('Album not in collection', 404);
  }

  res.json({ message: 'Album removed from collection' });
});

export const updateAlbumNotes = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes } = req.body;

  const result = await pool.query(
    'UPDATE collections SET notes = $1 WHERE album_id = $2 RETURNING *',
    [notes, id]
  );

  if (result.rowCount === 0) {
    throw new AppError('Album not in collection', 404);
  }

  res.json({ message: 'Notes updated', notes });
});
