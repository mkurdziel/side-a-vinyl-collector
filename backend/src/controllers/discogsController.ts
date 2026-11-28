import type { Request, Response } from 'express';
import discogs from '../services/discogs';
import pool from '../config/database';
import { asyncHandler, AppError } from '../middleware/errorHandler';

export const getPressingDetails = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!/^\d+$/.test(String(req.params.id)) || !Number.isSafeInteger(id) || id < 1) {
    throw new AppError('Choose a valid Discogs release ID', 400);
  }
  const release = discogs.isEnabled() ? await discogs.getRelease(id, { reportUnavailable: true }) : null;
  const year = release?.year;
  res.json({ pressing: year ? { ...release?.pressing, year } : release?.pressing ?? null });
});

export const checkDiscogsConfig = async (req: Request, res: Response) => {
  try {
    const isConfigured = discogs.isConfigured();

    if (!isConfigured) {
      return res.json({ configured: false });
    }

    const identity = await discogs.getUserIdentity();

    res.json({
      configured: true,
      username: identity?.username
    });
  } catch (error) {
    console.error('Check Discogs config error:', error);
    res.status(500).json({ error: 'Failed to check Discogs configuration' });
  }
};

export const importCollection = async (req: Request, res: Response) => {
  const pageInput = req.query.page ?? '1';
  const page = typeof pageInput === 'string' && /^\d+$/.test(pageInput) ? Number(pageInput) : NaN;
  if (!Number.isSafeInteger(page) || page < 1) {
    return res.status(400).json({ error: 'Choose a valid Discogs collection page' });
  }

  try {
    if (!discogs.isConfigured()) {
      return res.status(400).json({ error: 'Discogs token not configured' });
    }

    const identity = await discogs.getUserIdentity();

    if (!identity?.username) {
      return res.status(400).json({ error: 'Failed to get Discogs user identity' });
    }

    const { albums, totalPages, nextPage } = await discogs.getUserCollection(identity.username, page);

    const { rows } = await pool.query<{ artist: string; album: string; discogs_id: number | null }>(`
      SELECT LOWER(artists.name) as artist, LOWER(albums.title) as album, albums.discogs_id
      FROM collections
      JOIN albums ON collections.album_id = albums.id
      JOIN artists ON albums.artist_id = artists.id
    `);

    const savedTitles = new Set(rows.map(row => JSON.stringify([row.artist, row.album])));
    const savedReleases = new Set(rows.map(row => row.discogs_id));

    const newAlbums = albums.filter(({ artist, album, discogsId }) => {
      const key = JSON.stringify([artist.trim().toLowerCase(), album.trim().toLowerCase()]);
      return !savedTitles.has(key) && !savedReleases.has(discogsId);
    });

    res.json({
      albums: newAlbums,
      count: newAlbums.length,
      page,
      totalPages,
      nextPage,
    });
  } catch (error: any) {
    console.error('Import Discogs collection error:', error);
    res.status(500).json({ error: error.message || 'Failed to import collection' });
  }
};
