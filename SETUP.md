# Vinyl Collector - Setup Guide

## Overview

Your vinyl collection tracker is now complete! This guide will walk you through getting it running.

## What You Have

A complete full-stack application with:

✅ **Backend (Bun + Express)**
- RESTful API with all endpoints
- Discogs API integration with rate limiting & caching
- Claude Vision API for image recognition
- PostgreSQL with fuzzy search (trigrams)
- Redis caching

✅ **Frontend (React + TypeScript)**
- Responsive album grid with covers
- Unified search across artist/album
- Add albums from Discogs
- Delete albums from collection

✅ **Docker Setup**
- Multi-container orchestration
- PostgreSQL with data persistence
- Redis with AOF persistence
- Health checks and auto-restart

## Quick Start

### 1. Get API Keys

You'll need two API keys:

**Discogs API Token:**
1. Go to https://www.discogs.com/settings/developers
2. Create a new token
3. Copy the token

**Claude API Key:**
1. Go to https://console.anthropic.com/
2. Create an API key
3. Copy the key

### 2. Configure Environment

Edit the `.env` file in the project root:

```bash
# Add your API keys
DISCOGS_TOKEN=your_discogs_token_here
ANTHROPIC_API_KEY=your_claude_api_key_here

# Update the password (recommended)
POSTGRES_PASSWORD=your_secure_password_here
```

### 3. Start with Docker (Recommended)

```bash
# Start all services
docker-compose up -d

# Watch logs
docker-compose logs -f

# Check health
curl http://localhost:5000/health
```

Access the app at: **http://localhost:3000**

### 4. Alternative: Run Locally (Development)

**Terminal 1 - Start databases:**
```bash
docker-compose up postgres redis
```

**Terminal 2 - Start backend:**
```bash
cd backend
bun run migrate  # Run database migrations
bun run dev      # Start backend with hot reload
```

**Terminal 3 - Start frontend:**
```bash
cd frontend
bun run dev      # Start frontend with hot reload
```

Access the app at: **http://localhost:5173** (Vite dev server)

## Usage

### Adding Albums

1. **Search for an album** using the search bar
   - Type artist name, album name, or both
   - Results from your collection appear first
   - Discogs results appear if you have < 5 local results

2. **Click "+ Add"** on any Discogs result to add it to your collection
   - Album cover is automatically downloaded
   - Duplicate prevention is built-in

3. **Future: Barcode Scanning** (backend ready, frontend needs implementation)
   - Endpoint: `POST /api/barcode/scan`
   - Send: `{ "barcode": "1234567890" }`

4. **Future: Image Recognition** (backend ready, frontend needs implementation)
   - Endpoint: `POST /api/image/analyze`
   - Send: `{ "image": "base64_image_data" }`

### Managing Collection

- **View all albums** - Grid view with covers, artist, album, year
- **Search your collection** - Type in search bar to filter
- **Delete albums** - Click 🗑️ button on any album card
- **Future: Add notes** - Edit notes for each album (backend ready)

## API Endpoints

All endpoints are at `http://localhost:5000/api`

### Albums
- `GET /albums` - List all albums in collection
- `POST /albums` - Add album (artist, album, year, coverImageUrl, discogsId, barcode)
- `DELETE /albums/:id` - Remove from collection
- `PATCH /albums/:id/notes` - Update notes

### Search
- `GET /search?q={query}` - Search by artist or album

### Barcode
- `POST /barcode/scan` - Scan barcode → get album info

### Image Recognition
- `POST /image/analyze` - Upload image → get matches
- `POST /image/confirm` - Confirm and add from Discogs

## Architecture

```
Frontend (React)          Backend (Bun)          Databases
     │                         │                      │
     ├─ Search UI              ├─ Express API         ├─ PostgreSQL
     ├─ Album Grid             ├─ Discogs Service     │   └─ Fuzzy search
     ├─ Add Albums             ├─ Vision Service      └─ Redis
     └─ Delete Albums          └─ Rate Limiting           └─ API cache
```

## Database Schema

- **artists** - id, name, discogs_id
- **albums** - id, artist_id, title, year, cover_image_url, discogs_id
- **collections** - id, album_id, notes, added_at
- **barcodes** - id, barcode, album_id

## Docker Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart a service
docker-compose restart backend

# Run migrations
docker-compose exec backend bun run migrate

# Access database
docker-compose exec postgres psql -U vinyl_user -d vinyl_collector

# Access Redis CLI
docker-compose exec redis redis-cli

# Rebuild containers
docker-compose up -d --build
```

## Troubleshooting

### Backend won't start
- Check `.env` file exists with API keys
- Check database is healthy: `docker-compose ps`
- View logs: `docker-compose logs backend`

### Database connection failed
- Ensure postgres is running: `docker-compose ps postgres`
- Check postgres logs: `docker-compose logs postgres`
- Verify credentials in `.env`

### Discogs API not working
- Verify `DISCOGS_TOKEN` in `.env`
- Check rate limit (60 requests/min)
- View backend logs for errors

### Frontend can't reach backend
- Check `VITE_API_URL` in `.env`
- Verify backend is running on port 5000
- Check CORS configuration

### Search not working
- Ensure pg_trgm extension is installed
- Run migrations: `bun run migrate`
- Check postgres logs for errors

## Next Steps (Optional Enhancements)

The backend already supports these features - just need frontend UI:

1. **Barcode Scanning**
   - Add camera component using Quagga2
   - Call `/api/barcode/scan` endpoint
   - Display results and add to collection

2. **Image Recognition**
   - Add image upload component
   - Call `/api/image/analyze` endpoint
   - Show matches and let user select

3. **Notes**
   - Add notes text area to album cards
   - Call `/api/albums/:id/notes` endpoint
   - Display notes in album detail view

4. **Statistics**
   - Total albums count
   - Albums by artist
   - Albums by year
   - Most collected artists

5. **Export**
   - Export to CSV
   - Export to JSON
   - Backup collection data

## Cost Estimates

**Free tier usage (light use):**
- Discogs API: FREE (60 requests/min)
- Claude Vision: ~$0 (if not using image feature)
- Infrastructure: FREE (self-hosted)

**Medium usage (100-200 albums, occasional image scans):**
- Discogs API: FREE
- Claude Vision: ~$5-10/month
- Infrastructure: FREE (self-hosted)

## Security Notes

- Never commit `.env` file (already in `.gitignore`)
- Change default PostgreSQL password
- Use strong passwords for production
- API keys are sensitive - keep them secret
- Run behind HTTPS in production

## Support

Created with comprehensive planning and implementation.

For issues:
1. Check logs: `docker-compose logs -f`
2. Verify health: `curl http://localhost:5000/health`
3. Check database: `docker-compose exec postgres psql -U vinyl_user -d vinyl_collector`

Enjoy tracking your vinyl collection! 🎵
