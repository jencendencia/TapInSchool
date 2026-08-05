// Seeds license keys into the deployed license server.
// Usage: node seed.js <admin-secret> <server-url> [count]
//   node seed.js YOUR_ADMIN_SECRET https://tapin-license-server.xxxx.workers.dev 3
// The server-up after the admin secret is the Worker's public URL.
const ADMIN_SECRET = process.argv[2];
const SERVER_URL = process.argv[3];
const COUNT = Number(process.argv[4] || 3);

if (!ADMIN_SECRET || !SERVER_URL) {
  console.log('Usage: node seed.js <admin-secret> <server-url> [count]');
  process.exit(1);
}

async function run() {
  for (let i = 0; i < COUNT; i++) {
    const res = await fetch(`${SERVER_URL}/admin/add-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminSecret: ADMIN_SECRET, maxActivations: 1 }),
    });
    const data = await res.json();
    console.log(data.success ? '✓ License key: ' + data.key : '✗ Error: ' + data.message);
  }
}
run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
