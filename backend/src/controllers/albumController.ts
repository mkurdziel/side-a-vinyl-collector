import { Request, Response } from 'express';
import pool from '../config/database';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { AlbumWithArtist } from '../types';
import musicbrainzService from '../services/musicbrainz';
import storageService from '../services/storage';

/**
 * Background task to fetch MusicBrainz official cover art
 */
async function fetchMusicBrainzCoverArt(
  albumId: number,
  artist: string,
  album: string,
  existingCoverUrl?: string
): Promise<void> {
  try {
    console.log(`Fetching MusicBrainz cover art for: ${artist} - ${album}`);

    // Search MusicBrainz and get cover art
    const mbAlbum = await musicbrainzService.searchAndGetCoverArt(artist, album);

    if (mbAlbum && mbAlbum.coverArtUrl) {
      // Found official cover art from MusicBrainz
      console.log(`✓ Found MusicBrainz cover art for ${artist} - ${album}`);

      await pool.query(
        `UPDATE albums
         SET musicbrainz_id = $1, cover_image_url = $2, cover_art_fetched = TRUE
         WHERE id = $3`,
        [mbAlbum.mbid, mbAlbum.coverArtUrl, albumId]
      );
    } else {
      // No official cover art found - cache existing cover from Discogs/other source
      console.log(`No MusicBrainz cover art for ${artist} - ${album}, caching fallback`);

      if (mbAlbum?.mbid) {
        // We found the album but no cover art
        await pool.query(
          'UPDATE albums SET musicbrainz_id = $1, cover_art_fetched = TRUE WHERE id = $2',
          [mbAlbum.mbid, albumId]
        );
      } else {
        // Couldn't find the album in MusicBrainz at all
        await pool.query(
          'UPDATE albums SET cover_art_fetched = TRUE WHERE id = $1',
          [albumId]
        );
      }

      // Cache the existing Discogs/other cover art locally
      if (existingCoverUrl) {
        try {
          const imageBuffer = await musicbrainzService.downloadCoverArt(existingCoverUrl);
          const localPath = await storageService.saveCoverArt(imageBuffer, albumId, existingCoverUrl);

          await pool.query(
            'UPDATE albums SET local_cover_path = $1 WHERE id = $2',
            [localPath, albumId]
          );

          console.log(`✓ Cached fallback cover art locally for ${artist} - ${album}`);
        } catch (error) {
          console.error(`Failed to cache fallback cover art for album ${albumId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error fetching MusicBrainz cover art for album ${albumId}:`, error);
    throw error;
  }
}

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

    // Handle cover art based on MusicBrainz configuration
    if (!musicbrainzService.isEnabled() && coverImageUrl) {
      // MusicBrainz disabled - immediately cache Discogs art locally
      console.log(`MusicBrainz disabled, caching Discogs art immediately for: ${artist} - ${album}`);
      try {
        const imageBuffer = await musicbrainzService.downloadCoverArt(coverImageUrl);
        const localPath = await storageService.saveCoverArt(imageBuffer, albumId, coverImageUrl);

        await pool.query(
          'UPDATE albums SET local_cover_path = $1, cover_art_fetched = TRUE WHERE id = $2',
          [localPath, albumId]
        );
      } catch (error) {
        console.error(`Failed to cache Discogs cover art for album ${albumId}:`, error);
      }
    } else {
      // Try to fetch MusicBrainz official cover art in the background
      // This runs asynchronously and doesn't block the response
      fetchMusicBrainzCoverArt(albumId, artist, album, coverImageUrl).catch(err => {
        console.error(`Failed to fetch MusicBrainz cover art for album ${albumId}:`, err);
      });
    }

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
