const words = (value: string): string[] =>
  value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const artistName = (value: string) => value.replace(/\s+\(\d+\)$/, '');
const numberQuery = (key: string) => /^\p{N}+$/u.test(key);

export function catalogNameKey(value: string) {
  return words(value).join('');
}

export function canExpandArtist(query: string) {
  const key = catalogNameKey(query);
  return Boolean(key) && !numberQuery(key);
}

export function matchesCatalogArtist(query: string, artist: string) {
  return canExpandArtist(query) && catalogNameKey(query) === catalogNameKey(artistName(artist));
}

export function rankCatalogMatches<T extends { artist: string; album: string; discogsListing?: 'release' | 'master' }>(
  query: string, albums: T[],
): T[] {
  const terms = words(query);
  const key = terms.join('');
  if (!key) return [];
  const numeric = numberQuery(key);
  const rank = (album: T) => {
    const title = words(album.album);
    const artist = words(artistName(album.artist));
    const titleKey = title.join('');
    const artistKey = artist.join('');
    if (key === titleKey) return 4;
    if (numeric) return terms.every(term => title.includes(term)) ? 1 : 0;
    if (key === artistKey + titleKey || key === titleKey + artistKey) return 5;
    if (key === artistKey) return 3;

    const fields = [...title, ...artist];
    return terms.every((term, index) => fields.includes(term)
      || (index === terms.length - 1 && term.length >= 3 && fields.some(word => word.startsWith(term)))) ? 2 : 0;
  };

  const ranked = albums.map(album => ({ album, score: rank(album) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score
      || Number(b.album.discogsListing === 'release') - Number(a.album.discogsListing === 'release'));

  const seen = new Set<string>();
  return ranked.flatMap(({ album }) => {
    const identity = JSON.stringify([catalogNameKey(album.artist), catalogNameKey(album.album)]);
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [album];
  });
}
