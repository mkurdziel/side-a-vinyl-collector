import type { Request, Response } from 'express';
import pool from '../config/database';
import discogsService from '../services/discogs';
import musicbrainzService from '../services/musicbrainz';
import { annotateCatalogMembership } from '../services/catalogMembership';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import type { AlbumWithArtist } from '../types';

// Helper to normalize strings for comparison
const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q, scope, shelf, sort, offset: rawOffset } = req.query;

  if (typeof q !== 'string' || !q.trim()) {
    throw new AppError('Search query is required', 400);
  }
  if (scope !== undefined && scope !== 'saved' && scope !== 'catalog') {
    throw new AppError('Invalid search scope', 400);
  }
  if (shelf !== undefined && shelf !== 'collection' && shelf !== 'wishlist') {
    throw new AppError('Invalid search shelf', 400);
  }
  if (rawOffset !== undefined && (typeof rawOffset !== 'string' || !/^\d{1,7}$/.test(rawOffset) || !scope)) {
    throw new AppError('Invalid search offset', 400);
  }
  if (sort !== undefined && sort !== 'title' && sort !== 'artist' && sort !== 'date') {
    throw new AppError('Invalid search sort', 400);
  }

  const query = q.trim();
  const paged = rawOffset !== undefined;
  const offset = Number(rawOffset ?? 0);
  const savedPageSize = 20;
  const catalogPageSize = 30;
  const discogsLimit = paged ? 40 : 20;
  let catalogSampled = false;

  // Saved-album searches must not wait for an external provider.
  const local = scope === 'catalog' ? [] : (await pool.query<AlbumWithArtist>(`
    SELECT
      albums.*,
      artists.name as artist_name,
      collections.notes,
      collections.status,
      collections.added_at,
      GREATEST(
        similarity(artists.name, $1),
        similarity(albums.title, $1)
      ) as match_score
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    WHERE ($2::text IS NULL OR collections.status = $2) AND (
      artists.name ILIKE '%' || $1 || '%'
      OR albums.title ILIKE '%' || $1 || '%'
      OR (artists.name || ' ' || albums.title) ILIKE '%' || $1 || '%'
      OR similarity(artists.name, $1) > 0.3
      OR similarity(albums.title, $1) > 0.3
    )
    ORDER BY
      CASE WHEN $5 = 'title' THEN lower(albums.title) END,
      CASE WHEN $5 = 'artist' THEN lower(artists.name) END,
      CASE WHEN $5 = 'date' THEN collections.added_at END DESC NULLS LAST,
      match_score DESC, albums.id
    LIMIT $3 OFFSET $4
  `, [query, shelf ?? null, savedPageSize + Number(paged), offset, sort ?? null])).rows;

  if (scope === 'saved') {
    return res.json({
      local: local.slice(0, savedPageSize),
      discogs: [],
      errors: [],
      ...(local.length > savedPageSize ? { nextOffset: offset + savedPageSize } : {}),
    });
  }

  // 2. Search MusicBrainz & Discogs
  let externalResults: any[] = [];
  const errors: string[] = [];

  const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, serviceName: string): Promise<T> => {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${serviceName} search timed out after 5 seconds`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
  };

  try {
    const mbEnabled = musicbrainzService.isEnabled();
    const discogsEnabled = discogsService.isEnabled();

    // A. MusicBrainz Search
    let mbResults: any[] = [];
    if (mbEnabled) {
      try {
        const mbSearchPromise = async () => {
          const mbArtist = await musicbrainzService.searchArtist(query);
          if (mbArtist) {
            console.log(`Found MusicBrainz artist: ${mbArtist.name} (${mbArtist.id})`);
            const mbReleases = await musicbrainzService.getArtistReleaseGroups(mbArtist.id, mbArtist.name, 20);
            if (mbReleases.length === 20) catalogSampled = true;
            return mbReleases.map(r => ({
              ...r,
              isArtistMatch: true,
              source: 'musicbrainz'
            }));
          }
          return [];
        };
        mbResults = await withTimeout(mbSearchPromise(), 5000, 'MusicBrainz');
      } catch (err: any) {
        console.error(err.message);
        errors.push(err.message);
      }
    }

    // B. Discogs Search
    let discogsResults: any[] = [];
    if (discogsEnabled) {
      try {
        const discogsSearchPromise = async () => {
          const discogsArtist = await discogsService.searchArtist(query);
          let artistReleases: any[] = [];
          
          if (discogsArtist) {
            console.log(`Found Discogs artist: ${discogsArtist.title} (${discogsArtist.id})`);
            artistReleases = await discogsService.getArtistReleases(discogsArtist.id, discogsLimit);
            artistReleases.forEach(r => {
              if (!r.artist) r.artist = discogsArtist.title;
            });
          }

          const generalResults = await discogsService.searchByQuery(query, discogsLimit);
          if (generalResults.length === discogsLimit || artistReleases.length === discogsLimit) catalogSampled = true;

          // Deduplicate Discogs
          const seenDiscogs = new Set<string>();
          const mergedDiscogs: any[] = [];

          const addUniqueDiscogs = (item: any, isArtistMatch: boolean) => {
               if (seenDiscogs.has(item.id)) return;
               const key = `${normalize(item.artist)}:${normalize(item.album)}`;
               if (seenDiscogs.has(key)) return;
               seenDiscogs.add(item.id);
               seenDiscogs.add(key);
               mergedDiscogs.push({ ...item, isArtistMatch, source: 'discogs' });
          };

          artistReleases.forEach(r => addUniqueDiscogs(r, true));
          generalResults.forEach(r => addUniqueDiscogs({ ...r, discogsListing: 'release' }, false));
          return mergedDiscogs;
        };
        discogsResults = await withTimeout(discogsSearchPromise(), 5000, 'Discogs');
      } catch (err: any) {
        console.error(err.message);
        errors.push(err.message);
      }
    }

    // C. Merge MB and Discogs
    // MB results come first. Deduplicate catalog results before checking membership.
    
    const seenFinal = new Set<string>();
    const finalMerged: any[] = [];
    
    const addFinal = (item: any) => {
      const key = `${normalize(item.artist)}:${normalize(item.album)}`;
      if (seenFinal.has(key)) return;
      seenFinal.add(key);

      finalMerged.push(item);
    };

    mbResults.forEach(r => addFinal(r));
    discogsResults.forEach(r => addFinal(r));

    externalResults = await annotateCatalogMembership(finalMerged.slice(offset, offset + catalogPageSize));
    if (paged) {
      return res.json({
        local,
        discogs: externalResults,
        errors,
        catalogSampled,
        ...(finalMerged.length > offset + catalogPageSize ? { nextOffset: offset + catalogPageSize } : {}),
      });
    }

  } catch (error) {
    console.error('External search failed:', error);
    errors.push('Could not check catalog matches against your library.');
  }

  res.json({
    local,
    discogs: externalResults, // Frontend expects 'discogs' key for external results currently
    errors
  });
});
