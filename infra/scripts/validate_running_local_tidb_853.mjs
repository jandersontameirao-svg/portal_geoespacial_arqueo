#!/usr/bin/env node
// Ensaio de SQL literal contra instância descartável TiDB do próprio sandbox.
// Sem uso de DATABASE_URL ou credenciais herdadas. Sem acesso remoto.
import mysql from 'mysql2/promise';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const port = 34000;
const database = 'geoportal_tidb_synthetic';
const reportDir = path.resolve(process.argv[2] ?? 'docs/consolidation/evidence/tidb-8.5.3-local-literal');
mkdirSync(reportDir, { recursive: true });
const conn = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', connectTimeout: 5000 });
const report = {
  scope: 'local-disposable-literal-sql-only', host: '127.0.0.1', port, database,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  executedUncommittedMigrationChanges: false,
  productionTouched: false, homologationTouched: false, storageRemoteTouched: false,
  migrationResults: [], allMigrationsPassed: false, testStatus: 'not-run',
};
try {
  const [[v]] = await conn.query('SELECT VERSION() AS version, @@version_comment AS edition');
  if (!v.version.endsWith('TiDB-v8.5.3')) throw new Error('Refusing non-TiDB-8.5.3 runtime');
  report.version = v.version;
  report.edition = v.edition;
  const [existing] = await conn.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
  if (existing.length) throw new Error('Synthetic schema already exists; refusing overwrite');
  await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${database}\``);
  const sqlFiles = readdirSync('drizzle').filter(f => /^00(0[0-9]|1[0-3])_.*\.sql$/.test(f)).sort();
  if (sqlFiles.length !== 14) throw new Error('Expected exactly 14 migrations 0000–0013');
  for (const file of sqlFiles) {
    const bytes = readFileSync(path.join('drizzle', file));
    const result = { file, sha256: createHash('sha256').update(bytes).digest('hex'), status: 'pending', statementsPassed: 0 };
    report.migrationResults.push(result);
    try {
      for (const statement of bytes.toString('utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) {
        await conn.query(statement);
        result.statementsPassed++;
      }
      result.status = 'passed';
      console.log(`MIGRATION ${file}: PASS (${result.statementsPassed} statements)`);
    } catch (e) {
      result.status = 'failed';
      result.error = { code: e.code ?? null, errno: e.errno ?? null, sqlState: e.sqlState ?? null, message: e.sqlMessage ?? e.message };
      console.log(`MIGRATION ${file}: FAIL ${result.error.errno} ${result.error.message}`);
      break;
    }
    writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  report.allMigrationsPassed = report.migrationResults.length === 14 && report.migrationResults.every(r => r.status === 'passed');
  const [cols] = await conn.query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (\'files\',\'ogc_services\') ORDER BY TABLE_NAME,ORDINAL_POSITION', [database]);
  writeFileSync(path.join(reportDir, 'relevant-schema.json'), JSON.stringify(cols, null, 2) + '\n');
  if (report.allMigrationsPassed) {
    const env = { ...process.env,
      DATABASE_URL: `mysql://root@127.0.0.1:${port}/${database}`,
      JWT_SECRET: 'synthetic-only-jwt-secret-32-chars-minimum-0001',
      MANUS_JWT_SECRET: 'synthetic-only-managed-session-secret-0001',
      VITE_APP_ID: 'synthetic-app-id', OAUTH_SERVER_URL: 'https://oauth.invalid',
      VITE_OAUTH_PORTAL_URL: 'https://oauth.invalid', OWNER_OPEN_ID: 'synthetic-admin', OWNER_NAME: 'Synthetic Administrator',
      BUILT_IN_FORGE_API_KEY: 'synthetic-for-tests-only', BUILT_IN_FORGE_API_URL: 'https://forge.invalid',
      VITE_FRONTEND_FORGE_API_KEY: 'synthetic-for-tests-only', VITE_FRONTEND_FORGE_API_URL: 'https://forge.invalid', OGC_ALLOWED_HOSTS: 'ogc.invalid',
    };
    const seed = readFileSync('infra/synthetic/seed_minimal.sql', 'utf8');
    for (const s of seed.split(';').map(s => s.trim()).filter(Boolean)) await conn.query(s);
    try {
      const output = execFileSync('pnpm', ['vitest', 'run'], { env, encoding: 'utf8', timeout: 180000, maxBuffer: 8*1024*1024 });
      writeFileSync(path.join(reportDir, 'vitest.log'), output.trimEnd() + '\n');
      report.testStatus = 'passed';
    } catch (e) {
      writeFileSync(path.join(reportDir, 'vitest.log'), String(e.stdout ?? '') + String(e.stderr ?? ''));
      report.testStatus = 'failed';
    }
  }
} finally {
  writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await conn.end();
}
console.log(`REPORT_DIR=${reportDir}`);
