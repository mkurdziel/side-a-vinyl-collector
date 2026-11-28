import { type Request, type Response } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pool from '../config/database';
import storageService from '../services/storage';
import { ZipArchive } from 'archiver';
import AdmZip from 'adm-zip';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { readCoverArtProvenance } from '../services/coverArtProvenance';

type Row = Record<string, unknown> & { id: number };

const tables = ['artists', 'albums', 'collections', 'barcodes'] as const;
type Table = typeof tables[number];

const isArtworkName = (name: unknown): name is string =>
  typeof name === 'string' && /^[\w.-]+\.(jpe?g|png|gif|webp)$/i.test(name);

function readRows(value: unknown): Row[] {
  const ids = new Set<number>();
  if (!Array.isArray(value) || value.some(row => {
    if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.id) ||
        row.id < 1 || row.id >= 2147483647 || ids.has(row.id)) return true;
    ids.add(row.id);
    return false;
  })) {
    throw new AppError('The backup has invalid or duplicate record IDs.', 400);
  }
  return value;
}

function readBackup(zipPath: string) {
  try {
    const zip = new AdmZip(zipPath);
    const data = JSON.parse(zip.readAsText('data.json'));
    const artists = readRows(data.artists);
    const albums = readRows(data.albums);
    for (const album of albums) {
      album.cover_art_provenance = readCoverArtProvenance(album.cover_art_provenance, album.cover_image_url) ?? null;
    }
    const collections = readRows(data.collections ?? (data.version === '1.2' ? undefined : []));
    const hasBarcodes = data.barcodes !== undefined;
    const barcodes = readRows(hasBarcodes || data.version === '1.2' ? data.barcodes : []);
    const artistIds = new Set(artists.map(artist => artist.id));
    const albumIds = new Set(albums.map(album => album.id));
    if (artists.some(artist => typeof artist.name !== 'string') ||
        albums.some(album => typeof album.title !== 'string' || !artistIds.has(Number(album.artist_id))) ||
        collections.some(row => !albumIds.has(Number(row.album_id)) ||
          (row.status != null && row.status !== 'collection' && row.status !== 'wishlist')) ||
        barcodes.some(row => typeof row.barcode !== 'string' || !albumIds.has(Number(row.album_id)))) {
      throw new AppError('The backup has invalid shelf, barcode, or album records.', 400);
    }
    const artwork = new Map(zip.getEntries().flatMap(entry => {
      const name = entry.entryName.slice('cover-art/'.length);
      return !entry.isDirectory && entry.entryName.startsWith('cover-art/') && isArtworkName(name)
        ? [[name, entry] as const] : [];
    }));
    const missingArtwork = albums.filter(album =>
      typeof album.local_cover_path === 'string' && album.local_cover_path &&
      !artwork.has(album.local_cover_path)).length;
    const compatibilityWarnings = hasBarcodes ? [] : ['This older backup has no barcode mappings. Restoring it will remove current mappings.'];
    return {
      rows: { artists, albums, collections, barcodes },
      artwork,
      compatibilityWarnings,
      manifest: {
        timestamp: typeof data.timestamp === 'string' && Number.isFinite(Date.parse(data.timestamp)) ? data.timestamp : null,
        albums: albums.length,
        wishlist: collections.filter(row => row.status === 'wishlist').length,
        collection: collections.filter(row => row.status !== 'wishlist').length,
        barcodes: barcodes.length,
        artwork: albums.filter(album => typeof album.local_cover_path === 'string' && artwork.has(album.local_cover_path)).length,
        warnings: [
          ...compatibilityWarnings,
          ...(missingArtwork ? [`${missingArtwork} albums reference artwork missing from this archive.`] : []),
        ],
      },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Could not read this ZIP backup. Choose a ZIP exported by Vinyl Collector.', 400);
  }
}

async function withBackup<T>(req: Request, action: (backup: ReturnType<typeof readBackup>) => T): Promise<Awaited<T>> {
  if (!req.file) throw new AppError('Choose a ZIP backup file.', 400);
  try {
    return await action(readBackup(req.file.path));
  } finally {
    await fs.rm(req.file.path, { force: true }).catch(error => console.error('Backup upload cleanup failed:', error));
  }
}

export const exportBackup = asyncHandler(async (_req: Request, res: Response) => {
  const client = await pool.connect();
  const rows = {} as Record<Table, Row[]>;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const table of tables) rows[table] = (await client.query<Row>(`SELECT * FROM ${table}`)).rows;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const timestamp = new Date().toISOString();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="vinyl-collector-backup-${timestamp.slice(0, 10)}.zip"`);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', error => res.destroy(error));
  archive.on('warning', error => console.warn('Backup archive warning:', error));
  archive.pipe(res);
  archive.append(JSON.stringify({ version: '1.2', timestamp, ...rows }), { name: 'data.json' });
  const artwork = new Set(rows.albums.map(album => album.local_cover_path).filter(isArtworkName));
  for (const name of artwork) {
    if (await storageService.exists(name)) {
      archive.file(storageService.getFullPath(name), { name: `cover-art/${name}` });
    }
  }
  await archive.finalize();
});

export const previewBackup = asyncHandler(async (req: Request, res: Response) => {
  const manifest = await withBackup(req, backup => backup.manifest);
  res.json(manifest);
});

export const importBackup = asyncHandler(async (req: Request, res: Response) => {
  const outcome = await withBackup(req, async ({ rows, artwork, manifest, compatibilityWarnings }) => {
    const client = await pool.connect();
    const written: string[] = [];
    const skippedArtwork: { album: string; reason: string }[] = [];
    let committing = false;
    try {
      await client.query('BEGIN');
      // Lock removal receipts first, matching the membership transactions that use them.
      await client.query('TRUNCATE TABLE album_removal_undo, album_pressing_undo, album_move_undo, album_artwork_undo, barcodes, collections, albums, artists RESTART IDENTITY');
      for (const artist of rows.artists) artist.updated_at ??= artist.created_at;
      for (const row of rows.collections) row.status ??= 'collection';
      for (const album of rows.albums) {
        const name = album.local_cover_path;
        album.local_cover_path = null;
        if (typeof name !== 'string' || !name) continue;
        const entry = artwork.get(name);
        if (!entry) {
          skippedArtwork.push({ album: String(album.title), reason: 'Missing from the archive' });
          continue;
        }
        try {
          const saved = await storageService.saveRestoredCoverArt(entry.getData(), path.extname(name));
          written.push(saved);
          album.local_cover_path = saved;
        } catch (error) {
          console.error('Could not restore artwork:', error);
          skippedArtwork.push({ album: String(album.title), reason: 'Could not read or store the artwork file' });
        }
      }

      for (const table of tables) {
        await client.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1)`, [JSON.stringify(rows[table])]);
        const nextId = rows[table].reduce((next, row) => Math.max(next, row.id + 1), 1);
        await client.query(`ALTER SEQUENCE ${table}_id_seq RESTART WITH ${nextId}`);
      }
      const { rows: [restore] } = await client.query<{ restored_at: Date }>('SELECT clock_timestamp() AS restored_at');
      if (!restore) throw new Error('Could not record the backup restore time.');
      committing = true;
      await client.query('COMMIT');
      return {
        message: skippedArtwork.length || manifest.warnings.length ? 'Backup restored with warnings' : 'Backup restored',
        stats: { albums: manifest.albums, artists: rows.artists.length, artwork: written.length, barcodes: manifest.barcodes },
        restoredAt: restore.restored_at.toISOString(),
        warnings: compatibilityWarnings,
        skippedArtwork,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(rollbackError => console.error('Backup rollback failed:', rollbackError));
      // A lost commit response can leave a committed restore. Keep its artwork in that case.
      if (!committing) await Promise.all(written.map(name => storageService.deleteCoverArt(name)));
      const code = (error as { code?: string }).code;
      if (code?.startsWith('22') || code?.startsWith('23')) {
        throw new AppError('The backup contains incompatible record data. Your library was not changed.', 400);
      }
      throw error;
    } finally {
      client.release();
    }
  });
  res.json(outcome);
});
