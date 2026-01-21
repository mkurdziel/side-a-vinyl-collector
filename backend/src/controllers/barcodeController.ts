import { Request, Response } from 'express';
import pool from '../config/database';
import discogsService from '../services/discogs';
import { asyncHandler, AppError } from '../middleware/errorHandler';

export const scanBarcode = asyncHandler(async (req: Request, res: Response) => {
  const { barcode } = req.body;

  if (!barcode) {
    throw new AppError('Barcode is required', 400);
  }

  // Check if barcode exists in local database
  const localResult = await pool.query(`
    SELECT
      albums.*,
      artists.name as artist_name
    FROM barcodes
    JOIN albums ON barcodes.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    WHERE barcodes.barcode = $1
  `, [barcode]);

  if (localResult.rows.length > 0) {
    const album = localResult.rows[0];
    return res.json({
      artist: album.artist_name,
      album: album.title,
      year: album.year,
      coverImageUrl: album.cover_image_url,
      discogsId: album.discogs_id,
      source: 'local'
    });
  }

  // Search Discogs
  const discogsAlbum = await discogsService.searchByBarcode(barcode);

  if (!discogsAlbum) {
    throw new AppError('No album found for this barcode', 404);
  }

  res.json({
    artist: discogsAlbum.artist,
    album: discogsAlbum.album,
    year: discogsAlbum.year,
    coverImageUrl: discogsAlbum.coverImageUrl,
    discogsId: discogsAlbum.discogsId,
    source: 'discogs'
  });
});
