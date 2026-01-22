import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import pool from './config/database';
import redis from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import * as albumController from './controllers/albumController';
import * as barcodeController from './controllers/barcodeController';
import * as searchController from './controllers/searchController';
import * as imageController from './controllers/imageController';
import * as discogsController from './controllers/discogsController';
import * as coverArtController from './controllers/coverArtController';
import backupRoutes from './routes/backup';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// CORS - optional, only enabled if CORS_ORIGIN is set
if (process.env.CORS_ORIGIN) {
  console.log(`✓ CORS enabled for origin: ${process.env.CORS_ORIGIN}`);
  app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
  }));
} else {
  console.log('✓ CORS disabled (same-origin only)');
}

app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Serve static files from frontend build (for single-container deployment)
// This will be a no-op if the 'public' directory doesn't exist (multi-container mode)
import path from 'path';
import { existsSync } from 'fs';

const publicPath = path.join(__dirname, '../public');
if (existsSync(publicPath)) {
  console.log('✓ Serving frontend static files from /public');
  app.use(express.static(publicPath));
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: 'Database connection failed' });
  }
});

// API routes
app.get('/api', (req, res) => {
  res.json({ message: 'Vinyl Collector API', version: '1.0.0' });
});

// Album routes
app.get('/api/albums', albumController.getAllAlbums);
app.get('/api/albums/:id', albumController.getAlbumById);
app.post('/api/albums', albumController.addAlbum);
app.delete('/api/albums/:id', albumController.deleteAlbum);
app.patch('/api/albums/:id/notes', albumController.updateAlbumNotes);
app.patch('/api/albums/:id/status', albumController.updateAlbumStatus);

// Search route
app.get('/api/search', searchController.search);

// Barcode route
app.post('/api/barcode/scan', barcodeController.scanBarcode);

// Image recognition routes
app.post('/api/image/analyze', imageController.analyzeImage);
app.post('/api/image/confirm', imageController.confirmAlbum);

// Discogs import routes
app.get('/api/discogs/config', discogsController.checkDiscogsConfig);
app.get('/api/discogs/import', discogsController.importCollection);
// Backup routes
app.use('/api/backup', backupRoutes);

// Cover art routes
app.get('/api/cover-art/:id', coverArtController.getCoverArt);
app.post('/api/cover-art/:id/fetch', coverArtController.fetchOfficialCoverArt);
app.get('/api/cover-art/:id/search', coverArtController.searchCoverArt);
app.post('/api/cover-art/:id/update', coverArtController.updateCoverArt);

// SPA fallback - serve index.html for all non-API routes (single-container mode)
// This must come AFTER all API routes
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  const indexPath = path.join(__dirname, '../public/index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await pool.end();
  await redis.quit();
  process.exit(0);
});
