import { Request, Response } from 'express';
import pool from '../config/database';
import discogsService from '../services/discogs';
import { asyncHandler, AppError } from '../middleware/errorHandler';

// Helper to check if an album exists in collections and return its status
async function getExistingAlbumStatus(albumId: number): Promise<{ status: string; albumId: number } | null> {
  const result = await pool.query(
    'SELECT album_id, status FROM collections WHERE album_id = $1',
    [albumId]
  );
  if (result.rows.length > 0) {
    return { status: result.rows[0].status, albumId: result.rows[0].album_id };
  }
  return null;
}

// Helper to check if an album exists by discogs_id or artist+title
async function findExistingAlbum(artist: string, title: string, discogsId?: number): Promise<{ status: string; albumId: number } | null> {
  // Try discogs_id first (most reliable)
  if (discogsId) {
    const discogsResult = await pool.query(`
      SELECT albums.id as album_id, collections.status
      FROM albums
      JOIN collections ON collections.album_id = albums.id
      WHERE albums.discogs_id = $1
    `, [discogsId]);
    if (discogsResult.rows.length > 0) {
      return { status: discogsResult.rows[0].status, albumId: discogsResult.rows[0].album_id };
    }
  }
  
  // Try artist + title match
  const titleResult = await pool.query(`
    SELECT albums.id as album_id, collections.status
    FROM albums
    JOIN artists ON albums.artist_id = artists.id
    JOIN collections ON collections.album_id = albums.id
    WHERE LOWER(artists.name) = LOWER($1) AND LOWER(albums.title) = LOWER($2)
  `, [artist, title]);
  if (titleResult.rows.length > 0) {
    return { status: titleResult.rows[0].status, albumId: titleResult.rows[0].album_id };
  }
  
  return null;
}

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
    const existing = await getExistingAlbumStatus(album.id);
    return res.json({
      artist: album.artist_name,
      album: album.title,
      year: album.year,
      coverImageUrl: album.cover_image_url,
      discogsId: album.discogs_id,
      source: 'local',
      existingStatus: existing?.status || null,
      existingAlbumId: existing?.albumId || null,
    });
  }

  // Search Discogs
  const discogsAlbum = await discogsService.searchByBarcode(barcode);

  if (!discogsAlbum) {
    throw new AppError('No album found for this barcode', 404);
  }

  // Check if this Discogs album already exists in our collection/wishlist
  const existing = await findExistingAlbum(discogsAlbum.artist, discogsAlbum.album, discogsAlbum.discogsId);

  res.json({
    artist: discogsAlbum.artist,
    album: discogsAlbum.album,
    year: discogsAlbum.year,
    coverImageUrl: discogsAlbum.coverImageUrl,
    discogsId: discogsAlbum.discogsId,
    source: 'discogs',
    existingStatus: existing?.status || null,
    existingAlbumId: existing?.albumId || null,
  });
});
