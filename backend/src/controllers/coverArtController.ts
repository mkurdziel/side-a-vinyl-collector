import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import pool from '../config/database';
import storageService from '../services/storage';
import musicbrainzService from '../services/musicbrainz';
import discogsService from '../services/discogs';
import { readCoverArtProvenance } from '../services/coverArtProvenance';
import type { CoverArtProvenance } from '../types';

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

  // Explicit refreshes always retry. Older records may be marked fetched after
  // a failed lookup, and successfully cached fallback art is not official art.
  let mbAlbum;
  if (album.musicbrainz_id) {
    // We already have the MBID, just get cover art
    const coverArt = await musicbrainzService.getCoverArt(album.musicbrainz_id);
    if (coverArt) {
      mbAlbum = {
        mbid: album.musicbrainz_id,
        coverImageUrl: coverArt,
        hasCoverArt: true
      };
    }
  } else {
    // Search for the album and get cover art
    mbAlbum = await musicbrainzService.searchAndGetCoverArt(album.artist, album.title);
  }

  if (mbAlbum?.coverImageUrl) {
    // Update database with MusicBrainz info
    await pool.query(
      `UPDATE albums
       SET musicbrainz_id = $1, cover_image_url = $2, local_cover_path = NULL,
           cover_art_fetched = TRUE,
           cover_art_provenance = CASE WHEN cover_image_url = $2 THEN cover_art_provenance END
       WHERE id = $3`,
      [mbAlbum.mbid, mbAlbum.coverImageUrl, id]
    );

  } else {
    // Preserve a discovered MBID for retry without marking a failed lookup fetched.
    if (mbAlbum?.mbid) {
      await pool.query(
        'UPDATE albums SET musicbrainz_id = $1 WHERE id = $2',
        [mbAlbum.mbid, id]
      );
    }

    // Try to cache from Discogs if available
    if (album.cover_image_url && !album.local_cover_path) {
      try {
        const imageBuffer = await musicbrainzService.downloadCoverArt(album.cover_image_url);
        const localPath = await storageService.saveCoverArt(imageBuffer, album.id, album.cover_image_url);

        await pool.query(
          'UPDATE albums SET local_cover_path = $1 WHERE id = $2 AND cover_image_url = $3 AND local_cover_path IS NULL',
          [localPath, id, album.cover_image_url]
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
function coverArtQueryValue(value: unknown, field: string): string | undefined {
  if (value === undefined) return;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 255 || /\p{Cc}/u.test(text)) {
    throw new AppError(`Enter a valid ${field} for the artwork search.`, 400);
  }
  return text;
}

export const searchCoverArt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const numericId = Number(id);
  if (!/^\d+$/.test(String(id)) || !Number.isInteger(numericId) || numericId <= 0 || numericId > 2_147_483_647) {
    throw new AppError('Choose a valid album.', 400);
  }
  const queryArtist = coverArtQueryValue(req.query?.artist, 'artist');
  const queryTitle = coverArtQueryValue(req.query?.title, 'album title');

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

  const artist = queryArtist ?? result.rows[0].artist;
  const title = queryTitle ?? result.rows[0].title;

  console.log(`Searching cover art for: ${artist} - ${title}`);

  // MusicBrainz puts both terms inside quoted search phrases.
  const escapePhrase = (value: string) => value.replace(/["\\]/g, '\\$&');
  const [mbResults, discogsResults] = await Promise.all([
    musicbrainzService.searchReleasesWithCoverArt(escapePhrase(artist), escapePhrase(title)),
    discogsService.searchByQuery(`${artist} - ${title}`, 5)
  ]);

  // Format MusicBrainz results
  const mbCandidates = mbResults.filter(r => r.coverImageUrl).map(r => ({
    source: 'MusicBrainz',
    url: r.coverImageUrl,
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

type ArtworkSnapshot = {
  cover_image_url: string | null;
  local_cover_path: string | null;
  cover_art_fetched: boolean | null;
  cover_art_provenance: CoverArtProvenance | null;
};

const artworkSnapshot = `jsonb_build_object(
  'cover_image_url', a.cover_image_url,
  'local_cover_path', a.local_cover_path,
  'cover_art_fetched', a.cover_art_fetched,
  'cover_art_provenance', a.cover_art_provenance
)`;

const lockArtworkAlbum = `
  SELECT c.id AS collection_id, ${artworkSnapshot} AS artwork
  FROM albums a LEFT JOIN collections c ON c.album_id = a.id
  WHERE a.id = $1 FOR NO KEY UPDATE OF a
`;

const albumWithArtwork = `
  SELECT a.*, ar.name AS artist_name, c.status, c.notes, c.added_at
  FROM albums a JOIN artists ar ON ar.id = a.artist_id
  LEFT JOIN collections c ON c.album_id = a.id
  WHERE a.id = $1
`;

const artworkUndoLock = 'LOCK TABLE album_removal_undo IN ROW EXCLUSIVE MODE';
const expiredArtworkUndo = 'This artwork change can no longer be undone. Check the current cover.';

function artworkAlbumId(value: unknown) {
  const rawId = String(value);
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isInteger(id) || id <= 0 || id > 2_147_483_647) {
    throw new AppError('Choose a valid album.', 400);
  }
  return id;
}

function artworkUndoDigest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export const updateCoverArt = asyncHandler(async (req: Request, res: Response) => {
  const id = artworkAlbumId(req.params.id);
  const { url, source, provenance } = req.body ?? {};

  if (typeof url !== 'string' || !url.trim()) {
    throw new AppError('Image URL is required', 400);
  }

  const artwork = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
    ? readCoverArtProvenance({ ...provenance, source, url }, url) : undefined;
  if (provenance != null && !artwork) throw new AppError('Choose valid artwork release details.', 400);

  let localPath;
  try {
    const imageBuffer = await musicbrainzService.downloadCoverArt(url);
    localPath = await storageService.saveCoverArt(imageBuffer, id, url);
  } catch (error) {
    console.error('Failed to download/cache image:', error);
    throw new AppError('Failed to download and save image', 502);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Match the lock order used by backup restore before touching any album or undo row.
    await client.query(artworkUndoLock);
    const { rows: [saved] } = await client.query<{ collection_id: number | null; artwork: ArtworkSnapshot }>(lockArtworkAlbum, [id]);
    if (!saved) throw new AppError('Album not found.', 404);
    const { rows: [applied] } = await client.query<{ artwork: ArtworkSnapshot }>(`
      UPDATE albums a
      SET cover_image_url = $1, local_cover_path = $2, cover_art_fetched = TRUE,
          cover_art_provenance = COALESCE($4::jsonb, CASE WHEN cover_image_url = $1 THEN cover_art_provenance END)
      WHERE id = $3
      RETURNING ${artworkSnapshot} AS artwork
    `, [url, localPath, id, artwork ?? null]);
    if (!applied) throw new Error('Could not update the saved artwork.');
    const undoToken = randomBytes(32).toString('base64url');
    const { rows: [receipt] } = await client.query<{ expires_at: Date }>(`
      INSERT INTO album_artwork_undo (collection_id, token_digest, previous_artwork, applied_artwork, expires_at)
      SELECT $1::integer, $2, $3::jsonb, $4::jsonb, clock_timestamp() + INTERVAL '10 minutes'
      WHERE $1::integer IS NOT NULL AND $3::jsonb IS DISTINCT FROM $4::jsonb
      ON CONFLICT (collection_id) DO UPDATE SET
        token_digest = EXCLUDED.token_digest,
        previous_artwork = EXCLUDED.previous_artwork,
        applied_artwork = EXCLUDED.applied_artwork,
        expires_at = EXCLUDED.expires_at
      RETURNING expires_at
    `, [saved.collection_id, artworkUndoDigest(undoToken), saved.artwork, applied.artwork]);
    const { rows: [album] } = await client.query(albumWithArtwork, [id]);
    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store').json({
      message: 'Cover art updated successfully',
      album,
      ...(receipt && { undoToken, expiresAt: receipt.expires_at.toISOString() }),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export const undoCoverArt = asyncHandler(async (req: Request, res: Response) => {
  const id = artworkAlbumId(req.params.id);
  const { undoToken } = req.body ?? {};
  if (typeof undoToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(undoToken)) {
    throw new AppError('Choose a valid artwork change to undo.', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(artworkUndoLock);
    const { rows: [saved] } = await client.query<{ collection_id: number | null; artwork: ArtworkSnapshot }>(lockArtworkAlbum, [id]);
    if (!saved?.collection_id) throw new AppError('This album is no longer saved.', 404);
    const { rows: [receipt] } = await client.query<{ previous_artwork: ArtworkSnapshot }>(`
      DELETE FROM album_artwork_undo
      WHERE collection_id = $1 AND token_digest = $2 AND applied_artwork = $3::jsonb
        AND expires_at > clock_timestamp()
      RETURNING previous_artwork
    `, [saved.collection_id, artworkUndoDigest(undoToken), saved.artwork]);
    if (!receipt) throw new AppError(expiredArtworkUndo, 409);
    const { cover_image_url, local_cover_path, cover_art_fetched, cover_art_provenance } = receipt.previous_artwork;
    await client.query(`
      UPDATE albums SET cover_image_url = $2, local_cover_path = $3,
        cover_art_fetched = $4, cover_art_provenance = $5
      WHERE id = $1
    `, [id, cover_image_url, local_cover_path, cover_art_fetched, cover_art_provenance]);
    const { rows: [album] } = await client.query(albumWithArtwork, [id]);
    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store').json({ album });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
