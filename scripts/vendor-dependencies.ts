#!/usr/bin/env bun
// Registry tarballs remain byte-for-byte originals; never trust an unpacked global cache.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dir, '..');
const vendor = join(root, 'vendor');
const projects = ['backend', 'frontend'];
const targets = [{ os: 'linux', cpu: 'x64' }, { os: 'linux', cpu: 'arm64' }, { os: 'darwin', cpu: 'arm64' }, { os: 'darwin', cpu: 'x64' }];
type Entry = { name: string; version: string; integrity: string; url: string; file: string; projects: string[]; os?: string | string[]; cpu?: string | string[]; license?: unknown };
const hash = (data: Buffer | string, algorithm = 'sha256', encoding: 'hex' | 'base64' = 'hex') => createHash(algorithm).update(data).digest(encoding);
const read = (path: string) => readFileSync(join(root, path));
const parseLock = (project: string) => JSON.parse(read(`${project}/bun.lock`).toString().replace(/,\s*([}\]])/g, '$1'));
function allows(rule: string | string[] | undefined, value: string) {
  if (!rule) return true;
  const list = Array.isArray(rule) ? rule : [rule];
  return !list.includes(`!${value}`) && (list.every(v => v.startsWith('!')) || list.includes(value));
}
function closure() {
  const entries = new Map<string, Entry>();
  for (const project of projects) for (const tuple of Object.values(parseLock(project).packages) as any[]) {
    const [specifier, registry, metadata, integrity] = tuple;
    const split = specifier.lastIndexOf('@');
    const name = specifier.slice(0, split), version = specifier.slice(split + 1);
    if (!integrity?.startsWith('sha512-')) throw new Error(`Missing SHA512 integrity: ${specifier}`);
    if (!targets.some(t => allows(metadata.os, t.os) && allows(metadata.cpu, t.cpu))) continue;
    const key = `${specifier}:${integrity}`;
    if (entries.has(key)) { entries.get(key)!.projects.push(project); continue; }
    const basename = name.split('/').pop();
    const url = registry || `https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`;
    if (!url.startsWith('https://registry.npmjs.org/')) throw new Error(`Review non-npm source: ${url}`);
    entries.set(key, { name, version, integrity, url, file: `npm/${name.replaceAll('/', '+')}-${version}-${hash(integrity).slice(0, 12)}.tgz`, projects: [project], ...(metadata.os ? { os: metadata.os } : {}), ...(metadata.cpu ? { cpu: metadata.cpu } : {}) });
  }
  return [...entries.values()].sort((a, b) => a.file.localeCompare(b.file, 'en'));
}
function checked(entry: Entry) {
  const data = readFileSync(join(vendor, entry.file));
  if (`sha512-${hash(data, 'sha512', 'base64')}` !== entry.integrity) throw new Error(`Integrity mismatch: ${entry.file}`);
  return data;
}
function run(command: string, args: string[], options: any = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.error || ''}`);
  return result;
}
function inputHashes() { return Object.fromEntries(projects.flatMap(p => ['package.json', 'bun.lock'].map(f => [`${p}/${f}`, hash(read(`${p}/${f}`))]))); }
function normalizeModes(path: string) {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) return;
  // npm archives occasionally have non-traversable directories (e.g. pngjs6).
  // Match package-manager extraction: directories traversable, files readable,
  // and preserve the archive's executable bits without world-writable modes.
  chmodSync(path, info.isDirectory() || (info.mode & 0o111) ? 0o755 : 0o644);
  if (info.isDirectory()) for (const child of readdirSync(path)) normalizeModes(join(path, child));
}
function cacheVersion(version: string) {
  // Bun hashes prerelease tags in npm cache directory names. This is the
  // gensync prerelease key for pinned Bun1.4.4. New prereleases require
  // reviewing the key and repeating clean offline installation checks.
  if (version === '1.0.0-beta.2') return '1.0.0-4049f5e8f1219d89';
  if (version.includes('-') || version.includes('+')) throw new Error(`Record Bun1.4.4 cache key for ${version}`);
  return version;
}
function verify() {
  const manifest = JSON.parse(read('vendor/manifest.json').toString());
  if (JSON.stringify(manifest.inputs) !== JSON.stringify(inputHashes())) throw new Error('Manifests/locks changed: regenerate vendor assets.');
  const entries = closure();
  if (JSON.stringify(entries.map(({ license, ...e }) => e)) !== JSON.stringify(manifest.packages.map(({ license, ...e }: Entry) => e))) throw new Error('Vendor inventory differs from lock closure.');
  for (const entry of manifest.packages) checked(entry);
  if (readdirSync(join(vendor, 'npm')).length !== entries.length) throw new Error('Unexpected/missing vendor tarballs.');
  console.log(`Verified ${entries.length} original npm tarballs against lock SHA512 integrities.`);
  return manifest.packages as Entry[];
}

const [command = 'verify', project, ...flags] = process.argv.slice(2);
if (command === 'refresh') {
  mkdirSync(join(vendor, 'npm'), { recursive: true });
  const entries = closure();
  let index = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (index < entries.length) {
      const entry = entries[index++];
      const path = join(vendor, entry.file);
      if (!existsSync(path)) {
        const response = await fetch(entry.url);
        if (!response.ok) throw new Error(`${response.status}: ${entry.url}`);
        const data = Buffer.from(await response.arrayBuffer());
        if (`sha512-${hash(data, 'sha512', 'base64')}` !== entry.integrity) throw new Error(`Registry integrity mismatch: ${entry.url}`);
        if (data.length >= 100 * 1024 * 1024) throw new Error(`Tarball exceeds GitHub file limit: ${entry.url}`);
        writeFileSync(path, data);
      }
      checked(entry);
      const listing = run('tar', ['-tzf', path], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 10 * 1024 * 1024 }).stdout.toString().split('\n');
      const packageJson = listing.find((name: string) => /^[^/]+\/package\.json$/.test(name));
      if (!packageJson) throw new Error(`No package manifest: ${entry.file}`);
      const result = run('tar', ['-xOzf', path, packageJson], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 10 * 1024 * 1024 });
      entry.license = JSON.parse(result.stdout.toString()).license || 'SEE LICENSE IN PACKAGE';
    }
  }));
  const retained = new Set(entries.map(e => e.file.split('/').pop()));
  for (const file of readdirSync(join(vendor, 'npm'))) if (!retained.has(file)) rmSync(join(vendor, 'npm', file));
  writeFileSync(join(vendor, 'manifest.json'), `${JSON.stringify({ format: 1, bun: '1.4.4', registry: 'https://registry.npmjs.org', targets, inputs: inputHashes(), packages: entries }, null, 2)}\n`);
  verify();
} else if (command === 'verify') {
  verify();
} else if (command === 'install') {
  if (Bun.version !== '1.4.4') throw new Error(`Use pinned Bun1.4.4 (found ${Bun.version}).`);
  if (!projects.includes(project)) throw new Error('Usage: bun scripts/vendor-dependencies.ts install backend|frontend [--production]');
  if (flags.some(f => f !== '--production')) throw new Error('Only --production is supported.');
  const entries = verify();
  const cache = mkdtempSync(join(tmpdir(), 'side-a-bun-offline-'));
  try {
    for (const entry of entries.filter(e => e.projects.includes(project) && allows(e.os, process.platform) && allows(e.cpu, process.arch))) {
      // Bun1.4.4's npm cache layout is versioned by the runtime pin above.
      const destination = join(cache, `${entry.name}@${cacheVersion(entry.version)}@@@1`);
      mkdirSync(destination, { recursive: true });
      run('tar', ['-xzf', join(vendor, entry.file), '--strip-components=1', '-C', destination]);
      normalizeModes(destination);
    }
    run(process.execPath, ['install', '--cwd', join(root, project), '--frozen-lockfile', '--offline', '--ignore-scripts', '--cache-dir', cache, ...flags], { env: { ...process.env, BUN_INSTALL_CACHE_DIR: cache } });
  } finally { rmSync(cache, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
} else throw new Error(`Unknown command: ${command}`);
