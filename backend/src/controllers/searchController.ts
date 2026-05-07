import type { Request, Response } from 'express';
import pool from '../config/database';
import discogsService from '../services/discogs';
import musicbrainzService from '../services/musicbrainz';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import type { AlbumWithArtist } from '../types';

// Helper to normalize strings for comparison
const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query;

  if (!q || typeof q !== 'string') {
    throw new AppError('Search query is required', 400);
  }

  const query = q.trim();
  const normalizedQuery = normalize(query);

  // 1. Search local collection
  const localResult = await pool.query<AlbumWithArtist>(`
    SELECT
      albums.*,
      artists.name as artist_name,
      collections.notes,
      collections.status,
      GREATEST(
        similarity(artists.name, $1),
        similarity(albums.title, $1)
      ) as match_score
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    WHERE
      artists.name ILIKE '%' || $1 || '%'
      OR albums.title ILIKE '%' || $1 || '%'
      OR similarity(artists.name, $1) > 0.3
      OR similarity(albums.title, $1) > 0.3
    ORDER BY match_score DESC
    LIMIT 20
  `, [query]);

  const local = localResult.rows;

  // Create a set of owned albums for fast filtering
  const ownedSet = new Set<string>();
  local.forEach(album => {
    // Key by artist + album
    ownedSet.add(`${normalize(album.artist_name)}:${normalize(album.title)}`);
    if (album.discogs_id) ownedSet.add(`discogs:${album.discogs_id}`);
  });

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
            artistReleases = await discogsService.getArtistReleases(discogsArtist.id, 20);
            artistReleases.forEach(r => {
              if (!r.artist) r.artist = discogsArtist.title;
            });
          }

          const generalResults = await discogsService.searchByQuery(query, 20);

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
          generalResults.forEach(r => addUniqueDiscogs(r, false));
          return mergedDiscogs;
        };
        discogsResults = await withTimeout(discogsSearchPromise(), 5000, 'Discogs');
      } catch (err: any) {
        console.error(err.message);
        errors.push(err.message);
      }
    }

    // C. Merge MB and Discogs
    // MB results come first. Deduplicate against local and each other.
    
    const seenFinal = new Set<string>();
    const finalMerged: any[] = [];
    
    // Create lookups for own collection
    const collectionLookup = new Set<string>();
    const wishlistLookup = new Set<string>();
    
    local.forEach(album => {
       const key = `${normalize(album.artist_name)}:${normalize(album.title)}`;
       if (album.status === 'wishlist') {
         wishlistLookup.add(key);
         if (album.discogs_id) wishlistLookup.add(`discogs:${album.discogs_id}`);
       } else {
         collectionLookup.add(key);
         if (album.discogs_id) collectionLookup.add(`discogs:${album.discogs_id}`);
       }
    });

    const addFinal = (item: any) => {
       const key = `${normalize(item.artist)}:${normalize(item.album)}`;
       const discogsKey = item.discogsId ? `discogs:${item.discogsId}` : null;
       
       // Deduplicate match in result list
       if (seenFinal.has(key)) return;
       seenFinal.add(key);
       
       // Check status
       let inCollection = false;
       let inWishlist = false;

       if (collectionLookup.has(key) || (discogsKey && collectionLookup.has(discogsKey))) {
         inCollection = true;
       }
       
       if (wishlistLookup.has(key) || (discogsKey && wishlistLookup.has(discogsKey))) {
         inWishlist = true;
       }

       finalMerged.push({
         ...item,
         inCollection,
         inWishlist
       });
    };

    mbResults.forEach(r => addFinal(r));
    discogsResults.forEach(r => addFinal(r));

    externalResults = finalMerged.slice(0, 30);

  } catch (error) {
    console.error('External search failed:', error);
  }

  res.json({
    local,
    discogs: externalResults, // Frontend expects 'discogs' key for external results currently
    errors
  });
});
