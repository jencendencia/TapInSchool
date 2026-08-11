#!/usr/bin/env node
/**
 * Guardian registry repair (idempotent).
 *
 * Problem being fixed: the registry only contained guardians whose student
 * already had a stored QR payload, so guardians like "Maria Dela Cruz" (on
 * Juan) never got registered. The fix is match-first: for every student with a
 * guardian identity:
 *   1. If a guardian row with the same name + address already exists, LINK to
 *      it and copy ITS stored QR payload onto the student (never generate a
 *      second row — shared guardians stay shared, printed QRs stay valid).
 *   2. Otherwise generate the payload (current app secret), register the
 *      guardian, and link.
 *
 * Also removes rows this script's earlier (flawed) version created by
 * generating fresh payloads for identities that already existed.
 *
 *   node scripts/repair-guardians.mjs
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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

// ---- Exact mirror of electron/services/qr.ts (checkCode + generateGuardianPayload)
const CHECK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function checkCode(input, len = 6) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  let out = '';
  for (let i = 0; i < len; i++) {
    let h = hash;
    for (let k = 0; k < i; k++) h = Math.floor(h / CHECK_ALPHABET.length);
    out += CHECK_ALPHABET[h % CHECK_ALPHABET.length];
  }
  return out;
}
const secret = process.env.QR_SECRET || 'tapin-school-default-secret';
const guardianPayload = (name, address) =>
  `GP-${new Date().getFullYear()}-${checkCode(`${String(name).trim()}::${String(address).trim()}::${secret}`)}`;

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'tapin_school',
};

const conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database });

try {
  // 0) Housekeeping: remove rows created by the flawed earlier version — a
  // guardian row whose payload was generated with the CURRENT secret while an
  // identical (name + address) row already exists is a duplicate. Unlink its
  // students first (their payloads get corrected by the match-first pass).
  const [dupes] = await conn.query(
    `SELECT g.id, g.full_name, g.address, g.qr_hash_payload
     FROM guardians g
     JOIN guardians e ON e.full_name = g.full_name AND e.address = g.address AND e.id <> g.id
     ORDER BY g.id`,
  );
  for (const dup of dupes) {
    await conn.query('UPDATE students SET guardian_id = NULL, guardian_qr_hash_payload = NULL WHERE guardian_id = ?', [dup.id]);
    await conn.query('DELETE FROM guardians WHERE id = ?', [dup.id]);
    console.log(`Removed duplicate guardian row #${dup.id} (${dup.full_name} — same identity as another row)`);
  }

  // Also unlink any student whose guardian_id points nowhere (safety).
  await conn.query(
    `UPDATE students s LEFT JOIN guardians g ON g.id = s.guardian_id
     SET s.guardian_id = NULL WHERE s.guardian_id IS NOT NULL AND g.id IS NULL`,
  );

  // 1) Match-first: students whose identity ALREADY has a guardian row link to
  // it and adopt its stored payload (shared guardian, printed QR preserved).
  const [matched] = await conn.query(
    `UPDATE students s
     JOIN guardians g ON g.full_name = s.guardian_name AND g.address = s.guardian_address
     SET s.guardian_id = g.id,
         s.guardian_qr_hash_payload = g.qr_hash_payload,
         s.parent_phone = CASE WHEN s.parent_phone = '' THEN g.mobile ELSE s.parent_phone END
     WHERE s.guardian_name <> '' AND s.guardian_id IS NULL`,
  );
  console.log(`Students linked to EXISTING guardians by identity: ${matched.affectedRows}`);

  // 2) Remaining students with a guardian identity but no registry row →
  // generate the payload (current app secret), register, and link.
  const [unmatched] = await conn.query(
    `SELECT s.id, s.guardian_name, s.guardian_address, s.parent_phone
     FROM students s
     WHERE s.guardian_name <> '' AND s.guardian_id IS NULL
     ORDER BY s.id`,
  );
  console.log(`Students needing a NEW guardian row: ${unmatched.length}`);
  for (const row of unmatched) {
    const payload = guardianPayload(row.guardian_name, row.guardian_address);
    const [existing] = await conn.query('SELECT id FROM guardians WHERE qr_hash_payload = ?', [payload]);
    let gid = existing[0]?.id;
    if (!gid) {
      const [res] = await conn.query(
        'INSERT INTO guardians (full_name, mobile, address, qr_hash_payload) VALUES (?, ?, ?, ?)',
        [row.guardian_name, row.parent_phone || '', row.guardian_address, payload],
      );
      gid = res.insertId;
      console.log(`  + registered ${row.guardian_name} (guardian #${gid})`);
    }
    await conn.query(
      'UPDATE students SET guardian_id = ?, guardian_qr_hash_payload = ? WHERE id = ?',
      [gid, payload, row.id],
    );
  }

  const [g] = await conn.query('SELECT id, full_name, mobile, address, qr_hash_payload FROM guardians ORDER BY full_name');
  console.log('\n=== guardians now (' + g.length + ') ===');
  g.forEach((r) => console.log(r.id, '|', r.full_name, '|', r.mobile, '|', r.address, '|', r.qr_hash_payload));

  const [s] = await conn.query(
    `SELECT full_name, guardian_name, guardian_address, guardian_qr_hash_payload, guardian_id
     FROM students WHERE guardian_name <> '' ORDER BY full_name`,
  );
  console.log('\n=== students with guardian (' + s.length + ') ===');
  s.forEach((r) =>
    console.log(r.full_name, '->', r.guardian_name, '|', r.guardian_address, '| payload=' + (r.guardian_qr_hash_payload ?? 'NULL'), '| gid=' + (r.guardian_id ?? 'NULL')),
  );
} finally {
  await conn.end();
}
