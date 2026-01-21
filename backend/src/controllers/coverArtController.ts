import type { Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import pool from '../config/database';
import storageService from '../services/storage';
import musicbrainzService from '../services/musicbrainz';
import discogsService from '../services/discogs';

/**
 * Serve cover art image for an album
 */
export const getCoverArt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT cover_image_url, local_cover_path, musicbrainz_id, discogs_id, cover_art_fetched
     FROM albums WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Album not found', 404);
  }

  const album = result.rows[0];

  // Priority 1: Local cached cover art
  if (album.local_cover_path) {
    const exists = await storageService.exists(album.local_cover_path);
    if (exists) {
      const imageBuffer = await storageService.readCoverArt(album.local_cover_path);
      const mimeType = storageService.getMimeType(album.local_cover_path);

      res.set('Content-Type', mimeType);
      res.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
      return res.send(imageBuffer);
    }
  }

  // Priority 2: MusicBrainz official cover art URL (redirect)
  if (album.cover_image_url && album.cover_image_url.includes('coverartarchive.org')) {
    return res.redirect(album.cover_image_url);
  }

  // Priority 3: Discogs or other external URL (redirect)
  if (album.cover_image_url) {
    return res.redirect(album.cover_image_url);
  }

  // No cover art available
  throw new AppError('No cover art available for this album', 404);
});

/**
 * Fetch and cache official cover art from MusicBrainz
 * This is called during album addition or can be triggered manually
 */
export const fetchOfficialCoverArt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT a.id, a.title, ar.name as artist, a.musicbrainz_id, a.cover_art_fetched,
            a.cover_image_url, a.local_cover_path
     FROM albums a
     JOIN artists ar ON a.artist_id = ar.id
     WHERE a.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Album not found', 404);
  }

  const album = result.rows[0];

  // Skip if we already have official cover art
  if (album.cover_art_fetched && album.cover_image_url) {
    return res.json({
      message: 'Album already has official cover art',
      coverArtUrl: `/api/cover-art/${id}`
    });
  }

  // Try to fetch from MusicBrainz
  let mbAlbum;
  if (album.musicbrainz_id) {
    // We already have the MBID, just get cover art
    const coverArt = await musicbrainzService.getCoverArt(album.musicbrainz_id);
    if (coverArt) {
      mbAlbum = {
        mbid: album.musicbrainz_id,
        coverArtUrl: coverArt,
        hasCoverArt: true
      };
    }
  } else {
    // Search for the album and get cover art
    mbAlbum = await musicbrainzService.searchAndGetCoverArt(album.artist, album.title);
  }

  if (mbAlbum && mbAlbum.coverArtUrl) {
    // Update database with MusicBrainz info
    await pool.query(
      `UPDATE albums
       SET musicbrainz_id = $1, cover_image_url = $2, cover_art_fetched = TRUE
       WHERE id = $3`,
      [mbAlbum.mbid, mbAlbum.coverArtUrl, id]
    );

  } else {
    // No official cover art found - mark as attempted
    await pool.query(
      'UPDATE albums SET cover_art_fetched = TRUE WHERE id = $1',
      [id]
    );

    // Try to cache from Discogs if available
    if (album.cover_image_url && !album.local_cover_path) {
      try {
        const imageBuffer = await musicbrainzService.downloadCoverArt(album.cover_image_url);
        const localPath = await storageService.saveCoverArt(imageBuffer, album.id, album.cover_image_url);

        await pool.query(
          'UPDATE albums SET local_cover_path = $1 WHERE id = $2',
          [localPath, id]
        );
      } catch (error) {
        console.error('Failed to cache Discogs cover art:', error);
      }
    }
  }

  // Fetch the fully updated album to return to the frontend
  const updatedResult = await pool.query(
    `SELECT a.*, ar.name as artist_name 
     FROM albums a
     JOIN artists ar ON a.artist_id = ar.id
     WHERE a.id = $1`,
    [id]
  );
  
  const updatedAlbum = updatedResult.rows[0];

  res.json({
    message: 'Artwork refresh process completed',
    album: updatedAlbum,
    coverArtUrl: `/api/cover-art/${id}`
  });
});
/**
 * Search for cover art candidates from MusicBrainz and Discogs
 */
export const searchCoverArt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT a.id, a.title, ar.name as artist 
     FROM albums a
     JOIN artists ar ON a.artist_id = ar.id
     WHERE a.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Album not found', 404);
  }

  const { artist, title } = result.rows[0];

  console.log(`Searching cover art for: ${artist} - ${title}`);

  // Fetch from MusicBrainz and Discogs in parallel
  const [mbResults, discogsResults] = await Promise.all([
    musicbrainzService.searchReleasesWithCoverArt(artist, title),
    discogsService.searchByQuery(`${artist} - ${title}`, 5)
  ]);

  // Format MusicBrainz results
  const mbCandidates = mbResults.map(r => ({
    source: 'MusicBrainz',
    url: r.coverArtUrl,
    title: r.album,
    year: r.year,
    id: r.mbid
  }));

  // Format Discogs results
  const discogsCandidates = discogsResults
    .filter(r => r.coverImageUrl) // Only those with cover art
    .slice(0, 5)
    .map(r => ({
      source: 'Discogs',
      url: r.coverImageUrl,
      title: r.album,
      year: r.year,
      id: r.discogsId
    }));

  res.json({
    results: [...mbCandidates, ...discogsCandidates]
  });
});

/**
 * Update album cover art with selected image
 */
export const updateCoverArt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { url, source } = req.body;

  if (!url) {
    throw new AppError('Image URL is required', 400);
  }

  // If from Discogs or other external, we should cache it locally
  // If from MusicBrainz (Archive), we can link directly or cache. Caching is safer.
  
  let localPath;
  try {
    const imageBuffer = await musicbrainzService.downloadCoverArt(url as string);
    localPath = await storageService.saveCoverArt(imageBuffer, parseInt(id), url as string);
  } catch (error) {
    console.error('Failed to download/cache image:', error);
    // Be lenient? No, if we can't download it, we probably shouldn't set it if we rely on local serving.
    // However, we can fall back to setting the URL if download fails (but our frontend prefers local).
    throw new AppError('Failed to download and save image', 502);
  }

  await pool.query(
    `UPDATE albums 
     SET cover_image_url = $1, local_cover_path = $2, cover_art_fetched = TRUE 
     WHERE id = $3`,
    [url, localPath, id]
  );

  // Return updated album
  const updatedResult = await pool.query(
    `SELECT a.*, ar.name as artist_name 
     FROM albums a
     JOIN artists ar ON a.artist_id = ar.id
     WHERE a.id = $1`,
    [id]
  );
  
  res.json({
    message: 'Cover art updated successfully',
    album: updatedResult.rows[0]
  });
});
