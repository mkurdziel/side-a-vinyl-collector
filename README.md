# Vinyl Collector

A modern web application for managing your vinyl record collection with AI-powered album recognition.

## Features

- **Album Management**: Add, view, and organize your vinyl collection
- **Wishlist Management**: 
  - Separate wishlist view for albums you want to acquire
  - Easy toggle between Collection and Wishlist
  - Move albums between collection and wishlist
  - Search and add directly to wishlist
- **AI Vision Recognition**: Upload photos of album covers for automatic identification
  - Dual-provider fallback system (OpenAI GPT-4 + Anthropic Claude)
  - Configurable confidence thresholds
  - Automatic fallback for maximum accuracy
- **Barcode Scanning**: Scan barcodes to quickly add albums
- **Discogs Integration**: Import your entire Discogs collection
  - Automatic deduplication
  - Bulk import with progress tracking
- **MusicBrainz Integration**: 
  - Official cover art from Cover Art Archive
  - Artist and album discovery with prioritized results
  - Automatic fallback to Discogs artwork
  - Local caching for fast loading
  - Optional - can be disabled to use only Discogs
- **Smart Search**: 
  - Search your collection and external databases (MusicBrainz + Discogs)
  - Visual indicators for items already in collection/wishlist
  - Seamless multi-add workflow without page reloads
  - Debounced search for performance
- **Cover Art Management**:
  - Priority: Local cache → MusicBrainz → Discogs
  - Persistent storage with Docker volumes
  - Automatic format detection and optimization
- **Data Backup/Restore**: Export and import your entire collection with cover art

## Tech Stack

### Frontend
- React 19 with TypeScript
- Vite for build tooling
- Tailwind CSS for styling
- React Hot Toast for notifications

### Backend
- Bun runtime
- Express.js
- PostgreSQL database
- Redis caching
- OpenAI GPT-4 Vision API
- Anthropic Claude Vision API
- Discogs API integration

## Quick Start

### Option 1: Single Container (Recommended for Simple Deployments)

The easiest way to run Vinyl Collector - everything in one container:

1. Clone the repository:
```bash
git clone https://github.com/mkurdziel/side-a-vinyl-collector.git
cd side-a-vinyl-collector
```

2. Copy environment template:
```bash
cp .env.example .env
```

3. Configure your API keys in `.env` (see Configuration section below)

4. Start the application:
```bash
docker compose -f docker-compose.single.yml up -d
```

5. Access the app at http://localhost:5001

### Option 2: Multi-Container (For Development/Advanced Use)

Separate frontend and backend containers for independent scaling:

1-3. Same as Option 1

4. Start the application:
```bash
docker compose up -d
```

5. Access the app:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5001

## Configuration
```bash
# Required for Discogs import and fallback cover art
DISCOGS_TOKEN=your_discogs_token

# Vision providers (configure at least one, both recommended)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Vision configuration
VISION_PROVIDER=openai          # Primary provider
VISION_MIN_CONFIDENCE=90        # Fallback threshold

# MusicBrainz configuration (optional)
MUSICBRAINZ_ENABLED=true        # Set to 'false' to use only Discogs artwork
```

4. Start the application:
```bash
docker compose up -d
```

5. Access the app:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5001

## Vision AI Configuration

The app supports intelligent dual-provider fallback for album cover recognition:

### How It Works
1. Primary provider (OpenAI or Anthropic) analyzes the image
2. If confidence < threshold (default 90%), fallback provider is tried
3. Result with highest confidence is returned

### Configuration Options

**Best Accuracy (Recommended)**:
```bash
VISION_PROVIDER=openai
VISION_MIN_CONFIDENCE=90
OPENAI_API_KEY=sk-xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

**Cost Optimized**:
```bash
VISION_PROVIDER=openai
VISION_MIN_CONFIDENCE=70
OPENAI_API_KEY=sk-xxxxx
```

See [VISION_PROVIDERS.md](VISION_PROVIDERS.md) for detailed configuration guide.

## Cover Art Configuration

The app fetches official cover art from MusicBrainz Cover Art Archive with automatic Discogs fallback:

### Default Behavior (MUSICBRAINZ_ENABLED=true)
1. When you add an album, MusicBrainz is searched for official cover art
2. If found, high-quality official art is used
3. If not found, Discogs cover art is downloaded and cached locally
4. All cover art is served through `/api/cover-art/:id` endpoint

### Discogs-Only Mode (MUSICBRAINZ_ENABLED=false)
```bash
MUSICBRAINZ_ENABLED=false
```

**Benefits:**
- Faster album addition (no MusicBrainz lookup)
- Simpler setup (only need Discogs token)
- All cover art cached locally immediately
- No external API dependencies beyond Discogs

**Use this mode if:**
- You want 100% Discogs artwork
- You want to avoid MusicBrainz API calls
- You prefer faster, simpler operation

See [MUSICBRAINZ.md](MUSICBRAINZ.md) for detailed cover art architecture.

## Development

### Project Structure
```
.
├── backend/           # Express API server
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   └── db/
├── frontend/          # React application
│   ├── src/
│   │   ├── components/
│   │   └── services/
└── docker-compose.yml
```

### Running Locally

Backend:
```bash
cd backend
bun install
bun run dev
```

Frontend:
```bash
cd frontend
bun install
bun run dev
```

### Database Migrations

Migrations run automatically on container start. To run manually:
```bash
docker exec vinyl_backend bun run migrate
```

## API Endpoints

- `GET /api/albums` - Get all albums in collection
- `POST /api/albums` - Add album to collection
- `DELETE /api/albums/:id` - Remove album from collection
- `GET /api/search?q=query` - Search local + Discogs
- `POST /api/barcode/scan` - Lookup album by barcode
- `POST /api/image/analyze` - Analyze album cover with AI
- `GET /api/discogs/import` - Import Discogs collection

## Environment Variables

See `.env.example` for all configuration options:

- Database: PostgreSQL connection settings
- Redis: Cache configuration
- Discogs: API token for imports and search
- Vision AI: OpenAI and Anthropic API keys
- Vision Config: Provider selection and confidence threshold

## CI/CD

This project uses GitHub Actions for continuous integration and release management:

- **CI**: Automatically builds and tests on every push/PR to `main`
- **Release**: Tag with `v*` (e.g., `v1.0.0`) to trigger Docker image build
- **Registry**: Images published to GitHub Container Registry (GHCR)
  - `ghcr.io/mkurdziel/side-a-vinyl-collector:latest`
  - `ghcr.io/mkurdziel/side-a-vinyl-collector:v1.0.0`

### Pulling the Image

```bash
docker pull ghcr.io/mkurdziel/side-a-vinyl-collector:latest
```

## License

GPL-3.0 - see [LICENSE](LICENSE) file for details

## Contributing

Pull requests welcome! Please ensure:
- Code follows existing style
- Tests pass (when implemented)
- Documentation is updated
