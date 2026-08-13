# TapIn School — Multi-User / Network Scaling Research

**Status:** Research & proposal (no code changed)
**Date:** August 2026
**Method:** Internet research on (A) MySQL connection handling & pool sizing under many clients, (B) single-writer / leader-election patterns for background jobs, (C) concurrency-safe writes (transactions, deadlocks, optimistic locking), (D) concurrent schema bootstrap, and (E) when a direct-SQL desktop app should move to an API layer. Each recommendation lists *what*, *why*, *effort*, and *where it touches*, and references the current code.

> **Legend:** ✅ already implemented · 📋 already planned in an existing plan · 🆕 new idea from this research · 🔶 recommended follow-up.

---

## 1. Research summary (what the internet says)

### 1.1 MySQL connection handling & pool sizing
- **One connection = one user thread** — MySQL creates an OS thread per live connection, each holding a ~10 KB `THD` and growing to ~10 MB during query execution. Plan memory for **~10 MB per connection** (MySQL engineering blog).
- **Useful concurrency is capped by CPU cores** — MySQL's own benchmark guidance: useful concurrency tops out near **4× CPU cores** (e.g. 48 cores → ~196 busy user threads). Beyond that, more connections add latency, not throughput. Idle connections are cheap; *busy* connections are what matter.
- **Raise `max_connections` from the 151 default when many machines connect** — each TapIn client already opens a pool of **5 connections** (`connectionLimit: 5` in `electron/db/connection.ts`), so 20 machines need ~100 slots just for the app, before admin/backup tools add more.
- **`mysql2` pool best practices** (node-mysql2 discussion #3714): keep the pool as small as the UI can tolerate (queued waits beat a pile of idle sockets), set `idleTimeout` + `enableKeepAlive` to prevent stale sockets silently failing, and always `release()` checked-out connections. A pool that is too large relative to server limits causes "Too many connections" and mysterious hangs until connections are manually killed.

### 1.2 Direct DB access vs an API layer for many clients
- Direct SQL from every desktop client is **fine for a LAN up to ~20–50 machines** — it is fast, simple, and the app already does it. The costs: every client needs DB credentials, every client re-implements schema bootstrap, and every client runs its own background jobs.
- Beyond that, the standard answer is **an API service in front of the database** (REST/HTTP): one process owns the pool, auth, migrations and scheduled jobs; clients become thin. Commonly cited wins: central connection pooling, one credential path, controlled migrations, and the ability to add non-desktop clients (web/portal) later (Software Engineering SE — REST API vs direct DB calls).
- Middle options exist: a **connection pooler** (ProxySQL) absorbs client connections against one server-side pool; a **read replica** offloads report queries. Both are usually unnecessary at school scale.

### 1.3 Single-writer / leader-election for background jobs
- **The classic multi-instance cron bug:** every instance runs the same scheduler → duplicate emails, duplicate SMS, duplicate work. The canonical fixes are a **distributed lock** so only one instance runs a job, or an **atomic claim** of the work rows (take rows with an `UPDATE … WHERE status='PENDING'` and only process rows you actually changed).
- **`GET_LOCK(name, timeout)` in MySQL is the simplest distributed lock** — no new infrastructure: only one session holds a named lock, and it is released automatically when that session ends (sonots/mysql_getlock, Architecture Weekly distributed-locking guide). Standard pattern: wrap each background job in `SELECT GET_LOCK('tapin:absence', 0)` → run → `SELECT RELEASE_LOCK('tapin:absence')`.
- **Atomic row claim:** for a queue table, `UPDATE … SET status='IN_PROGRESS' WHERE id = (SELECT … LIMIT 1)` and check `affectedRows` — a second worker that changed 0 rows knows another worker took it (MySQL race-condition article, Kraken engineering blog).

### 1.4 Concurrency-safe writes
- **Deadlocks are normal under concurrency, not a bug.** InnoDB documents the error codes: **1213 (`ER_LOCK_DEADLOCK`)** and **1205 (`ER_LOCK_WAIT_TIMEOUT`)**. The standard practice is a **retry loop** (2–3 attempts) around multi-statement transactions.
- **`INSERT IGNORE` / `INSERT … ON DUPLICATE KEY UPDATE` are concurrency-safe for the unique-key collision itself** — the database serializes on the index. But `ON DUPLICATE KEY UPDATE` can still deadlock under heavy concurrency, so retry-on-1213 still applies. A shared lock is taken on the duplicate index record (MySQL InnoDB locks reference), so keep transactions short.
- **Lost updates need a version check** — "last write wins" is the default. To prevent two admins overwriting each other's edit of the same student, compare `updated_at` (or a version column) in the `UPDATE` predicate and surface a conflict.
- **Multi-statement flows need a transaction** — e.g. attendance scan → SMS insert must either commit together or be safely re-runnable (idempotent).

### 1.5 Concurrent schema bootstrap
- DDL is **not** free of races: two clients that both detect a missing column and both run `ALTER TABLE` will collide (duplicate column). The app's `ensureSchema()` already guards with `information_schema` checks, but those check-then-act windows race when two machines boot a fresh DB at once. Standard fix: **wrap schema bootstrap in `GET_LOCK('tapin:schema', N)`** so only one machine migrates at a time (MySQL named locks / distributed-migration pattern).

### 1.6 Server-side tuning for a small LAN server
- **InnoDB buffer pool ≈ 70–80% of RAM** is the headline InnoDB setting (Severalnines cheat sheet) — the school DB is tiny, so a few hundred MB keeps every table cached.
- Connection-related server variables worth checking: `max_connections`, `thread_cache_size`, `wait_timeout` (idle clients shouldn't squat slots), `skip_name_resolve` on a LAN (skips per-connection reverse DNS, makes connect faster).
- **Backups/DR:** `mysqldump --single-transaction`, enable MySQL **binary log** for point-in-time recovery, offsite copy (3-2-1 rule). Already partially covered in `RESEARCH_BASED_IMPROVEMENT_PLAN.md` (C4).
- **Security on the network:** dedicated least-privilege DB user (never `root` over the wire), firewall-scope port 3306 to the LAN, consider `require_secure_transport`/TLS if traffic leaves a trusted subnet (MySQL 8 supports it natively).

---

## 2. Current state (what TapIn already has)

| Area | Already built ✅ |
| --- | --- |
| Shared MySQL over LAN | ✅ `electron/db/connection.ts` pool (5 conns, 4s timeout, keep-alive), `NETWORK_DATABASE_CONNECTION.md`, title-bar connect dialog, saved per-machine config |
| Offline-first | ✅ Per-machine JSONL write-behind queue + 30 s snapshot refresh + replay on reconnect (`offline.ts`) |
| Background jobs (run on EVERY machine) | ✅ SMS queue worker (1 s poll), absence detection (15 min), adviser report email (1 min), badge recompute (interval), backups (boot + 12 h), clock-drift check, updater |
| Concurrency-safe schema | ✅ Idempotent `ensureSchema()` with `information_schema` checks before ALTERs (check-then-act) |
| Concurrency-safe writes | ✅ `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE` used for absence/badges/enrollments/sections; unique keys on students/visitors/guardians |
| Scheduler duplicate guards | ✅ In-memory `inFlight` guard in adviser-report; `adviser_report_last_run` / `absence_last_run` settings guard re-runs (settings table is shared, so cross-machine guard mostly holds) |

**Biggest gaps this research highlights:** the SMS queue worker and schedulers run on every machine (duplicate SMS/email risk as soon as a second machine runs), `ensureSchema()` check-then-act windows can race two machines booting a fresh DB, no transaction wrapping for scan→SMS, no deadlock retry loops, no `updated_at` optimistic locking for admin edits, and no central `max_connections` sizing guidance.

---

## 3. What breaks first when many machines share one MySQL

| # | Scenario | Symptom | Why |
| --- | --- | --- | --- |
| 1 | Second machine runs the app | **Duplicate SMS** — two queue workers both select the same `PENDING` rows and both send; parent gets two messages | `queue-worker.ts` `SELECT … WHERE status='PENDING' LIMIT 3` with no atomic claim |
| 2 | Two machines up at the same time | **Duplicate adviser emails** — both pass the `last_run` guard in the same minute | Guard is a settings read then an email send; the window is small but real |
| 3 | Two machines boot a fresh/upgraded DB | **Schema init error** — both check `information_schema`, both run the same ALTER, second fails (or both INSERT the same seed) | Check-then-act DDL race in `ensureSchema()` |
| 4 | 20+ machines | **`Too many connections` / slow title-bar** | 20 × 5 = 100 connections approaches MySQL's 151 default before admin tools/backups add more |
| 5 | Two admins edit the same student | **Silent lost update** — one overwrites the other's save | No `updated_at`/version check on update |
| 6 | Scan + SMS split across statements | **Attendance recorded, parent SMS lost** (or vice versa) on a mid-write failure | No transaction around the write pair |
| 7 | Peak-hour scans from 2 gates | **Deadlock error surfaced to the guard** | No 1213/1205 retry wrapper on writes |
| 8 | Machines on different clocks | **Scans stamped with wrong local time** (absence/badges computed on the wrong day) | `scanned_at` is generated per-machine, not `NOW()` from the server |

---

## 4. Theme A — Connection & server sizing (🆕)

| # | Item | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| A1 | **Document the capacity math** | One row: max_connections ≈ (machines × 5 pool) + admin/backup headroom. 10 machines → `max_connections = 100`; 20 → 200. Raise it in `my.ini` (`max_connections`, and `thread_cache_size`). | S (docs + ini) | `NETWORK_DATABASE_CONNECTION.md`, server setup checklist |
| A2 | **Right-size each client's pool** | Kiosk/guard machines rarely need 5 concurrent queries. Lowering `connectionLimit` to 2–3 and adding `idleTimeout` (e.g. 60 s) + `queueLimit` keeps the aggregate well under server limits and stops stale sockets. | S | `electron/db/connection.ts` (make limit configurable via `DB_POOL` env), `.env.example` |
| A3 | **Monitor connections** | Document the `SHOW STATUS LIKE 'Threads_connected'` check and the MySQL 8.0+ `performance_schema` query so an admin can see the app consuming the budget. | S (docs) | `NETWORK_DATABASE_CONNECTION.md` troubleshooting section |
| A4 | **InnoDB buffer pool on the server** | Set `innodb_buffer_pool_size` ≈ 70–80% of server RAM (tiny dataset → everything cached; scans/reports stop touching disk). | S (server ini) | server setup checklist |
| A5 | **`skip_name_resolve` on the LAN** | Speeds up every new connection (no reverse-DNS lookups) when clients connect by IP. Caveat: grants must then use IPs, not hostnames. | S (server ini) | server setup checklist, grants |

---

## 5. Theme B — One worker, not one per machine (🆕, the critical fix)

| # | Item | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| B1 | **Leader-election for the SMS queue worker** | Wrap the worker's `tick()` in `SELECT GET_LOCK('tapin:sms-queue', 0)` … `RELEASE_LOCK`. Only the machine that wins the lock polls PENDING rows; the others skip that tick. Auto-released if a machine dies — no stale leader. | S | `electron/sms/queue-worker.ts` |
| B2 | **Atomic claim of PENDING rows** | Belt-and-braces over B1: mark claimed rows first (`UPDATE sms_logs SET status='IN_PROGRESS' WHERE status='PENDING' LIMIT 3`, then send only the rows you changed), so even a lockless peer can't double-send. Reuse the existing retry/back-off logic on failure. | S–M | `electron/sms/queue-worker.ts`, schema note (`status` enum + `IN_PROGRESS`) |
| B3 | **Leader-election for every scheduler** | Same `GET_LOCK` pattern around absence detection, adviser reports, badge recompute, and backups — so exactly one machine runs each job. Locks: `tapin:absence`, `tapin:adviser-report`, `tapin:badges`, `tapin:backup`. | M | `absence.ts`, `adviser-report.ts`, `badges.ts`, `backup.ts` (shared helper `withJobLock(name, fn)` in a new `services/job-lock.ts`) |
| B4 | **Keep the settings-based guards** | The `last_run` guards stay — they're the second line of defense and give idempotency across restarts (a lock held at the moment of a crash is auto-released; the guard prevents re-fire). | S | no change; document |
| B5 | **Optionally: a "designated server" mode** | A Settings toggle "this machine runs scheduled jobs" would let schools pick one PC as the worker and keep kiosks fully passive. More moving parts than B1–B3; park as a follow-up. | L | Settings schema + UI, service startup in `main.ts` |

---

## 6. Theme C — Concurrency-safe writes (🆕 mostly)

| # | Item | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| C1 | **Transaction around scan → SMS** | `attendance_logs` insert + `sms_logs` insert in one transaction (via `pool.getConnection()` + `BEGIN/COMMIT/ROLLBACK`) so a failure can't split the pair. Offline replay already keeps the pair in one queue event — do the same online. | M | `electron/services/attendance.ts` (scan path), `offline.ts` replay path |
| C2 | **Deadlock retry helper** | A small `withRetry(fn, { attempts: 3 })` that catches MySQL errors 1213/1205 and retries — wrap the multi-statement write paths (scan, absence upsert, import). Prevents a green-screen deadlock error at peak hour. | S–M | new `services/db-retry.ts`, `ipc.ts` handlers, `absence.ts` |
| C3 | **Optimistic locking on admin edits** | Include `updated_at` in the `UPDATE … WHERE id = ? AND updated_at = ?` predicate for student/guardian/section edits; on 0 rows affected, tell the admin "someone else saved this — reload". Stops silent lost updates between two admins. | M | `electron/ipc.ts` update handlers, renderer save flows (Students, Guardians, Sections) |
| C4 | **`ON DUPLICATE KEY UPDATE` review** | Keep the existing upserts (they're the right tool) but ensure every one runs inside C2's retry wrapper and that `VALUES()`-style columns don't resurrect deleted rows (e.g. `is_active` handling). | M | audit of `ON DUPLICATE KEY` call sites |
| C5 | **Server time as the clock source** | Write `scanned_at` with `NOW(3)` from MySQL (or the DB server's clock) instead of the kiosk's local time, so absence/badges don't get skewed by a slow kiosk clock. The offline queue still stamps its own time — acceptable, but flag in the doc. | M | scan insert paths, `offline.ts` (document), `clock.ts` |

---

## 7. Theme D — Concurrent schema bootstrap (🆕)

| # | Item | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| D1 | **Migration lock** | Wrap `ensureSchema()` (boot + reconnect paths in `main.ts`) in `SELECT GET_LOCK('tapin:schema', 30)` … `RELEASE_LOCK`. Whichever machine grabs the lock migrates; the others wait and then skip. Kills the check-then-act ALTER race. | S | `electron/main.ts` (`applySchema`), `electron/db/schema.ts` |
| D2 | **Tolerate transient DDL errors** | Under the lock, re-run any failed DDL step once — some ALTERs are order-sensitive and a peer may have half-migrated. Keep `ensureSchema()` idempotent (it already is). | S | `electron/db/schema.ts` |
| D3 | **Pin the schema owner** | Document that migrations are coordinated by the lock and any single machine can migrate; no "designated admin PC" required. | S (docs) | `NETWORK_DATABASE_CONNECTION.md` |

---

## 8. Theme E — Security & network hardening (✅ mostly / 🆕 additions)

| # | Item | What / Why | Effort | Touches |
| --- | --- | --- | --- | --- |
| E1 | **Dedicated per-app DB user** | Already recommended (`NETWORK_DATABASE_CONNECTION.md` §5): create `tapin`@`'%'` with grants scoped to `tapin_school.*`; never expose `root` over the LAN. Reaffirm as the multi-machine story grows. | S (docs) | server setup checklist |
| E2 | **TLS / `require_secure_transport`** | If the DB is ever accessed outside a trusted subnet (VPN, WAN, or a wireless guest network), enable MySQL TLS (`require_secure_transport=ON`) and have the app connect with `ssl`. Cheap insurance on school Wi-Fi. | M | `electron/db/connection.ts` (support `ssl` option), server ini, docs |
| E3 | **Least-privilege review** | The app needs DML + DDL (it self-migrates). If D1's lock makes one machine the "migrator", the rest could run with DML-only grants. Park as a follow-up — the single-user grants stay simpler for now. | L | grants, docs |

---

## 9. Architecture evolution (when direct SQL stops being enough)

| Stage | Machines | Setup | Notes |
| --- | --- | --- | --- |
| 1 — Today | 1–5 | Direct SQL + this plan's A–D items | Nothing else needed; the items above remove the duplicate-work and race bugs |
| 2 — LAN scale | 5–30 | Direct SQL, `max_connections` sized (A1), leader-elected workers (B), retry/optimistic writes (C), schema lock (D) | Should comfortably serve a whole campus; monitor `Threads_connected` |
| 3 — Heavy admin + reporting | 30+ | Add a **connection pooler** (ProxySQL) or a **read replica** for report/export queries | Only if reports start contending with gate scans; school data volumes rarely need it |
| 4 — Many users / web portal | 50+ or non-desktop clients | **API layer** (Fastify/Express + the existing `ipc.ts` logic as services) — clients call HTTP, the service owns the pool/auth/migrations/jobs | Biggest change; enables a guardian web portal (already planned in `RESEARCH_BASED_IMPROVEMENT_PLAN.md` B6) and thin clients. Parked until portal work starts |

---

## 10. Quick-win shortlist (small effort, high impact)

1. **B1** — `GET_LOCK` around the SMS queue worker tick (prevents duplicate SMS the moment a 2nd machine runs). **Critical.**
2. **D1** — `GET_LOCK` around `ensureSchema()` (prevents the two-machine boot race).
3. **B3** — `withJobLock` for absence / adviser-report / badges / backup.
4. **A2** — lower kiosk pool to 2–3 + `idleTimeout`, make it env-configurable.
5. **C2** — deadlock retry helper on the multi-statement writes.
6. **A1/A4** — `max_connections` + buffer-pool doc/ini (capacity maths + `SHOW STATUS` check).
7. **C3** — `updated_at` optimistic lock on admin edits.

---

## 11. Suggested roadmap

**Phase 1 — Stop the duplicates (day 1):**
B1 queue-worker lock → D1 schema lock → B3 job locks → B2 atomic SMS claim.

**Phase 2 — Make writes safe (weeks 1–2):**
C1 scan→SMS transaction → C2 deadlock retries → C3 optimistic locking → C4 upsert audit.

**Phase 3 — Right-size the server (weeks 2–3):**
A2 per-client pool tuning → A1/A4 capacity maths + `max_connections`/buffer-pool config → A3 monitoring docs → C5 server-time scans.

**Phase 4 — Harden & plan ahead (later):**
E2 TLS over untrusted networks → B5 designated-server mode → stage-4 API-layer design when the guardian portal starts.

---

## 12. Research sources

- MySQL engineering blog — *MySQL Connection Handling and Scaling* (connections = user threads, ~10 MB/connection memory planning, useful concurrency ≈ 4× cores): https://dev.mysql.com/blog-archive/mysql-connection-handling-and-scaling/
- MySQL 8.0 Reference Manual — *max_connections*, *InnoDB Locks Set by Different SQL Statements* (shared lock on duplicate index record, deadlock risk), *GET_LOCK()/RELEASE_LOCK()* named locks, `require_secure_transport`, `skip_name_resolve`, `performance_schema`: https://dev.mysql.com/doc/refman/8.4/en/
- node-mysql2 discussion — *Best Practice Pool config* (connectionLimit, idleTimeout, queueLimit, keep-alive, stale-connection failures): https://github.com/sidorares/node-mysql2/discussions/3714
- Architecture Weekly — *Distributed Locking: A Practical Guide* (named-lock leader election, session-scoped release): https://www.architecture-weekly.com/p/distributed-locking-a-practical-guide
- sonots/mysql_getlock — distributed locking with MySQL `GET_LOCK` (auto-release on session end): https://github.com/sonots/mysql_getlock
- Kraken Engineering — *Avoiding race conditions using MySQL locks* (INSERT … SELECT conditional claims): https://engineering.kraken.tech/news/2025/01/20/mysql-race-conditions.html
- Software Engineering StackExchange — *Why do people do REST APIs instead of DBALs?* and *REST API vs directly DB calls in Desktop Application* (direct SQL vs API trade-offs): https://softwareengineering.stackexchange.com/questions/277701
- Severalnines — *MySQL Performance Cheat Sheet* (InnoDB buffer pool ≈ 70–80% RAM): https://severalnines.com/blog/mysql-performance-cheat-sheet/
- OneUptime — *How to Configure MySQL max_connections* (pool before raising limits, per-user caps): https://oneuptime.com/blog/post/2026-03-31-mysql-max-connections/view
- Prior plans: `NETWORK_DATABASE_CONNECTION.md` (existing LAN connection design), `RESEARCH_BASED_IMPROVEMENT_PLAN.md` (C4 backups/PITR, B6 guardian portal).

---

## 13. How to use this plan

1. The two **critical** fixes (B1, D1) are single-function changes — do them first; they unlock safe multi-machine use immediately.
2. Follow the repo convention for any new service: `shared/types.ts` contract → `electron/ipc.ts` handler (if user-facing) → `electron/preload.ts` → renderer; mock parity in `src/lib/api.ts` (browser demo mode must keep working).
3. New DB columns (e.g. SMS `IN_PROGRESS` status, nothing else currently) go through `electron/db/schema.ts` + `scripts/init-db.mjs` idempotent migrations.
4. Validate with `npm run typecheck` after each change; run two app instances against one DB in dev to verify no duplicate SMS/emails.
