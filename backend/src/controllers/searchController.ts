import type { Request, Response } from 'express';
import pool from '../config/database';
import discogsService from '../services/discogs';
import musicbrainzService, { type MusicBrainzAlbum } from '../services/musicbrainz';
import { annotateCatalogMembership } from '../services/catalogMembership';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import type { AlbumWithArtist, DiscogsAlbum } from '../types';
import { canExpandArtist, catalogNameKey, matchesCatalogArtist, rankCatalogMatches } from '../services/catalogRelevance';

type CatalogAlbum = (DiscogsAlbum & { source: 'discogs' })
  | (MusicBrainzAlbum & { source: 'musicbrainz'; discogsListing?: never });
type CatalogSample = { albums: CatalogAlbum[]; hasMore: boolean };
const emptySample: CatalogSample = { albums: [], hasMore: false };

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q, scope, shelf, sort, offset: rawOffset, by } = req.query;

  if (typeof q !== 'string' || !q.trim()) {
    throw new AppError('Search query is required', 400);
  }
  if (scope !== undefined && scope !== 'saved' && scope !== 'catalog') {
    throw new AppError('Invalid search scope', 400);
  }
  if (by !== undefined && (by !== 'catalog-number' || scope !== 'catalog')) {
    throw new AppError('Catalog-number lookup requires catalog search', 400);
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
  const byCatalogNumber = by === 'catalog-number';
  const exactSavedName = scope === 'saved' && [...query].length === 1;
  if (byCatalogNumber && !catalogNameKey(query)) {
    throw new AppError('Enter a catalog number', 400);
  }
  const paged = rawOffset !== undefined;
  const offset = Number(rawOffset ?? 0);
  const savedPageSize = 20;
  const catalogPageSize = 30;
  const discogsLimit = paged ? 40 : 20;

  // Saved-album searches must not wait for an external provider.
  const local = scope === 'catalog' ? [] : (await pool.query<AlbumWithArtist & { match_kind: 'text' | 'approximate' }>(`
    SELECT
      albums.*,
      artists.name as artist_name,
      collections.notes,
      collections.status,
      collections.added_at,
      CASE WHEN strpos(lower(artists.name || ' ' || albums.title), lower($1)) > 0
        THEN 'text' ELSE 'approximate' END as match_kind,
      GREATEST(
        similarity(artists.name, $1),
        similarity(albums.title, $1)
      ) as match_score
    FROM collections
    JOIN albums ON collections.album_id = albums.id
    JOIN artists ON albums.artist_id = artists.id
    WHERE ($2::text IS NULL OR collections.status = $2) AND (
      CASE WHEN $6::boolean THEN lower(artists.name) = lower($1) OR lower(albums.title) = lower($1)
      ELSE artists.name ILIKE '%' || $1 || '%'
        OR albums.title ILIKE '%' || $1 || '%'
        OR (artists.name || ' ' || albums.title) ILIKE '%' || $1 || '%'
        OR similarity(artists.name, $1) > 0.3
        OR similarity(albums.title, $1) > 0.3 END
    )
    ORDER BY
      CASE WHEN $5 = 'title' THEN lower(albums.title) END,
      CASE WHEN $5 = 'artist' THEN lower(artists.name) END,
      CASE WHEN $5 = 'date' THEN collections.added_at END DESC NULLS LAST,
      match_score DESC, albums.id
    LIMIT $3 OFFSET $4
  `, [query, shelf ?? null, savedPageSize + Number(paged), offset, sort ?? null, exactSavedName])).rows;

  if (scope === 'saved') {
    return res.json({
      local: local.slice(0, savedPageSize),
      discogs: [],
      errors: [],
      ...(local.length > savedPageSize ? { nextOffset: offset + savedPageSize } : {}),
    });
  }

  const errors: string[] = [];

  const fromProvider = async (searchProvider: () => Promise<CatalogSample>, serviceName: string) => {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${serviceName} search timed out after 5 seconds`)), 5000);
    });
    try {
      return await Promise.race([searchProvider(), timeout]);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${serviceName} search failed`;
      console.error(message);
      errors.push(message);
      return emptySample;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const expandArtist = !byCatalogNumber && canExpandArtist(query);
  const discogsEnabled = discogsService.isEnabled();
  if (byCatalogNumber && !discogsEnabled) errors.push('Discogs catalog-number lookup is unavailable.');
  const [discogsTitles, discogsArtist, musicBrainzArtist] = await Promise.all([
    discogsEnabled ? fromProvider(async () => {
      const { albums, hasMore } = await discogsService.searchReleaseSample(byCatalogNumber ? { catno: query } : { q: query }, discogsLimit);
      return { albums: albums.map(release => ({ ...release, discogsListing: 'release', source: 'discogs' })), hasMore };
    }, 'Discogs') : emptySample,
    discogsEnabled && expandArtist ? fromProvider(async () => {
      const artist = await discogsService.searchArtist(query);
      if (!artist || !matchesCatalogArtist(query, artist.title)) return emptySample;
      const { albums, hasMore } = await discogsService.getArtistReleases(artist.id, discogsLimit);
      return { albums: albums.map(release => ({ ...release, artist: release.artist || artist.title, source: 'discogs' })), hasMore };
    }, 'Discogs artist') : emptySample,
    musicbrainzService.isEnabled() && expandArtist ? fromProvider(async () => {
      const artist = await musicbrainzService.searchArtist(query);
      if (!artist || !matchesCatalogArtist(query, artist.name)) return emptySample;
      const albums = await musicbrainzService.getArtistReleaseGroups(artist.id, artist.name, 20);
      return { albums: albums.map(album => ({ ...album, source: 'musicbrainz' })), hasMore: albums.length === 20 };
    }, 'MusicBrainz') : emptySample,
  ]);

  const pressingSampled = discogsTitles.hasMore || discogsArtist.hasMore;
  const ranked = rankCatalogMatches(query, [...discogsTitles.albums, ...discogsArtist.albums, ...musicBrainzArtist.albums], byCatalogNumber);
  try {
    const matches = ranked.slice(offset, offset + catalogPageSize).map(album =>
      pressingSampled && 'pressingChoices' in album && album.pressingChoices?.length ? {
        ...album, pressingSampled,
        pressingChoices: album.pressingChoices.map(choice => ({ ...choice, pressingSampled })),
      } : album);
    const discogs = await annotateCatalogMembership(matches);
    return res.json({
      local,
      discogs, // The client uses this field for both catalog providers.
      errors,
      ...(paged ? {
        catalogSampled: pressingSampled || musicBrainzArtist.hasMore,
        ...(ranked.length > offset + catalogPageSize ? { nextOffset: offset + catalogPageSize } : {}),
      } : {}),
    });
  } catch (error) {
    console.error('External search failed:', error);
    errors.push('Could not check catalog matches against your library.');
    return res.json({ local, discogs: [], errors });
  }
});
