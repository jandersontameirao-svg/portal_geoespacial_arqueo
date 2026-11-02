#!/usr/bin/env node
// Dois ensaios complementares em schemas sintéticos novos, no TiDB local existente.
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'docs/consolidation/evidence/tidb-8.5.3-local-enum-journal');
mkdirSync(dir, { recursive: true });
const conn = await mysql.createConnection({ host: '127.0.0.1', port: 34000, user: 'root', connectTimeout: 5000 });
const schemas = ['geoportal_tidb_enum_probe', 'geoportal_tidb_drizzle_synthetic'];
const report = { scope: 'local-synthetic-only', version: '', enumPreservation: 'not-run', drizzleMigration: 'not-run', productionTouched: false, homologationTouched: false, storageRemoteTouched: false };
try {
  const [[v]] = await conn.query('SELECT VERSION() AS version');
  report.version = v.version;
  assert.equal(v.version, '8.0.11-TiDB-v8.5.3');
  for (const name of schemas) {
    const [found] = await conn.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [name]);
    assert.equal(found.length, 0, `Refusing existing schema ${name}`);
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }
  await conn.query(`USE \`${schemas[0]}\``);
  const baseline = ['kml', 'kmz', 'shp', 'pdf', 'docx', 'xlsx', 'image', 'other'];
  await conn.query(`CREATE TABLE files (id INT PRIMARY KEY, fileType ENUM('kml','kmz','shp','pdf','docx','xlsx','image','other') NOT NULL)`);
  for (let i = 0; i < baseline.length; i++) await conn.query('INSERT INTO files VALUES (?, ?)', [i + 1, baseline[i]]);
  const [before] = await conn.query('SELECT id,fileType,fileType+0 AS ordinal FROM files ORDER BY id');
  await conn.query(readFileSync('drizzle/0008_early_pyro.sql', 'utf8'));
  await conn.query("INSERT INTO files VALUES (9,'geotiff')");
  const [after0008] = await conn.query('SELECT id,fileType,fileType+0 AS ordinal FROM files ORDER BY id');
  await conn.query(readFileSync('drizzle/0009_quiet_runaways.sql', 'utf8'));
  await conn.query("INSERT INTO files VALUES (10,'geojson')");
  const [after0009] = await conn.query('SELECT id,fileType,fileType+0 AS ordinal FROM files ORDER BY id');
  assert.deepEqual(after0008.slice(0, 8).map(r => r.fileType), baseline);
  assert.deepEqual(after0009.slice(0, 8).map(r => r.fileType), baseline);
  assert.equal(after0009.find(r => r.id === 9).fileType, 'geotiff');
  assert.equal(after0009.find(r => r.id === 10).fileType, 'geojson');
  report.enumPreservation = 'passed';
  report.originalRowsPreserved = 8;
  report.newTypesPersisted = ['geotiff', 'geojson'];
  report.ordinalValuesChanged = before.some((r, i) => r.ordinal !== after0009[i].ordinal);
  writeFileSync(path.join(dir, 'enum-before-after.json'), JSON.stringify({ before, after0008, after0009 }, null, 2) + '\n');
  console.log('POPULATED_ENUM_PRESERVATION=PASS (8 original labels + 2 new types; ordinals changed)');

  const env = { ...process.env, DATABASE_URL: `mysql://root@127.0.0.1:34000/${schemas[1]}` };
  try {
    const result = execFileSync('pnpm', ['drizzle-kit', 'migrate'], { env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    writeFileSync(path.join(dir, 'drizzle-migrate.log'), result.trimEnd() + '\n');
    const [journal] = await conn.query(`SELECT hash,created_at FROM \`${schemas[1]}\`.__drizzle_migrations ORDER BY id`);
    const files = readdirSync('drizzle').filter(f => /^00(0[0-9]|1[0-3])_.*\.sql$/.test(f)).sort();
    const localHashes = files.map(f => createHash('sha256').update(readFileSync(path.join('drizzle', f))).digest('hex'));
    assert.equal(journal.length, 14);
    assert.deepEqual(journal.map(r => r.hash), localHashes);
    report.drizzleMigration = 'passed';
    report.journalEntries = journal.length;
    report.journalMatchesExactSqlHashes = true;
    writeFileSync(path.join(dir, 'journal.json'), JSON.stringify(journal, null, 2) + '\n');
    console.log('DRIZZLE_JOURNAL=PASS (14 entries, exact hashes match)');
  } catch (e) {
    report.drizzleMigration = 'failed';
    report.error = e.message;
    writeFileSync(path.join(dir, 'drizzle-migrate.log'), String(e.stdout ?? '') + String(e.stderr ?? ''));
  }
} finally {
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await conn.end();
}
