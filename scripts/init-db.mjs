#!/usr/bin/env node
/**
 * One-time MySQL bootstrap for TapIn School.
 *
 *   node scripts/init-db.mjs            # create database + tables
 *   node scripts/init-db.mjs --seed     # also insert demo students
 *
 * Reads DB_* values from a .env file next to it (or from the environment).
 * Uses only the mysql2 package already installed as a dependency.
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// --- tiny .env loader -------------------------------------------------------
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
  }
}
loadDotEnv(path.join(root, '.env'));

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'tapin_school',
};

const schema = fs.readFileSync(path.join(root, 'electron', 'db', 'schema.ts'), 'utf8');
// Extract the SCHEMA_SQL template literal body (rough but reliable for our file).
const m = schema.match(/export const SCHEMA_SQL = `([\s\S]*?)`;/);
if (!m) {
  console.error('Could not locate SCHEMA_SQL in electron/db/schema.ts');
  process.exit(1);
}
const statements = m[1]
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  console.log(`Connecting to MySQL at ${cfg.host}:${cfg.port} as ${cfg.user}...`);
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    multipleStatements: true,
  });

  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conn.query(`USE \`${cfg.database}\``);
  console.log(`Database "${cfg.database}" ready.`);

  for (const stmt of statements) {
    await conn.query(stmt);
  }
  console.log('Schema applied (students, attendance_logs, sms_logs, settings).');

  if (process.argv.includes('--seed')) {
    let generatePayload;
    try {
      const mod = await import(
        path.join(root, 'dist-electron', 'electron', 'services', 'qr.js').replace(/\\/g, '/')
      );
      generatePayload = mod?.generatePayload;
    } catch {
      generatePayload = null;
    }
    const secret = process.env.QR_SECRET || 'tapin-school-default-secret';

    // The payload generator is compiled TS; fall back to an inline copy so the
    // seed script works even before `npm run build:electron`.
    const gen =
      generatePayload ??
      ((studentNo) => {
        let hash = 0;
        const input = `${studentNo}::${secret}`;
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
        const a = alphabet[hash % alphabet.length];
        const b = alphabet[Math.floor(hash / alphabet.length) % alphabet.length];
        const c = alphabet[Math.floor(hash / alphabet.length / alphabet.length) % alphabet.length];
        return `CP-${new Date().getFullYear()}-${studentNo}${a}${b}${c}`;
      });

    const demo = [
      ['2024-0112', 'Juan Dela Cruz', 'Grade 7 - Section A', '09171234567'],
      ['2024-0113', 'Maria Santos', 'Grade 7 - Section A', '09182345678'],
      ['2024-0215', 'Carlos Garcia', 'Grade 8 - Section B', '09193456789'],
      ['2024-0318', 'Ana Reyes', 'Grade 9 - Section C', '09184567890'],
      ['2024-0421', 'Miguel Torres', 'Grade 10 - Section D', '09195678901'],
      ['2024-0524', 'Liza Fernandez', 'Grade 11 - STEM', '09196789012'],
    ];
    let added = 0;
    for (const [studentNo, fullName, gradeSection, phone] of demo) {
      const payload = gen(studentNo);
      await conn.query(
        `INSERT IGNORE INTO students (student_no, qr_hash_payload, full_name, grade_section, parent_phone)
         VALUES (?, ?, ?, ?, ?)`,
        [studentNo, payload, fullName, gradeSection, phone],
      );
      added++;
      console.log(`  + ${fullName}  QR payload: ${payload}`);
    }
    console.log(`Seeded ${added} demo students.`);
  }

  await conn.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error('\nInit failed:', err.message);
  console.error('\nTroubleshooting:');
  console.error('  1. Is MySQL running? (docker compose up -d, or start the MySQL service)');
  console.error('  2. Are DB_USER / DB_PASSWORD correct in .env? (copy .env.example → .env)');
  process.exit(1);
});
