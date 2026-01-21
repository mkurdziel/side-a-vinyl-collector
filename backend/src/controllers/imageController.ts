import { Request, Response } from 'express';
import visionService from '../services/vision';
import discogsService from '../services/discogs';
import { asyncHandler, AppError } from '../middleware/errorHandler';

export const analyzeImage = asyncHandler(async (req: Request, res: Response) => {
  const { image } = req.body;

  if (!image) {
    throw new AppError('Image data is required', 400);
  }

  // Extract album info from image using Claude Vision
  const extractedText = await visionService.extractAlbumInfo(image);

  if (!extractedText.artist && !extractedText.album) {
    throw new AppError('Could not extract album information from image', 400);
  }

  // Search Discogs with extracted information
  let discogsMatches = [];
  if (extractedText.artist || extractedText.album) {
    const searchQuery = [extractedText.artist, extractedText.album]
      .filter(Boolean)
      .join(' ');

    try {
      discogsMatches = await discogsService.searchByQuery(searchQuery, 5);
    } catch (error) {
      console.error('Discogs search failed after image analysis:', error);
    }
  }

  res.json({
    extractedText,
    discogsMatches
  });
});

export const confirmAlbum = asyncHandler(async (req: Request, res: Response) => {
  const { discogsId } = req.body;

  if (!discogsId) {
    throw new AppError('Discogs ID is required', 400);
  }

  // Fetch full release details from Discogs
  const album = await discogsService.getRelease(discogsId);

  if (!album) {
    throw new AppError('Album not found in Discogs', 404);
  }

  res.json({ album });
});
