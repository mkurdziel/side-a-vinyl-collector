import { Request, Response } from 'express';
import discogs from '../services/discogs';

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
  try {
    if (!discogs.isConfigured()) {
      return res.status(400).json({ error: 'Discogs token not configured' });
    }

    const identity = await discogs.getUserIdentity();

    if (!identity?.username) {
      return res.status(400).json({ error: 'Failed to get Discogs user identity' });
    }

    const albums = await discogs.getUserCollection(identity.username);

    res.json({
      albums,
      count: albums.length
    });
  } catch (error: any) {
    console.error('Import Discogs collection error:', error);
    res.status(500).json({ error: error.message || 'Failed to import collection' });
  }
};
