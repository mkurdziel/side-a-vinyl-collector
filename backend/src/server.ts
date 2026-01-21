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

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

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
