# Vinyl Collector

A self-hosted web application for tracking your vinyl record collection with Discogs API integration, barcode scanning, image recognition, and unified search.

## Features

- **3 Ways to Add Records:**
  1. 📷 **Barcode Scanning** - Use your device camera to scan vinyl barcodes
  2. 🖼️ **Image Recognition** - Upload a photo of the album cover and let Claude Vision extract the details
  3. 🔍 **Unified Search** - Search by artist or album name across your collection and Discogs

- **Automatic Album Covers** - All album artwork fetched automatically from Discogs
- **Smart Search** - Single search field with fuzzy matching across artist and album fields
- **No Duplicates** - Built-in duplicate prevention
- **Notes** - Add personal notes to each album
- **Self-Hosted** - Run entirely on your own infrastructure with Docker

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Bun + Express + TypeScript
- **Database**: PostgreSQL (with trigram search)
- **Cache**: Redis
- **APIs**: Discogs API, Claude Vision API
- **Deployment**: Docker Compose

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Discogs API token ([Get one here](https://www.discogs.com/settings/developers))
- Claude API key ([Get one here](https://console.anthropic.com/))

### Setup

1. Clone the repository and navigate to the project directory

2. Copy the environment example file:
```bash
cp .env.example .env
```

3. Edit `.env` and add your API keys:
```bash
DISCOGS_TOKEN=your_discogs_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
POSTGRES_PASSWORD=change_this_to_something_secure
```

4. Start the application with Docker Compose:
```bash
docker-compose up -d
```

5. Access the application:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000
   - Health Check: http://localhost:5000/health

## Development

### Backend Development

```bash
cd backend
bun install
bun run dev
```

### Frontend Development

```bash
cd frontend
bun install
bun run dev
```

### Database Migrations

Run migrations manually:
```bash
cd backend
bun run migrate
```

## API Endpoints

### Albums
- `GET /api/albums` - List all albums in collection
- `GET /api/albums/:id` - Get album details
- `POST /api/albums` - Add album to collection
- `DELETE /api/albums/:id` - Remove from collection
- `PATCH /api/albums/:id/notes` - Update notes

### Search
- `GET /api/search?q={query}` - Unified search across artist and album

### Barcode
- `POST /api/barcode/scan` - Scan barcode and get album info

### Image Recognition
- `POST /api/image/analyze` - Analyze album image with Claude Vision
- `POST /api/image/confirm` - Confirm and add album from Discogs

## Architecture

```
┌─────────────────┐
│  React Frontend │ (Port 3000)
│  - Camera UI    │
│  - Collection   │
└────────┬────────┘
         │ HTTP/REST
┌────────▼────────┐
│  Express API    │ (Port 5000)
│  - Auth         │
│  - Collection   │
│  - Discogs      │
└─┬──────┬───────┬┘
  │      │       │
  │      │       └──────┐
  │      │              │
┌─▼──────▼───┐    ┌────▼─────┐
│ PostgreSQL │    │  Redis   │
│  (Port     │    │  (Cache) │
│   5432)    │    └──────────┘
└────────────┘
```

## Database Schema

- **artists** - Artist information
- **albums** - Album metadata with cover URLs
- **collections** - User's collection (many-to-many)
- **barcodes** - Barcode to album mappings

## Environment Variables

See `.env.example` for all available configuration options.

## Cost Estimates

### API Costs (Monthly for moderate use)
- **Discogs API**: Free (rate limited to 60/min)
- **Claude Vision**: ~$5-10 (assuming 100-200 image scans/month)

### Infrastructure (Self-Hosted)
- **Docker resources**: 2 CPU cores, 4GB RAM recommended
- **Storage**: 10GB minimum (for database + images)

## Features Roadmap

- [x] Barcode scanning
- [x] Image recognition
- [x] Unified search
- [x] Album covers
- [x] Duplicate prevention
- [ ] Multi-user support
- [ ] Export to CSV/JSON
- [ ] Statistics dashboard
- [ ] Wishlist feature
- [ ] Album condition tracking

## License

MIT

## Support

For issues and questions, please create an issue in the repository.
