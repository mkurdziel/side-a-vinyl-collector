import type { CoverArtProvenance } from '../types';

export function readCoverArtProvenance(value: unknown, expectedUrl: unknown): CoverArtProvenance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const { source, url, releaseId, title, year } = value as Record<string, unknown>;
  if ((source !== 'Discogs' && source !== 'MusicBrainz') || typeof url !== 'string' || !url.trim() || url !== expectedUrl) return;

  if (releaseId !== undefined) {
    const valid = source === 'Discogs'
      ? typeof releaseId === 'number' && Number.isSafeInteger(releaseId) && releaseId > 0
      : typeof releaseId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(releaseId);
    if (!valid) return;
  }
  const cleanTitle = typeof title === 'string' ? title.trim() : undefined;
  if (title !== undefined && (!cleanTitle || cleanTitle.length > 1000 || /\p{Cc}/u.test(cleanTitle))) return;
  if (year !== undefined && (typeof year !== 'number' || !Number.isInteger(year) || year < 1 || year > 9999)) return;

  return {
    source,
    url,
    ...(typeof releaseId === 'string' || typeof releaseId === 'number' ? { releaseId } : {}),
    ...(cleanTitle ? { title: cleanTitle } : {}),
    ...(typeof year === 'number' ? { year } : {}),
  };
}
