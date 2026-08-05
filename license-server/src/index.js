// TapIn School license validation server (Cloudflare Worker).
// Validates license keys and tracks which machines have activated each key.
// Endpoints:
//   POST /validate         { key, machineId } → { valid, message, machineId }
//   POST /admin/add-key    { adminSecret, key?, maxActivations?, expiresAt? }
//   GET  /admin/list-keys  Header: X-Admin-Secret
//   POST /admin/revoke     { adminSecret, key }
// The ADMIN_SECRET is read from the Worker secret ADMIN_SECRET (set via
// `wrangler secret put ADMIN_SECRET`), never committed to source.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const ADMIN_SECRET = env.ADMIN_SECRET || '';

    if (request.method === 'OPTIONS') return cors(preflight());
    if (pathname === '/validate' && request.method === 'POST') return handleValidate(request, env);
    if (pathname === '/admin/add-key' && request.method === 'POST') return handleAddKey(request, env, ADMIN_SECRET);
    if (pathname === '/admin/list-keys' && request.method === 'GET') return handleListKeys(request, env, ADMIN_SECRET);
    if (pathname === '/admin/revoke' && request.method === 'POST') return handleRevoke(request, env, ADMIN_SECRET);

    return cors(new Response('Not found', { status: 404 }));
  },
};

async function handleValidate(request, env) {
  const { key, machineId } = await request.json();
  if (!key || !machineId) {
    return cors(json({ valid: false, message: 'License key and machine ID required.' }));
  }

  const licenseStr = await env.LICENSE_KV.get(`license:${key}`);
  if (!licenseStr) return cors(json({ valid: false, message: 'Invalid license key.' }));

  const license = JSON.parse(licenseStr);
  if (license.revoked) return cors(json({ valid: false, message: 'This license key has been revoked.' }));
  if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
    return cors(json({ valid: false, message: 'This license key has expired.' }));
  }

  // Machine already registered? Activate without consuming a new slot.
  const isRegistered = (license.activations || []).includes(machineId);
  if (!isRegistered && (license.activations || []).length >= (license.maxActivations || 1)) {
    return cors(json({ valid: false, message: `License already activated on ${license.activations.length} device(s).` }));
  }

  // Register the machine.
  if (!isRegistered) {
    license.activations = license.activations || [];
    license.activations.push(machineId);
    await env.LICENSE_KV.put(`license:${key}`, JSON.stringify(license));
  }

  return cors(json({ valid: true, message: 'License activated successfully.', machineId }));
}

async function handleAddKey(request, env, ADMIN_SECRET) {
  const { key, adminSecret, maxActivations, expiresAt } = await request.json();
  if (adminSecret !== ADMIN_SECRET) return cors(json({ success: false, message: 'Unauthorized.' }));

  const finalKey = key || generateKey();
  const existing = await env.LICENSE_KV.get(`license:${finalKey}`);
  if (existing) return cors(json({ success: false, message: 'Key already exists.' }));

  const license = {
    key: finalKey,
    maxActivations: maxActivations || 1,
    activations: [],
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt || null,
    revoked: false,
  };
  await env.LICENSE_KV.put(`license:${finalKey}`, JSON.stringify(license));
  return cors(json({ success: true, key: finalKey }));
}

async function handleListKeys(request, env, ADMIN_SECRET) {
  const adminSecret = request.headers.get('X-Admin-Secret');
  if (adminSecret !== ADMIN_SECRET) return cors(json({ success: false, message: 'Unauthorized.' }));

  const keys = [];
  let cursor;
  do {
    const result = await env.LICENSE_KV.list({ prefix: 'license:', cursor });
    for (const k of result.keys) {
      keys.push(JSON.parse(await env.LICENSE_KV.get(k.name)));
    }
    cursor = result.cursor;
  } while (cursor);
  return cors(json({ success: true, keys }));
}

async function handleRevoke(request, env, ADMIN_SECRET) {
  const { key, adminSecret } = await request.json();
  if (adminSecret !== ADMIN_SECRET) return cors(json({ success: false, message: 'Unauthorized.' }));

  const licenseStr = await env.LICENSE_KV.get(`license:${key}`);
  if (!licenseStr) return cors(json({ success: false, message: 'Key not found.' }));

  const license = JSON.parse(licenseStr);
  license.revoked = true;
  await env.LICENSE_KV.put(`license:${key}`, JSON.stringify(license));
  return cors(json({ success: true, message: 'Key revoked.' }));
}

// Generates a key like TAPIN-XXXX-XXXX-XXXX (the app uppercases + trims keys).
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const parts = [];
  for (let i = 0; i < 4; i++) {
    let part = '';
    for (let j = 0; j < 4; j++) part += chars[Math.floor(Math.random() * chars.length)];
    parts.push(part);
  }
  return 'TAPIN-' + parts.join('-');
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}
function preflight() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
    },
  });
}
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret');
  return res;
}
