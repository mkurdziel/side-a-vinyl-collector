import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import pool from '../config/database';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import type { AlbumWithArtist, CatalogListing } from '../types';
import { catalogNameKey, sameCatalogArtistCredit } from '../services/catalogRelevance';
import discogs from '../services/discogs';
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

    if (mbAlbum?.coverImageUrl) {
      // Found official cover art from MusicBrainz
      console.log(`✓ Found MusicBrainz cover art for ${artist} - ${album}`);

      await pool.query(
        `UPDATE albums
         SET musicbrainz_id = $1, cover_image_url = $2, local_cover_path = NULL,
             cover_art_fetched = TRUE
         WHERE id = $3`,
        [mbAlbum.mbid, mbAlbum.coverImageUrl, albumId]
      );
    } else {
      // No official cover art found - cache existing cover from Discogs/other source
      console.log(`No MusicBrainz cover art for ${artist} - ${album}, caching fallback`);

      if (mbAlbum?.mbid) {
        // We found the album but no cover art
        await pool.query(
          'UPDATE albums SET musicbrainz_id = $1 WHERE id = $2',
          [mbAlbum.mbid, albumId]
        );
      }

      // Keep unsuccessful MusicBrainz lookups retryable, even when caching a fallback.
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
      collections.added_at,
      collections.status
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    WHERE collections.status = COALESCE($1, 'collection')
    ORDER BY collections.added_at DESC
  `, [req.query.status || 'collection']);

  res.json({ albums: result.rows });
});

const savedAlbumQuery = `
    SELECT
      albums.*,
      artists.name as artist_name,
      collections.notes,
      collections.added_at,
      collections.status
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    WHERE albums.id = $1
`;

export const getAlbumById = asyncHandler(async (req: Request, res: Response) => {
  const result = await pool.query<AlbumWithArtist>(savedAlbumQuery, [req.params.id]);

  if (result.rows.length === 0) {
    throw new AppError('Album not found', 404);
  }

  res.json({ album: result.rows[0] });
});

async function lockAlbumIdentity(client: PoolClient, artist: string, ...releaseIds: (number | null)[]) {
  // Take release locks in a consistent order before the artist lock shared with additions.
  const ids = [...new Set(releaseIds)].filter(id => id !== null).sort((a, b) => a - b);
  for (const id of ids) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('discogs:' || $1::text, 0))", [id]);
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('artist:' || lower($1), 0))", [artist]);
}

// Lock the receipts before the library tables, matching the order used by backup restore.
const lockRemovalUndo = 'LOCK TABLE album_removal_undo IN ROW EXCLUSIVE MODE';

function parseCatalogListing(value: unknown): CatalogListing | null {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const { source, kind, id } = value as Record<string, unknown>;
    if (source === 'discogs' && kind === 'master' && typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
      return { source, kind, id };
    }
    if (source === 'musicbrainz' && kind === 'release-group' && typeof id === 'string'
      && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      return { source, kind, id };
    }
  }
  throw new AppError('Choose a valid catalog listing', 400);
}

export const addAlbum = asyncHandler(async (req: Request, res: Response) => {
  const { artist: artistInput, album: albumInput, year, coverImageUrl, discogsId: releaseId, barcode, status,
    applyCatalogReference } = req.body;
  const catalogListing = parseCatalogListing(req.body.catalogListing);
  const discogsId = catalogListing ? null : releaseId;
  const artist = typeof artistInput === 'string' ? artistInput.trim() : '';
  const album = typeof albumInput === 'string' ? albumInput.trim() : '';

  if (!artist || !album) {
    throw new AppError('Artist and album are required', 400);
  }
  if (artist.length > 255 || album.length > 255) {
    throw new AppError('Artist and album must each be 255 characters or fewer', 400);
  }
  if (status != null && !isShelf(status)) {
    throw new AppError('Choose Collection or Wishlist', 400);
  }
  if (applyCatalogReference !== undefined && typeof applyCatalogReference !== 'boolean') {
    throw new AppError('Choose whether to apply the catalog reference', 400);
  }
  if (applyCatalogReference && releaseId != null && (catalogListing || !isDatabaseId(releaseId))) {
    throw new AppError('Choose a valid Discogs release or an album listing', 400);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(lockRemovalUndo);

    await lockAlbumIdentity(client, artist, discogsId || null);
    const existing = await client.query<{ id: number }>(`
      SELECT albums.id FROM albums JOIN artists ON artists.id = albums.artist_id
      LEFT JOIN collections ON collections.album_id = albums.id
      WHERE albums.discogs_id = $3 OR (lower(artists.name) = lower($1) AND lower(albums.title) = lower($2))
      ORDER BY (albums.discogs_id = $3) DESC NULLS LAST, (collections.album_id IS NOT NULL) DESC, albums.id
      LIMIT 1
      FOR UPDATE OF albums
    `, [artist, album, discogsId || null]);

    let albumId = existing.rows[0]?.id;
    if (albumId === undefined) {
      const artistResult = await client.query<{ id: number }>(
        'SELECT id FROM artists WHERE lower(name) = lower($1) ORDER BY id LIMIT 1', [artist],
      );
      const artistId = artistResult.rows[0]?.id ?? (await client.query<{ id: number }>(
        'INSERT INTO artists (name) VALUES ($1) RETURNING id', [artist],
      )).rows[0]?.id;
      if (artistId === undefined) throw new Error('Artist insert did not return an ID');
      albumId = (await client.query<{ id: number }>(
        `INSERT INTO albums (artist_id, title, year, cover_image_url, discogs_id, catalog_listing)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [artistId, album, year || null, coverImageUrl || null, discogsId || null, catalogListing],
      )).rows[0]?.id;
      if (albumId === undefined) throw new Error('Album insert did not return an ID');
    }

    const membership = await client.query(
      'INSERT INTO collections (album_id, status) VALUES ($1, $2) ON CONFLICT (album_id) DO NOTHING',
      [albumId, status ?? 'collection'],
    );
    if (!membership.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This album is already saved.', status: 'error', existingAlbumId: albumId });
    }
    await client.query('DELETE FROM album_removal_undo WHERE album_id = $1', [albumId]);

    if (applyCatalogReference && existing.rows.length) {
      await client.query('UPDATE albums SET discogs_id = $1, catalog_listing = $2 WHERE id = $3',
        [discogsId ?? null, catalogListing, albumId]);
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

    // Return the same collection metadata as the album lookup endpoints.
    const finalResult = await client.query<AlbumWithArtist>(`
      SELECT
        albums.*,
        artists.name as artist_name,
        collections.status,
        collections.notes,
        collections.added_at
      FROM albums
      JOIN artists ON albums.artist_id = artists.id
      JOIN collections ON collections.album_id = albums.id
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

function isShelf(status: unknown): status is 'collection' | 'wishlist' {
  return status === 'collection' || status === 'wishlist';
}

function isDatabaseId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}

function checkExpectedPressing(album: AlbumWithArtist | undefined, expectedDiscogsId: number | null): asserts album is AlbumWithArtist {
  if (!album) throw new AppError('This album is no longer saved.', 404);
  if ((album.discogs_id ?? null) !== expectedDiscogsId) {
    throw new AppError('The saved pressing changed. Reopen the album and check the current pressing.', 409);
  }
}

function undoTokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export const updateAlbumPressing = asyncHandler(async (req: Request, res: Response) => {
  const rawId = String(req.params.id);
  const id = Number(rawId);
  const { discogsId, expectedDiscogsId } = req.body ?? {};
  if (!/^\d+$/.test(rawId) || !isDatabaseId(id) || !isDatabaseId(discogsId)) {
    throw new AppError('Choose a valid album and Discogs release ID.', 400);
  }
  if (expectedDiscogsId !== null && !isDatabaseId(expectedDiscogsId)) {
    throw new AppError('Provide the current Discogs release ID, or null if the pressing is unconfirmed.', 400);
  }

  const { rows: [original] } = await pool.query<AlbumWithArtist>(savedAlbumQuery, [id]);
  checkExpectedPressing(original, expectedDiscogsId);

  if (!discogs.isEnabled()) throw new AppError('Discogs verification is unavailable. Try again later.', 503);
  const release = await discogs.getRelease(discogsId, { reportUnavailable: true }).catch((error: unknown) => {
    if (error instanceof AppError && error.statusCode === 503) throw error;
    throw new AppError('Discogs verification is unavailable. Try again later.', 503);
  });
  if (!release || release.discogsId !== discogsId) {
    throw new AppError('Discogs could not find this release. Choose another pressing.', 422);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAlbumIdentity(client, original.artist_name, expectedDiscogsId, discogsId);
    const { rows: [saved] } = await client.query<AlbumWithArtist>(`${savedAlbumQuery} FOR UPDATE OF albums, collections`, [id]);
    checkExpectedPressing(saved, expectedDiscogsId);
    if (saved.artist_name !== original.artist_name || saved.title !== original.title) {
      throw new AppError('This saved album changed. Reopen it and check the current pressing.', 409);
    }

    const title = catalogNameKey(release.album);
    if (!title || title !== catalogNameKey(saved.title) || !sameCatalogArtistCredit(saved.artist_name, release.artist)) {
      throw new AppError('This Discogs release is for a different artist or album. Choose another pressing.', 422);
    }

    const undoToken = randomBytes(32).toString('base64url');
    await client.query('UPDATE albums SET discogs_id = $2, catalog_listing = NULL WHERE id = $1', [id, discogsId]);
    await client.query(`
      INSERT INTO album_pressing_undo (
        collection_id, token_digest, expected_discogs_id, previous_discogs_id, previous_catalog_listing, expires_at
      )
      SELECT id, $2, $3, $4, $5, clock_timestamp() + INTERVAL '10 minutes' FROM collections WHERE album_id = $1
      ON CONFLICT (collection_id) DO UPDATE SET
        token_digest = EXCLUDED.token_digest,
        expected_discogs_id = EXCLUDED.expected_discogs_id,
        previous_discogs_id = EXCLUDED.previous_discogs_id,
        previous_catalog_listing = EXCLUDED.previous_catalog_listing,
        expires_at = EXCLUDED.expires_at
    `, [id, undoTokenDigest(undoToken), discogsId, saved.discogs_id ?? null, saved.catalog_listing ?? null]);
    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store').json({ album: { ...saved, discogs_id: discogsId, catalog_listing: null }, undoToken });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new AppError('This Discogs release is already linked to another album. Choose another pressing.', 409);
    }
    throw error;
  } finally {
    client.release();
  }
});

const expiredPressingUndo = 'This pressing change can no longer be undone. Check the current saved pressing.';

export const undoAlbumPressing = asyncHandler(async (req: Request, res: Response) => {
  const rawId = String(req.params.id);
  const id = Number(rawId);
  const { undoToken } = req.body ?? {};
  if (!/^\d+$/.test(rawId) || !isDatabaseId(id) || typeof undoToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(undoToken)) {
    throw new AppError('Choose a valid saved pressing change to undo.', 400);
  }

  const digest = undoTokenDigest(undoToken);
  const { rows: [original] } = await pool.query<{
    artist_name: string;
    title: string;
    collection_id: number | null;
    expected_discogs_id: number;
    previous_discogs_id: number | null;
  }>(`
    SELECT artists.name AS artist_name, albums.title, undo.collection_id, undo.expected_discogs_id, undo.previous_discogs_id
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    LEFT JOIN album_pressing_undo undo ON undo.collection_id = collections.id
      AND undo.token_digest = $2 AND undo.expires_at > clock_timestamp()
    WHERE albums.id = $1
  `, [id, digest]);
  if (!original) throw new AppError('This album is no longer saved.', 404);
  if (original.collection_id === null) throw new AppError(expiredPressingUndo, 409);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAlbumIdentity(client, original.artist_name, original.expected_discogs_id, original.previous_discogs_id);
    const { rows: [saved] } = await client.query<AlbumWithArtist>(`${savedAlbumQuery} FOR UPDATE OF albums, collections`, [id]);
    checkExpectedPressing(saved, original.expected_discogs_id);
    if (saved.artist_name !== original.artist_name || saved.title !== original.title || saved.catalog_listing != null) {
      throw new AppError(expiredPressingUndo, 409);
    }

    // Consume the token in the same transaction as the restoration. The collection FK invalidates it on removal.
    const { rows: [previous] } = await client.query<{
      previous_discogs_id: number | null;
      previous_catalog_listing: CatalogListing | null;
    }>(`
      DELETE FROM album_pressing_undo
      WHERE collection_id = $1 AND token_digest = $2 AND expires_at > clock_timestamp()
      RETURNING previous_discogs_id, previous_catalog_listing
    `, [original.collection_id, digest]);
    if (!previous) throw new AppError(expiredPressingUndo, 409);

    const { previous_discogs_id, previous_catalog_listing } = previous;
    await client.query('UPDATE albums SET discogs_id = $2, catalog_listing = $3 WHERE id = $1',
      [id, previous_discogs_id, previous_catalog_listing]);
    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store').json({
      album: { ...saved, discogs_id: previous_discogs_id, catalog_listing: previous_catalog_listing },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      throw new AppError('The previous Discogs release is now linked to another album.', 409);
    }
    throw error;
  } finally {
    client.release();
  }
});

export const deleteAlbum = asyncHandler(async (req: Request, res: Response) => {
  const rawId = String(req.params.id);
  const id = Number(rawId);
  const { expectedStatus } = req.query;

  if (!/^\d+$/.test(rawId) || !isDatabaseId(id)) {
    throw new AppError('Choose a valid album to remove.', 400);
  }
  if (expectedStatus !== undefined && !isShelf(expectedStatus)) {
    throw new AppError('Invalid expected status', 400);
  }

  const undoToken = randomBytes(32).toString('base64url');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(lockRemovalUndo);
    // Pressing changes can lock both the album and its membership, so share their artist lock first.
    const { rows: [identity] } = await client.query<{ artist_name: string }>(`
      SELECT artists.name AS artist_name FROM albums JOIN artists ON artists.id = albums.artist_id WHERE albums.id = $1
    `, [id]);
    if (identity) await lockAlbumIdentity(client, identity.artist_name);
    await client.query('SELECT id FROM albums WHERE id = $1 FOR NO KEY UPDATE', [id]);
    await client.query('DELETE FROM album_removal_undo WHERE expires_at <= CURRENT_TIMESTAMP');
    const { rows: [receipt] } = await client.query<{ expires_at: Date }>(`
      WITH removed AS (
        DELETE FROM collections WHERE album_id = $1 AND ($2::text IS NULL OR status = $2)
        RETURNING id, album_id, status, notes, added_at
      )
      INSERT INTO album_removal_undo (album_id, collection_id, status, notes, added_at, token_digest, expires_at)
      SELECT album_id, id, status, notes, added_at, $3, clock_timestamp() + INTERVAL '10 minutes'
      FROM removed
      ON CONFLICT (album_id) DO UPDATE SET
        collection_id = EXCLUDED.collection_id,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        added_at = EXCLUDED.added_at,
        token_digest = EXCLUDED.token_digest,
        expires_at = EXCLUDED.expires_at
      RETURNING expires_at
    `, [id, expectedStatus ?? null, undoTokenDigest(undoToken)]);
    if (!receipt) {
      if (expectedStatus) throw new AppError('This album’s shelf changed. Refresh and try again.', 409);
      throw new AppError('Album not in collection', 404);
    }

    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store').json({
      message: 'Album removed from collection', undoToken, expiresAt: receipt.expires_at.toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

const expiredRemovalUndo = 'This removal can no longer be undone. Check your shelves before adding the album again.';

export const undoAlbumRemoval = asyncHandler(async (req: Request, res: Response) => {
  const rawId = String(req.params.id);
  const id = Number(rawId);
  const { undoToken } = req.body ?? {};
  if (!/^\d+$/.test(rawId) || !isDatabaseId(id) || typeof undoToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(undoToken)) {
    throw new AppError('Choose a valid album removal to undo.', 400);
  }

  const digest = undoTokenDigest(undoToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(lockRemovalUndo);
    const { rows: [original] } = await client.query<{ artist_name: string; title: string }>(`
      SELECT artists.name AS artist_name, albums.title
      FROM album_removal_undo
      JOIN albums ON albums.id = album_removal_undo.album_id
      JOIN artists ON artists.id = albums.artist_id
      WHERE album_removal_undo.album_id = $1 AND token_digest = $2 AND expires_at > clock_timestamp()
    `, [id, digest]);
    if (!original) throw new AppError(expiredRemovalUndo, 409);

    await lockAlbumIdentity(client, original.artist_name);
    await client.query('SELECT id FROM albums WHERE id = $1 FOR NO KEY UPDATE', [id]);
    const restored = await client.query(`
      WITH removal AS (
        DELETE FROM album_removal_undo
        WHERE album_id = $1 AND token_digest = $2 AND expires_at > clock_timestamp()
        RETURNING collection_id, album_id, status, notes, added_at
      )
      INSERT INTO collections (id, album_id, status, notes, added_at)
      SELECT collection_id, album_id, status, notes, added_at FROM removal
      WHERE NOT EXISTS (
        SELECT 1 FROM collections
        JOIN albums ON albums.id = collections.album_id
        JOIN artists ON artists.id = albums.artist_id
        WHERE lower(artists.name) = lower($3) AND lower(albums.title) = lower($4)
      )
      ON CONFLICT DO NOTHING
    `, [id, digest, original.artist_name, original.title]);
    if (!restored.rowCount) throw new AppError(expiredRemovalUndo, 409);

    const { rows: [album] } = await client.query<AlbumWithArtist>(savedAlbumQuery, [id]);
    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store').json({ album });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

export const updateAlbumStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, expectedStatus } = req.body;

  if (!isShelf(status)) {
    throw new AppError('Invalid status', 400);
  }
  if (expectedStatus !== undefined && !isShelf(expectedStatus)) {
    throw new AppError('Invalid expected status', 400);
  }

  const result = await pool.query(
    'UPDATE collections SET status = $1 WHERE album_id = $2 AND ($3::text IS NULL OR status = $3) RETURNING *',
    [status, id, expectedStatus ?? null]
  );

  if (result.rowCount === 0) {
    if (expectedStatus) throw new AppError('This album’s shelf changed. Refresh and try again.', 409);
    throw new AppError('Album not in collection', 404);
  }

  res.json({ message: 'Status updated', status });
});
