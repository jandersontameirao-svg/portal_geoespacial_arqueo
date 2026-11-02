const http = require('http');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { mkdir, readFile, rename, unlink, writeFile, stat } = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { createClient } = require('redis');
const { Client } = require('pg');

const execFileAsync = promisify(execFile);
const config = {
  redis: { host: process.env.REDIS_HOST || 'redis', port: Number(process.env.REDIS_PORT || '6379') },
  postgres: { host: process.env.POSTGRES_HOST || 'postgis', port: Number(process.env.POSTGRES_PORT || '5432'), database: process.env.POSTGRES_DB || 'arqueo_gis', user: process.env.POSTGRES_USER || 'gis_user', password: process.env.POSTGRES_PASSWORD || 'gis_password' },
  worker: { concurrency: Number(process.env.WORKER_CONCURRENCY || '2'), logLevel: process.env.WORKER_LOG_LEVEL || 'info' },
  raster: { root: process.env.RASTER_WORKER_ROOT || '', token: process.env.RASTER_WORKER_TOKEN || '', maxInputBytes: Number(process.env.RASTER_MAX_INPUT_BYTES || 100 * 1024 * 1024) },
  cartography: { token: process.env.CARTOGRAPHY_WORKER_TOKEN || process.env.RASTER_WORKER_TOKEN || '', maxPages: Number(process.env.ATLAS_MAX_PAGES || '50'), maxOutputBytes: Number(process.env.ATLAS_MAX_OUTPUT_BYTES || 80 * 1024 * 1024), maxRenderPixels: Number(process.env.ATLAS_MAX_RENDER_PIXELS || 24_000_000), maxOverlayBytes: Number(process.env.ATLAS_MAX_OVERLAY_BYTES || 5 * 1024 * 1024) },
};
const state = { redis: { connected: false, error: null }, postgres: { connected: false, error: null }, raster: { enabled: false, error: null, jobsProcessed: 0 }, cartography: { enabled: false, error: null, jobsProcessed: 0 }, startedAt: new Date(), jobsProcessed: 0 };
const log = { info: (...args) => console.log(`[INFO] [${new Date().toISOString()}]`, ...args), error: (...args) => console.error(`[ERROR] [${new Date().toISOString()}]`, ...args), warn: (...args) => console.warn(`[WARN] [${new Date().toISOString()}]`, ...args) };
let redisClient; let pgClient;

function rasterRoot() { if (!config.raster.root || !path.isAbsolute(config.raster.root)) throw new Error('RASTER_WORKER_ROOT deve ser path absoluto'); return path.resolve(config.raster.root); }
function numericId(value, field) { const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw new Error(`${field} inválido`); return id; }
function safeIso(value) { if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) throw new Error('acquisitionAt deve ser ISO-8601 UTC'); return value; }
function safeZoom(value, field) { const zoom = Number(value); if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22) throw new Error(`${field} inválido`); return zoom; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function tiff(bytes) { return bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)); }
function under(root, ...parts) { const filename = path.resolve(root, ...parts); if (!filename.startsWith(`${root}${path.sep}`)) throw new Error('Path raster fora do volume autorizado'); return filename; }
function allowedToken(req, token) { return !token || req.headers['x-arqueo-worker-token'] === token; }
function safeText(value, field, max) { const text = String(value || '').trim(); if (!text || text.length > max) throw new Error(`${field} inválido`); return text; }
function validateBounds(value) { if (!value || typeof value !== 'object') throw new Error('Bounds inválidos'); const parsed = {}; for (const key of ['north', 'south', 'east', 'west']) { if (!Number.isFinite(Number(value[key]))) throw new Error('Bounds inválidos'); parsed[key] = Number(value[key]); } if (!(parsed.west < parsed.east && parsed.south < parsed.north)) throw new Error('Bounds sem extensão positiva'); return parsed; }
function atlasRasterProfile(pageSize, orientation) { const profiles = { A4: [1800, 1200], A3: [2400, 1600], A1: [4200, 2800], A0: [5600, 3800] }; const profile = profiles[pageSize]; if (!profile) throw new Error('Formato Atlas não suportado'); return orientation === 'portrait' ? { width: profile[1], height: profile[0] } : { width: profile[0], height: profile[1] }; }
function validateOverlays(value) { if (!Array.isArray(value)) return []; const encoded = Buffer.byteLength(JSON.stringify(value)); if (encoded > config.cartography.maxOverlayBytes) throw new Error('Overlays vetoriais excedem o limite de bytes'); if (value.length > 20) throw new Error('Quantidade de overlays vetoriais excede o limite'); return value; }
async function atomicWrite(filename, bytes) { await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 }); const tmp = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`); try { await writeFile(tmp, bytes, { mode: 0o600, flag: 'wx' }); await rename(tmp, filename); } finally { await unlink(tmp).catch(() => undefined); } }
async function py(script, args) { const { stdout } = await execFileAsync('/usr/bin/python3', [script, ...args], { timeout: 14 * 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: '/usr/lib/python3/dist-packages' } }); return JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) || '{}'); }

async function ingestRaster(payload) {
  const projectId = numericId(payload.projectId, 'projectId'); const layerId = numericId(payload.layerId, 'layerId');
  const minZoom = safeZoom(payload.minZoom, 'minZoom'); const maxZoom = safeZoom(payload.maxZoom, 'maxZoom'); if (minZoom > maxZoom) throw new Error('Faixa de zoom inválida');
  const acquisitionAt = safeIso(payload.acquisitionAt); const sourceLabel = safeText(payload.sourceLabel, 'sourceLabel', 500);
  if (typeof payload.bytesBase64 !== 'string' || payload.bytesBase64.length > Math.ceil(config.raster.maxInputBytes * 4 / 3) + 8) throw new Error('Payload raster inválido ou excede limite');
  const bytes = Buffer.from(payload.bytesBase64, 'base64'); if (!bytes.length || bytes.length > config.raster.maxInputBytes || !tiff(bytes)) throw new Error('GeoTIFF inválido ou excede limite');
  const root = rasterRoot(); const base = ['projects', String(projectId), 'rasters', String(layerId)];
  const source = under(root, ...base, 'source', 'original.tif'); const cog = under(root, ...base, 'source.cog.tif'); const stac = under(root, ...base, 'source.stac-item.json'); const tiles = under(root, ...base, 'tiles'); const manifest = under(root, ...base, 'tile-manifest.json');
  await atomicWrite(source, bytes);
  const scripts = process.env.RASTER_SCRIPTS_ROOT || '/opt/arqueo/raster'; const nodata = Number.isFinite(Number(payload.nodata)) ? Number(payload.nodata) : 0;
  const processing = await py(path.join(scripts, 'process_to_cog.py'), ['--input', source, '--output', cog, '--asset-id', `project-${projectId}-layer-${layerId}`, '--datetime', acquisitionAt, '--source', sourceLabel, '--target-crs', 'EPSG:4674', '--nodata', String(nodata), '--resampling', ['nearest', 'bilinear', 'cubic', 'lanczos'].includes(payload.resampling) ? payload.resampling : 'cubic', '--manifest', stac]);
  const tileReport = await py(path.join(scripts, 'build_local_raster_assets.py'), ['--input', cog, '--tiles', tiles, '--min-zoom', String(minZoom), '--max-zoom', String(maxZoom), '--expected-crs', 'EPSG:4674', '--require-nodata', '--manifest', manifest]);
  const stacData = JSON.parse(await readFile(stac, 'utf8')); const bbox = stacData.bbox; if (!Array.isArray(bbox) || bbox.length !== 4) throw new Error('Manifesto STAC sem bbox');
  const sourceBytes = await readFile(source); const cogBytes = await readFile(cog);
  state.raster.jobsProcessed++; state.jobsProcessed++;
  return { descriptor: { cogKey: `projects/${projectId}/rasters/${layerId}/source.cog.tif`, tilesKey: `projects/${projectId}/rasters/${layerId}/tiles`, minZoom, maxZoom, expectedCrs: 'EPSG:4674', nodata }, sourceKey: `projects/${projectId}/rasters/${layerId}/source/original.tif`, cogKey: `projects/${projectId}/rasters/${layerId}/source.cog.tif`, stacKey: `projects/${projectId}/rasters/${layerId}/source.stac-item.json`, manifestKey: `projects/${projectId}/rasters/${layerId}/tile-manifest.json`, bounds: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }, crs: 'EPSG:4674', sourceSha256: sha256(sourceBytes), cogSha256: sha256(cogBytes), sourceBytes: sourceBytes.length, cogBytes: cogBytes.length, processing: { ...processing, tileReport, stacProperties: stacData.properties || {} } };
}

async function renderAtlas(payload) {
  const atlasId = numericId(payload.atlasId, 'atlasId'); const projectId = numericId(payload.projectId, 'projectId'); const layerId = numericId(payload.rasterLayerId, 'rasterLayerId');
  const pages = Array.isArray(payload.pages) ? payload.pages.map((page) => ({ bounds: validateBounds(page?.bounds) })) : [];
  if (!pages.length || pages.length > config.cartography.maxPages) throw new Error('Quantidade de páginas inválida');
  const title = safeText(payload.title, 'title', 255); const pageSize = ['A4', 'A3', 'A1', 'A0'].includes(payload.pageSize) ? payload.pageSize : 'A4'; const orientation = ['portrait', 'landscape'].includes(payload.orientation) ? payload.orientation : 'landscape';
  const scale = Number(payload.scale); if (!Number.isInteger(scale) || scale < 500 || scale > 100000) throw new Error('Escala inválida'); const crs = safeText(payload.crs || 'EPSG:4674', 'crs', 50);
  const profile = atlasRasterProfile(pageSize, orientation); if (profile.width * profile.height > config.cartography.maxRenderPixels) throw new Error(`Perfil ${pageSize} excede o orçamento de pixels configurado`); const overlays = validateOverlays(payload.overlays);
  const root = rasterRoot(); const cog = under(root, 'projects', String(projectId), 'rasters', String(layerId), 'source.cog.tif');
  if (!(await stat(cog)).isFile()) throw new Error('COG autorizado não encontrado para a camada raster');
  const outputDir = under(root, 'atlases', String(atlasId)); await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const pagesJson = under(root, 'atlases', String(atlasId), 'pages.json'); const overlaysJson = under(root, 'atlases', String(atlasId), 'overlays.json'); const output = under(root, 'atlases', String(atlasId), 'atlas.pdf');
  await atomicWrite(pagesJson, Buffer.from(JSON.stringify(pages)));
  await atomicWrite(overlaysJson, Buffer.from(JSON.stringify(overlays)));
  const scripts = process.env.RASTER_SCRIPTS_ROOT || '/opt/arqueo/raster';
  const report = await py(path.join(scripts, 'render_atlas_pages.py'), ['--input', cog, '--output', output, '--pages-json', pagesJson, '--overlays-json', overlaysJson, '--page-size', pageSize, '--orientation', orientation, '--title', title, '--crs', crs, '--scale', String(scale), '--raster-width', String(profile.width), '--raster-height', String(profile.height), '--show-north', payload.showNorthArrow === false ? '0' : '1', '--show-frame', payload.showFrame === false ? '0' : '1', '--show-legend', payload.showLegend === false ? '0' : '1', '--show-scale', payload.showScaleBar === false ? '0' : '1']);
  const bytes = await readFile(output); if (!bytes.length || bytes.length > config.cartography.maxOutputBytes) throw new Error('PDF do Atlas excede o limite de saída');
  const source = await readFile(cog); state.cartography.jobsProcessed++; state.jobsProcessed++;
  return { outputKey: `atlases/${atlasId}/atlas.pdf`, outputSha256: sha256(bytes), outputBytes: bytes.length, sourceCogSha256: sha256(source), pageProfile: profile, overlays: overlays.length, pages: report.pages || [], pdfBase64: bytes.toString('base64') };
}

async function readJson(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > Math.max(Math.ceil(config.raster.maxInputBytes * 4 / 3) + 256 * 1024, config.cartography.maxOutputBytes)) throw new Error('Corpo excede limite'); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('JSON inválido'); } }
async function connectRedis() { try { redisClient = createClient({ socket: { host: config.redis.host, port: config.redis.port, connectTimeout: 3000, reconnectStrategy: false } }); redisClient.on('error', (err) => { state.redis.error = err.message; state.redis.connected = false; }); await redisClient.connect(); await redisClient.ping(); state.redis.connected = true; state.redis.error = null; } catch (error) { state.redis.error = error.message; state.redis.connected = false; log.warn('Redis indisponível:', error.message); } }
async function connectPostgres() { try { pgClient = new Client({ ...config.postgres, connectionTimeoutMillis: 3000 }); pgClient.on('error', (err) => { state.postgres.error = err.message; state.postgres.connected = false; }); await pgClient.connect(); await pgClient.query('SELECT version(), postgis_version()'); state.postgres.connected = true; state.postgres.error = null; } catch (error) { state.postgres.error = error.message; state.postgres.connected = false; log.warn('PostGIS indisponível:', error.message); } }
function send(res, status, value) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://worker.local').pathname;
  if (pathname === '/health' && req.method === 'GET') { const dependenciesReady = state.redis.connected && state.postgres.connected; return send(res, state.raster.enabled && state.cartography.enabled ? 200 : 503, { status: state.raster.enabled && state.cartography.enabled ? (dependenciesReady ? 'healthy' : 'degraded') : 'unhealthy', uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000), connections: state, raster: state.raster, cartography: state.cartography, timestamp: new Date().toISOString() }); }
  if (pathname === '/ingest' && req.method === 'POST') { try { if (!state.raster.enabled) return send(res, 503, { error: state.raster.error || 'Ingestão raster não configurada' }); if (!allowedToken(req, config.raster.token)) return send(res, 401, { error: 'Token do worker inválido' }); return send(res, 200, await ingestRaster(await readJson(req))); } catch (error) { log.warn('Ingestão raster recusada:', error.message); return send(res, 400, { error: error.message || 'Falha na ingestão raster' }); } }
  if (pathname === '/render-atlas' && req.method === 'POST') { try { if (!state.cartography.enabled) return send(res, 503, { error: state.cartography.error || 'Renderização cartográfica não configurada' }); if (!allowedToken(req, config.cartography.token)) return send(res, 401, { error: 'Token do worker inválido' }); return send(res, 200, await renderAtlas(await readJson(req))); } catch (error) { log.warn('Renderização de Atlas recusada:', error.message); return send(res, 400, { error: error.message || 'Falha na renderização cartográfica' }); } }
  send(res, 404, { error: 'Not Found' });
});
async function start() { try { rasterRoot(); state.raster.enabled = true; state.cartography.enabled = true; } catch (error) { state.raster.error = error.message; state.cartography.error = error.message; log.warn('Worker raster/cartográfico desabilitado:', error.message); } server.listen(3001, () => log.info('Worker GIS pronto na porta 3001; raster:', state.raster.enabled ? 'habilitado' : 'desabilitado', '; cartografia:', state.cartography.enabled ? 'habilitada' : 'desabilitada')); void connectRedis(); void connectPostgres(); }
process.on('SIGTERM', async () => { server.close(); if (redisClient) await redisClient.quit(); if (pgClient) await pgClient.end(); process.exit(0); });
start().catch((error) => { log.error('Falha ao iniciar worker:', error); process.exit(1); });
