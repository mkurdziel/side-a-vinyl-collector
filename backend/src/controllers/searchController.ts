import { Request, Response } from 'express';
import pool from '../config/database';
import discogsService from '../services/discogs';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { AlbumWithArtist } from '../types';

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q } = req.query;

  if (!q || typeof q !== 'string') {
    throw new AppError('Search query is required', 400);
  }

  const query = q.trim();

  // Search local collection with fuzzy matching
  const localResult = await pool.query<AlbumWithArtist>(`
    SELECT
      albums.*,
      artists.name as artist_name,
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

  // If we have fewer than 5 local results, search Discogs
  let discogs = [];
  if (local.length < 5) {
    try {
      const discogsResults = await discogsService.searchByQuery(query, 10);
      discogs = discogsResults;
    } catch (error) {
      console.error('Discogs search failed:', error);
      // Continue with local results even if Discogs fails
    }
  }

  res.json({
    local,
    discogs
  });
});
