import type { CatalogNumberMatch, PressingDetails } from '../types';

type CatalogCandidate = {
  artist: string;
  album: string;
  discogsId?: number;
  discogsListing?: 'release' | 'master';
  pressing?: PressingDetails;
};
type RankedCandidate<T> = T & { catalogNumberMatch?: CatalogNumberMatch };
const maxPressingChoices = 8;

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

export function rankCatalogMatches<T extends CatalogCandidate>(query: string, albums: T[], byCatalogNumber = false) {
  const terms = words(query);
  const key = terms.join('');
  if (!key) return [];
  const numeric = numberQuery(key);
  const rankByName = (album: T) => {
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

  const ranked = albums.flatMap(album => {
    const numbers = album.pressing?.catalogNumber?.split('·').map(catalogNameKey).filter(value => value && value !== 'none') ?? [];
    const id = album.discogsId;
    const isRelease = album.discogsListing === 'release' && typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
    let catalogNumberMatch: CatalogNumberMatch | undefined;
    if (isRelease && numbers.includes(key)) catalogNumberMatch = 'exact';
    else if (isRelease && byCatalogNumber && !numbers.length) catalogNumberMatch = 'unverified';
    if (byCatalogNumber && !catalogNumberMatch) return [];
    // In name search, an exact title such as “1989” outranks a coincidental catalog number.
    const score = byCatalogNumber ? (catalogNumberMatch === 'exact' ? 6 : 1)
      : Math.max(rankByName(album), catalogNumberMatch === 'exact' ? 3.5 : 0);
    if (!score) return [];
    const candidate: RankedCandidate<T> = catalogNumberMatch ? { ...album, catalogNumberMatch } : album;
    return [{ album: candidate, score, isRelease }];
  }).sort((a, b) => b.score - a.score
    || Number(b.album.discogsListing === 'release') - Number(a.album.discogsListing === 'release'));

  const groups = new Map<string, { primary: RankedCandidate<T>; choices: RankedCandidate<T>[] }>();
  for (const { album, isRelease } of ranked) {
    const identity = JSON.stringify([catalogNameKey(album.artist), catalogNameKey(album.album)]);
    let group = groups.get(identity);
    if (!group) {
      group = { primary: album, choices: [] };
      groups.set(identity, group);
    }
    if (isRelease && group.choices.length < maxPressingChoices
      && !group.choices.some(choice => choice.discogsId === album.discogsId)) {
      group.choices.push(album);
    }
  }
  return [...groups.values()].map(({ primary, choices }) =>
    choices.length ? { ...primary, pressingChoices: choices } : primary);
}
