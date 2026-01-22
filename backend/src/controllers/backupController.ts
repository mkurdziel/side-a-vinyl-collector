import { type Request, type Response } from 'express';
import asyncHandler from 'express-async-handler';
import pool from '../config/database';
import storageService from '../services/storage';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { AppError } from '../middleware/errorHandler';

// Helper to disable foreign key constraints during import
const disableConstraints = async (client: any) => {
  await client.query('SET session_replication_role = "replica";');
};

const enableConstraints = async (client: any) => {
  await client.query('SET session_replication_role = "origin";');
};

export const exportBackup = asyncHandler(async (req: Request, res: Response) => {
  // 1. Fetch data
  const artists = await pool.query('SELECT * FROM artists');
  const albums = await pool.query('SELECT * FROM albums');
  const collections = await pool.query('SELECT * FROM collections');

  const data = {
    version: '1.1',
    timestamp: new Date().toISOString(),
    artists: artists.rows,
    albums: albums.rows,
    collections: collections.rows,
  };

  // 2. Set headers for file download
  const date = new Date().toISOString().split('T')[0];
  const filename = `vinyl-collector-backup-${date}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // 3. Create zip stream
  const archive = archiver('zip', {
    zlib: { level: 9 } // Maximum compression
  });

  // Pipe archive data to the response
  archive.pipe(res);

  // 4. Append database data
  archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });

  // 5. Append cover art images
  for (const album of albums.rows) {
    if (album.local_cover_path) {
      const fullPath = storageService.getFullPath(album.local_cover_path);
      try {
        if (await storageService.exists(album.local_cover_path)) {
          archive.file(fullPath, { name: `cover-art/${album.local_cover_path}` });
        }
      } catch (err) {
        console.error(`Failed to add file ${fullPath} to archive:`, err);
      }
    }
  }

  // 6. Finalize archive
  await archive.finalize();
});

export const importBackup = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError('No backup file provided', 400);
  }

  const zipPath = req.file.path;
  const client = await pool.connect();

  try {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    // 1. Read data.json
    const dataEntry = zipEntries.find(entry => entry.entryName === 'data.json');
    if (!dataEntry) {
      throw new AppError('Invalid backup: data.json not found', 400);
    }

    const data = JSON.parse(dataEntry.getData().toString('utf8'));

    if (!data.artists || !data.albums) {
      throw new AppError('Invalid backup: Missing data tables', 400);
    }

    // 2. Begin Transaction
    await client.query('BEGIN');
    await disableConstraints(client);

    // 3. Truncate tables
    await client.query('TRUNCATE TABLE collections, albums, artists CASCADE');

    // 4. Restore Artists
    if (data.artists && data.artists.length > 0) {
      for (const artist of data.artists) {
        await client.query(
          'INSERT INTO artists (id, name, created_at) VALUES ($1, $2, $3)',
          [artist.id, artist.name, artist.created_at]
        );
      }
      // Fix sequence
      await client.query("SELECT setval('artists_id_seq', (SELECT MAX(id) FROM artists))");
    }

    // 5. Restore Albums
    if (data.albums && data.albums.length > 0) {
      for (const album of data.albums) {
        await client.query(
          `INSERT INTO albums (
            id, artist_id, title, year, cover_image_url, 
            local_cover_path, cover_art_fetched, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            album.id, album.artist_id, album.title, album.year, album.cover_image_url,
            album.local_cover_path, album.cover_art_fetched, 
            album.created_at, album.updated_at
          ]
        );
      }
      // Fix sequence
      await client.query("SELECT setval('albums_id_seq', (SELECT MAX(id) FROM albums))");
    }

    // 6. Restore Collections (Status & Notes)
    if (data.collections && data.collections.length > 0) {
      for (const collection of data.collections) {
        // Handle migration from old backups that might lack 'status'
        const status = collection.status || 'collection';
        
        await client.query(
          `INSERT INTO collections (
            id, album_id, added_at, notes, status
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            collection.id, collection.album_id, collection.added_at, 
            collection.notes, status
          ]
        );
      }
      // Fix sequence
      await client.query("SELECT setval('collections_id_seq', (SELECT MAX(id) FROM collections))");
    }

    await enableConstraints(client);
    await client.query('COMMIT');

    // 6. Restore Cover Art
    zipEntries.forEach(entry => {
      if (entry.entryName.startsWith('cover-art/') && !entry.isDirectory) {
        const fileName = path.basename(entry.entryName);
        // We know where to store it based on storageService
        // But storageService doesn't expose raw path writing easily, 
        // using fs directly or modifying storageService. 
        // Assuming storageService uses a fixed root.
        
        // We can just dump into the storage dir
        const targetPath = storageService.getFullPath(fileName);
        try {
          fs.writeFileSync(targetPath, entry.getData());
        } catch (err) {
          console.error(`Failed to restore file ${fileName}:`, err);
        }
      }
    });

    res.json({ 
      message: 'Backup restored successfully',
      stats: {
        artists: data.artists.length,
        albums: data.albums.length
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    // Cleanup upload
    try {
      fs.unlinkSync(zipPath);
    } catch (e) {}
  }
});
