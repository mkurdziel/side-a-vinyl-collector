# Vinyl Collector

A modern web application for managing your vinyl record collection with AI-powered album recognition.

## Features

- **Album Management**: Add, view, and organize your vinyl collection
- **AI Vision Recognition**: Upload photos of album covers for automatic identification
  - Dual-provider fallback system (OpenAI GPT-4 + Anthropic Claude)
  - Configurable confidence thresholds
  - Automatic fallback for maximum accuracy
- **Barcode Scanning**: Scan barcodes to quickly add albums
- **Discogs Integration**: Import your entire Discogs collection
  - Automatic deduplication
  - Bulk import with progress tracking
- **Smart Search**: Search your collection and Discogs database with debouncing
- **Cover Art**: Automatic cover image fetching from Discogs

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

1. Clone the repository:
```bash
git clone https://github.com/mkurdziel/side-a-vinyl-collector.git
cd side-a-vinyl-collector
```

2. Copy environment template:
```bash
cp .env.example .env
```

3. Configure your API keys in `.env`:
```bash
# Required for Discogs import
DISCOGS_TOKEN=your_discogs_token

# Vision providers (configure at least one, both recommended)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Vision configuration
VISION_PROVIDER=openai          # Primary provider
VISION_MIN_CONFIDENCE=90        # Fallback threshold
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

## License

MIT

## Contributing

Pull requests welcome! Please ensure:
- Code follows existing style
- Tests pass (when implemented)
- Documentation is updated
