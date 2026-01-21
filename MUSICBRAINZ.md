# MusicBrainz Cover Art Integration

The vinyl collector app now uses **MusicBrainz** and the **Cover Art Archive** to fetch official, high-quality album cover art.

## How It Works

### Automatic Cover Art Fetching

When you add an album to your collection, the backend automatically:

1. **Searches MusicBrainz** for the album using artist and title
2. **Fetches official cover art** from the Cover Art Archive if available
3. **Caches locally** for albums without official art (from Discogs/other sources)
4. **Serves optimized images** through the `/api/cover-art/:id` endpoint

### Priority System

Cover art is served in the following priority:

1. **Locally cached cover art** - Fastest, served directly from persistent storage
2. **MusicBrainz official art** - Redirects to Cover Art Archive CDN
3. **Discogs/other sources** - Falls back to external URLs

### Local Storage

Albums without official MusicBrainz cover art have their cover images cached locally:

- **Storage location**: Docker volume `vinyl_cover_art` mounted at `/app/data/cover-art`
- **File naming**: `{album_id}_{hash}.{ext}` (e.g., `42_a3f5c8d2.jpg`)
- **Formats supported**: JPEG, PNG, GIF, WebP
- **Automatic cleanup**: Files are stored with MD5 hash to prevent duplicates

### Database Schema

New columns added to the `albums` table:

```sql
musicbrainz_id UUID                 -- MusicBrainz Release ID (MBID)
local_cover_path TEXT               -- Local filename for cached cover art
cover_art_fetched BOOLEAN           -- Whether we attempted to fetch from MusicBrainz
```

## API Endpoints

### Get Cover Art

```
GET /api/cover-art/:id
```

Returns the album cover art image. The endpoint automatically:
- Serves locally cached files with proper MIME types
- Redirects to MusicBrainz/Discogs URLs when appropriate
- Returns 404 if no cover art is available

**Response**: Image file or redirect (302)

### Fetch Official Cover Art

```
POST /api/cover-art/:id/fetch
```

Manually trigger MusicBrainz cover art fetching for an existing album.

**Response**:
```json
{
  "message": "Official cover art found and cached",
  "source": "musicbrainz",
  "coverArtUrl": "/api/cover-art/42"
}
```

## Architecture

### Backend Services

#### MusicBrainzService (`backend/src/services/musicbrainz.ts`)

- **Rate limiting**: 1 request per second (MusicBrainz requirement)
- **Caching**: 30-day Redis cache for search results and cover art URLs
- **API clients**: Separate axios instances for MusicBrainz API and Cover Art Archive

**Key methods**:
- `searchRelease(artist, album)` - Find album in MusicBrainz database
- `getCoverArt(mbid)` - Fetch cover art URL from Cover Art Archive
- `searchAndGetCoverArt(artist, album)` - Combined search and fetch
- `downloadCoverArt(url)` - Download image as Buffer for local storage

#### StorageService (`backend/src/services/storage.ts`)

Manages local file storage for album cover art.

**Key methods**:
- `saveCoverArt(buffer, albumId, sourceUrl?)` - Save image to disk
- `readCoverArt(filename)` - Read image from disk
- `getMimeType(filename)` - Detect MIME type from extension
- `detectImageFormat(buffer)` - Detect format from magic numbers

### Album Addition Flow

```
User adds album
    ↓
Album created in database
    ↓
Response sent to user (fast)
    ↓
Background task starts:
    ├─ Search MusicBrainz
    ├─ If found with cover art:
    │   └─ Update DB with MBID and official URL
    └─ If not found or no cover art:
        └─ Download and cache existing Discogs/other cover art locally
```

This background approach ensures the UI remains responsive while official cover art is fetched.

## MusicBrainz vs Discogs

| Feature | MusicBrainz | Discogs |
|---------|-------------|---------|
| **Cover art source** | Cover Art Archive (official) | User-submitted |
| **Quality** | High-quality official releases | Varies |
| **Coverage** | ~50% of albums | ~95% of albums |
| **Rate limits** | 1 req/sec | 60 req/min |
| **Cost** | Free | Free with token |
| **Usage** | Primary for cover art | Fallback + search |

## Storage & Performance

### Disk Usage

- **Average cover art size**: ~100-300 KB per album
- **1000 albums**: ~200 MB storage needed
- **Docker volume**: Persistent across container restarts

### Caching Strategy

1. **MusicBrainz API responses**: 30 days in Redis
2. **Cover Art Archive URLs**: 30 days in Redis
3. **Local cover files**: Permanent (until manually deleted)

### Performance Characteristics

- **First request**: May redirect to external CDN (fast)
- **Subsequent requests**: Served from local cache (fastest)
- **Cache hit ratio**: ~95% after warmup period

## Development

### Testing MusicBrainz Integration

```bash
# Check backend logs for MusicBrainz initialization
docker logs vinyl_backend | grep -i musicbrainz

# Test cover art endpoint
curl -I http://localhost:5001/api/cover-art/1

# Manually fetch official cover art for album ID 42
curl -X POST http://localhost:5001/api/cover-art/42/fetch
```

### Inspecting Local Storage

```bash
# List cached cover art files
docker exec vinyl_backend ls -lh /app/data/cover-art

# Check volume size
docker volume inspect vinyl_cover_art
```

### Database Queries

```sql
-- Albums with MusicBrainz cover art
SELECT id, title, musicbrainz_id, cover_image_url
FROM albums
WHERE musicbrainz_id IS NOT NULL;

-- Albums with locally cached cover art
SELECT id, title, local_cover_path
FROM albums
WHERE local_cover_path IS NOT NULL;

-- Albums pending cover art fetch
SELECT id, title
FROM albums
WHERE cover_art_fetched = FALSE;
```

## Environment Variables

### MusicBrainz Configuration

```bash
# Enable/disable MusicBrainz lookups (default: true)
# Set to 'false' to use only Discogs artwork
MUSICBRAINZ_ENABLED=true

# Override default storage path (default: /app/data/cover-art)
COVER_ART_STORAGE_PATH=/custom/path
```

### When to Disable MusicBrainz

Set `MUSICBRAINZ_ENABLED=false` if you want to:

- **Use only Discogs artwork** - All cover art will come from Discogs
- **Avoid external API calls** - No MusicBrainz or Cover Art Archive lookups
- **Faster album addition** - Skip the MusicBrainz search step
- **Simpler setup** - Only need Discogs token, no MusicBrainz dependency

**With MusicBrainz disabled:**
1. Albums are added with Discogs cover art URLs
2. Cover art is downloaded and cached locally immediately
3. All images served from local storage (fastest)
4. No background MusicBrainz lookups happen

**Example:**
```bash
# .env file
MUSICBRAINZ_ENABLED=false
DISCOGS_TOKEN=your_token_here
```

Now all cover art will be sourced from Discogs and cached locally.

## Troubleshooting

### Cover art not loading

1. Check backend logs: `docker logs vinyl_backend`
2. Verify MusicBrainz service initialized: Look for "✓ MusicBrainz service initialized"
3. Check if album has cover art in database:
   ```sql
   SELECT cover_image_url, local_cover_path, musicbrainz_id
   FROM albums WHERE id = <album_id>;
   ```

### Rate limit errors

MusicBrainz enforces 1 request per second. The rate limiter handles this automatically, but bulk imports may take time:

```
Adding 100 albums = ~100 seconds for MusicBrainz lookups
```

This happens in the background and doesn't block the UI.

### Storage volume full

```bash
# Check volume usage
docker system df -v

# Remove unused volumes
docker volume prune

# Backup and recreate volume if needed
docker volume create vinyl_cover_art_new
```

## Future Enhancements

Potential improvements for the MusicBrainz integration:

- [ ] Batch processing for existing albums without cover art
- [ ] Image optimization (resize/compress) before local storage
- [ ] Multiple resolution variants (thumbnail, full-size)
- [ ] Fallback to album artist's discography if exact album not found
- [ ] User interface to manually trigger cover art refresh
- [ ] Statistics dashboard showing MusicBrainz coverage percentage
