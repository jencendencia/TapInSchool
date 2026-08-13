# Network Database Connection Process — PTA CD

This document explains how **PTA CD** connects to its MySQL database over the
network. The app does **not** need MySQL installed locally — it connects to the
**shared `tapin_school` database** that TapIn School also uses, so every PTA
computer sees the same data.

> Related docs: `APP_UPDATE_AND_ACTIVATION_PROCESS.md` (updates & licensing),
> `GITHUB_RELEASE_UPLOAD_GUIDE.md` (releases). The full design is in `PLAN.md`.

---

## 1. How the connection is resolved

The app figures out which server to talk to by layering three sources. The
**first that has a value wins**:

| Priority | Source | Where it lives | Example |
|----------|--------|----------------|---------|
| 1 | Saved connection (set from the title bar) | `userData/db-config.json` (per machine) | `192.168.1.129 / 3306 / pta / …` |
| 2 | OS environment variables | Real env vars | `DB_HOST=192.168.1.129` |
| 2 | `.env` file | `.env` next to `package.json` (gitignored) | `DB_HOST=192.168.1.129` |
| 3 | Built-in defaults | `electron/db/connection.ts` | `127.0.0.1 / 3306 / root / tapin_school` |

Notes:

- The `.env` loader (`electron/db/env.ts`) runs automatically on startup — no
  extra tooling. It never overrides a real OS environment variable.
- A connection saved from the **title-bar dialog** (see §4) overrides both
  `.env` and OS env on later launches — this is how a machine remembers its
  server without touching files.
- Settings stored in `userData/db-config.json` are per machine and are never
  committed to the repo.

### Config reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_HOST` | `127.0.0.1` | Server IP / hostname (LAN IP of the MySQL machine) |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `root` | Database account (use a dedicated `pta` user on the network) |
| `DB_PASSWORD` | *(empty)* | Account password |
| `DB_NAME` | `tapin_school` | The shared database name — do **not** change unless TapIn uses another name |
| `DB_POOL` | `3` | Per-client connection pool size (1–50). Kiosks rarely need more than 3; raise it on a busy admin PC. Each machine's pool counts against the server's `max_connections`, so keep the sum well under it |

---

## 2. Connection lifecycle at app startup

1. `electron/main.ts` calls `configureDbFromDisk()` — if `userData/db-config.json`
   exists, it is applied **before** any connection attempt (so a reconnect
   survives app restarts).
2. `db.start()` creates a small MySQL pool (**3 connections by default** — see
   `DB_POOL` above; 4s connect timeout, keep-alive on, 60s idle timeout) and
   tries to connect.
3. **Offline-first retry:** if the server is unreachable, the app does **not**
   crash — it retries every **5 seconds** and shows an amber `offline` pill in
   the title bar. As soon as the server appears, it connects automatically.
4. Once online (the app waits up to **30 seconds** at boot), `bootPta()` runs:
   - `ensureSchema()` — creates/repairs all `pta_*` tables (idempotent)
   - loads settings, seeds the default `admin / admin` officer account
   - syncs families from the students table and recomputes charges
5. The title bar's database indicator (`TitleBar.tsx`) subscribes to live
   `db:status` events, so the `online` / `offline` state is always in sync.

> If the database is unreachable, PTA features are disabled until a connection
> is made — the app logs the failure and keeps retrying.

---

## 3. Connection states (title bar pill)

The pill on the right side of the title bar shows the live status:

| Pill | Meaning |
|------|---------|
| Green dot · `host:port · database` | Connected and ready |
| Amber dot · `host:port · offline` | Server unreachable — retrying every 5s |
| Grey dot · `database …` | Still resolving the config / first attempt |

Click the pill any time to open the **Connect to database** dialog.

---

## 4. Changing the server from the UI (recommended)

No file editing needed on client machines — point the app at the server from
the title bar:

1. Click the database pill in the **title bar**.
2. In the **Connect to database** dialog enter:
   - **Host** — the MySQL machine's LAN IP (e.g. `192.168.1.129`) or hostname
   - **Port** — `3306` (default)
   - **User / Password** — the network database account (see §5)
   - **Database** — `tapin_school`
3. Click **Connect**. The app tests the connection immediately:
   - **Success** → the config is saved to `userData/db-config.json`, the
     bootstrap re-runs (schema → families → charges), and the window reloads.
     The session is restored automatically.
   - **Failure** → the dialog shows the real MySQL error (e.g. access denied,
     timeout) and stays open so you can fix and retry.

---

## 5. One-time server setup (the machine running MySQL)

Do this once on the computer that hosts the `tapin_school` database.

1. **Make MySQL listen on the network** — set `bind-address = *` (or the LAN
   IP) in `my.ini` / `my.cnf` and restart MySQL. MySQL 8 Windows installs
   typically listen on all interfaces by default.
2. **Allow the port through the firewall** — open **inbound TCP 3306** for the
   LAN network profile (Windows Firewall → Advanced settings → Inbound rules).
3. **Create a dedicated database user** (never expose `root` over the network;
   `root@localhost` stays local-only):
   ```sql
   CREATE USER 'pta'@'%' IDENTIFIED BY 'a-strong-password';
   GRANT ALL PRIVILEGES ON tapin_school.* TO 'pta'@'%';
   FLUSH PRIVILEGES;
   ```
   The `ALL` grant includes `CREATE`, which the app needs to self-create its
   `pta_*` tables on first connect.
4. **Note the server's LAN IP** — run `ipconfig`, copy the **IPv4 Address**
   (e.g. `192.168.1.129`). This is the `DB_HOST` every client will use.

> Test from another computer first: `mysql -h 192.168.1.129 -u pta -p tapin_school`
> (if the MySQL client is installed) or just launch the app and watch the pill
> turn green.

### Sizing & monitoring (multi-machine capacity)

Each client opens a pool of **3** connections by default, so the total slots
needed is roughly `machines × 3` (plus admin tools / backups). MySQL's default
`max_connections` is **151**; when many machines share one server, raise it in
`my.ini` to leave headroom:

```ini
max_connections = 200        # e.g. 20 machines × 3 pool + admin/backup headroom
innodb_buffer_pool_size = 1G # ≈ 70–80% of server RAM; tiny datasets fit entirely in cache
thread_cache_size = 32       # reuse worker threads for fast client churn
```

Keep an eye on actual usage — `SHOW STATUS LIKE 'Threads_connected'` (or
`performance_schema` in MySQL 8) shows how many of the budget the app is
consuming; the per-client `DB_POOL` cap exists so a busy machine can't hog the
server. `skip_name_resolve = 1` also speeds up every new connection on a LAN
(grants must then use IPs, not hostnames).

---

## 6. Client setup (every computer running PTA CD)

Each machine connects to the same server — no local MySQL required.

**Option A — via the title bar (no files):**

Install/run the app, click the database pill, enter Host / Port / User /
Password / Database from §5 and connect. The setting is remembered.

**Option B — via `.env` (developers / scripted setups):**

Create a `.env` next to `package.json` (a template lives in `.env.example`):

```env
DB_HOST=192.168.1.129
DB_PORT=3306
DB_USER=pta
DB_PASSWORD=a-strong-password
DB_NAME=tapin_school
DB_POOL=3
```

Then `npm run dev` (or the installed app). First connect self-creates the
`pta_*` tables and seeds the default `admin / admin` account.

---

## 7. CLI bootstrap (optional)

To create/repair the PTA schema from a terminal (e.g. before first deploy):

```bash
npm run db:init      # node scripts/init-db.mjs
```

It reads the same `DB_*` env / `.env` values, connects, runs the idempotent
`ensureSchema()`, and exits. Useful for verifying a new server's credentials
without launching the GUI.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `offline` pill, never connects | Wrong host / server not on the network | Verify LAN IP with `ipconfig` on the server; ping it from the client |
| `ECONNREFUSED` | MySQL not listening on 3306, or firewall blocks it | Check `bind-address`; allow inbound TCP 3306; confirm MySQL service is running |
| `ETIMEDOUT` / connection hangs | Firewall, antivirus, or different subnet/VLAN | Open port 3306, add an AV exclusion, keep clients on the same LAN |
| `ER_ACCESS_DENIED_ERROR` | Wrong user/password or user not allowed from this host | Use the `pta`@`'%'` account; check password; `FLUSH PRIVILEGES` after grants |
| `ER_BAD_DB_ERROR` (unknown database `tapin_school`) | Wrong `DB_NAME`, or the database lives on another server | Confirm the database name; TapIn School must be installed there first |
| `ER_CON_COUNT_ERROR` / `Too many connections` | Aggregate pool size exceeds the server's `max_connections` | Lower `DB_POOL` on clients, or raise `max_connections` in `my.ini` (see §5 sizing) |
| Connects in dev but not in the installed app | Old saved config (`db-config.json`) overrides `.env` | Open the title-bar dialog and connect to the correct server (it overwrites the saved config) |
| Data looks stale after switching servers | The window needs to reload after reconnect | Connect again via the title bar — success triggers a full reload |
| Server comes up later; app still offline | Retry loop should handle it | Wait up to 5s — the pool auto-reconnects; the pill flips green by itself |
| VPN / network change breaks connection | The saved host is no longer reachable | Reconnect from the title bar, or disconnect the VPN if the DB is LAN-only |

---

## 9. Security notes

- Use a **dedicated low-privilege user** (`pta`) for the network, not `root`.
- Keep `DB_PASSWORD` out of the repo — `.env` and `userData/db-config.json`
  are both gitignored / per-machine.
- The title-bar dialog never writes the password into the repo; it only
  persists to the machine's user-data folder.
- On the server, prefer limiting `bind-address` to the LAN interface and
  letting the firewall scope port 3306 to your subnet rather than the whole
  internet.
