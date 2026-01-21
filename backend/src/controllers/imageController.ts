import { Request, Response } from 'express';
import visionService from '../services/vision';
import discogsService from '../services/discogs';
import { asyncHandler, AppError } from '../middleware/errorHandler';

export const analyzeImage = asyncHandler(async (req: Request, res: Response) => {
  const { image } = req.body;

  if (!image) {
    throw new AppError('Image data is required', 400);
  }

  // Extract album info from image using AI Vision
  const extractedText = await visionService.extractAlbumInfo(image);

  if (!extractedText.artist && !extractedText.album) {
    throw new AppError('Could not extract album information from image', 400);
  }

  // Search Discogs with extracted information
  let discogsMatches = [];
  const matchesMap = new Map<number, any>(); // Track by discogsId to avoid duplicates

  // Search with primary result
  if (extractedText.artist || extractedText.album) {
    const searchQuery = [extractedText.artist, extractedText.album]
      .filter(Boolean)
      .join(' ');

    try {
      const matches = await discogsService.searchByQuery(searchQuery, 5);
      matches.forEach((match: any) => {
        if (!matchesMap.has(match.discogsId)) {
          matchesMap.set(match.discogsId, { ...match, fromProvider: extractedText.provider, confidence: extractedText.confidence });
        }
      });
    } catch (error) {
      console.error('Discogs search failed after image analysis:', error);
    }
  }

  // If fallback was used and returned different results, search with those too
  if (extractedText.primaryResult && (extractedText.primaryResult.artist || extractedText.primaryResult.album)) {
    const primarySearchQuery = [extractedText.primaryResult.artist, extractedText.primaryResult.album]
      .filter(Boolean)
      .join(' ');

    // Only search if it's a different query
    const mainQuery = [extractedText.artist, extractedText.album].filter(Boolean).join(' ');
    if (primarySearchQuery.toLowerCase() !== mainQuery.toLowerCase()) {
      try {
        const primaryMatches = await discogsService.searchByQuery(primarySearchQuery, 5);
        primaryMatches.forEach((match: any) => {
          if (!matchesMap.has(match.discogsId)) {
            matchesMap.set(match.discogsId, { ...match, fromProvider: extractedText.primaryResult!.provider, confidence: extractedText.primaryResult!.confidence });
          }
        });
      } catch (error) {
        console.error('Discogs search failed for primary result:', error);
      }
    }
  }

  discogsMatches = Array.from(matchesMap.values());

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
