# 📱 PhilSMS Setup Guide — TapIn School

How to connect **TapIn School** to the **PhilSMS** cloud SMS gateway so parents
receive text alerts when their child checks in/out and when the student is
absent. PhilSMS is a Philippines-native SMS gateway that routes messages over
**Smart, Globe, and DITO** networks.

> Cost model: **prepaid credits**. You load a balance on your PhilSMS account
> and every SMS consumes credits. New PhilSMS accounts typically come with a
> small free balance (e.g. 5 credits) for testing.

---

## What TapIn School does with PhilSMS

- Every attendance scan with a parent phone number on file queues a parent SMS
  ("{{school}} Alert: {{name}} ({{section}}) checked IN to school at …").
- Automated absence detection emails → SMSes parents when a student is marked
  absent.
- The queue worker polls pending messages every 1 s, retries failures up to 5
  times, then flags them **FAILED** (retryable from the SMS Outbox).
- On boot (and periodically), the app **live-verifies** your PhilSMS API token
  by checking the account balance — the kiosk header shows the real gateway
  status (e.g. *"PhilSMS verified — balance ₱25.00"*).

### Requirements

| Item | Details |
| --- | --- |
| Internet connection | Required on the kiosk PC (outbound HTTPS to `dashboard.philsms.com`) |
| PhilSMS account | Free to create at [philsms.com](https://philsms.com) |
| API token | Found in the PhilSMS dashboard |
| Sender ID | Required by PhilSMS; up to **11 characters** (alphanumeric) |
| Credits | Prepaid balance; SMSes fail with **no credits left** otherwise |
| Parent phone numbers | 11-digit Philippine format, e.g. `09171234567` (the app converts to `639171234567` automatically) |

---

## Step 1 — Create a PhilSMS account and get your API token

1. Go to **[https://philsms.com](https://philsms.com)** and sign up.
2. Verify your email address and log in to the **PhilSMS dashboard**
   (`https://dashboard.philsms.com`).
3. Open the **developer / API settings** area of the dashboard and copy your
   **API token** (`api_token`). Keep it secret — it's the password to your
   account.
4. Note the free test credits credited to new accounts (check your balance in
   the dashboard).

> ⚠️ TapIn School talks to the **dashboard** API host
> (`https://dashboard.philsms.com/api/v3`) — `app.philsms.com` rejects tokens,
> so if you see auth failures, make sure the app is reaching the dashboard host
> (it is, by default) and that the token came from the dashboard.

## Step 2 — Register a Sender ID (required)

PhilSMS requires every message to carry a **Sender ID** — the name parents see
as the sender of the text (e.g. `TAPINSCHL`).

1. In the PhilSMS dashboard, find **Sender ID registration**.
2. Enter your school/brand name — **up to 11 characters**, letters and numbers
   only (no spaces/symbols).
3. Submit it. Registration is **free**, but telco approval usually takes
   **2–3 days** — messages sent with an unapproved sender ID may be rejected.
4. While waiting, you can still configure the app with the sender ID — it will
   send once approved.

> If you leave the sender blank in TapIn School, the app falls back to the
> **school name** from Settings (truncated to 11 characters), then to
> `PhilSMS`.

## Step 3 — Load credits (top up)

SMS delivery consumes prepaid credits.

1. In the PhilSMS dashboard, go to **Top Up / Load Balance**.
2. Choose an amount and pay (GCash, bank transfer, etc. — check the dashboard's
   available methods).
3. Confirm the balance appears on the dashboard. The kiosk header will show the
   remaining balance once the app verifies the connection.

## Step 4 — Configure TapIn School

Open **Admin → Settings** (log in, then `Ctrl+Shift+A` from the kiosk, or open
the sidebar) and find the **SMS provider** card:

1. **Delivery channel** → select **Cloud SMS API (internet required)**.
2. **Cloud provider** → select **PhilSMS (Philippines)**.
3. **API key** → paste your PhilSMS **API token**.
4. **Sender name / ID** → enter your approved Sender ID (up to 11 chars).
   *Marked "(required by PhilSMS)" in the UI; falls back to the school name if
   empty.*
5. Click **💾 Save Settings** (or just leave the page — unsaved changes
   auto-save).

The kiosk header's **SMS status dot** (and the settings you just saved) will
show the live verification result within seconds:

| Status shown | Meaning |
| --- | --- |
| `PhilSMS verified — balance ₱25.00` | ✅ Working — gateway online, credits available |
| `PhilSMS verified — no credits left, top up to send` | ⚠️ Token OK, but need to load credits |
| `PhilSMS rejected the API token (401)` | ❌ Wrong/expired token — re-check Step 1 |
| `Key verification timed out` | ❌ Kiosk PC can't reach the PhilSMS API (firewall/offline) |

## Step 5 — Send a test SMS

The app has no "send test SMS" button, so test with a real scan:

1. In **Admin → Students**, make sure a test student has a **parent phone** in
   11-digit PH format (`09xxxxxxxxx`).
2. On the kiosk, scan that student's QR (or use **Manual Check-In** in the
   admin). The scan logs IN and enqueues a parent SMS.
3. Open **Admin → SMS Outbox**: the message should move from `PENDING` →
   `SENT` within a couple of seconds.
4. Check the phone received: **sender = your Sender ID**, body uses the SMS
   template from Settings (editable under *School → SMS message template*).

> 💡 Try the **Simulator** provider first (Settings → Delivery channel →
> Simulator) to confirm messages are queued correctly without spending credits.

### SMS template tips (saves credits)

- Keep the template **plain ASCII** — non-ASCII characters (e.g. `—`) force the
  message to be sent as **Unicode, which costs 2 credits** and can trip telco
  filters on Smart/TNT lines.
- Available placeholders: `{{school}} {{name}} {{section}} {{action}} {{time}}
  {{flag}}` — `{{flag}}` shows `LATE` / `EARLY` on flagged scans.
- Avoid URL shorteners in message text — PH telcos filter them.

---

## How it all flows

```
QR scan / absence detection
        │
        ▼
attendance_logs  →  sms_logs (status = PENDING)
        │
        ▼
queue worker (every 1 s)
        │   retries up to 5× (800 ms backoff)
        ▼
PhilSMS API  POST https://dashboard.philsms.com/api/v3/sms/send
        │   Authorization: Bearer <api_token>
        │   { recipient: 639171234567, sender_id: "TAPINSCHL",
        │     type: "plain"|"unicode", message: "…" }
        ▼
SENT (outbox)  —  or FAILED (retryable manually from SMS Outbox)
```

- Phone numbers are normalized automatically: `09171234567` → `639171234567`.
- `type` is chosen automatically: `plain` for ASCII (1 credit), `unicode` for
  accented/Unicode text (2 credits).
- The balance check calls `GET /api/v3/balance` — the same token is reused, so
  if sending works, verification works and vice versa.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `PhilSMS rejected the API token (401)` | Token wrong, expired, or copied with a stray space/line break. Copy it again from the **dashboard** (not `app.philsms.com`). |
| `no credits left, top up to send` | Load balance on the PhilSMS dashboard (Step 3). |
| `Key verification timed out` | Kiosk PC can't reach `dashboard.philsms.com` — check internet, firewall, proxy. |
| SMS stuck on `PENDING` in Outbox | Gateway not verified / offline. Check the kiosk SMS status dot; fix the token first, then retry from the Outbox. |
| SMS shows `FAILED` in Outbox | Open the row — the error column shows PhilSMS's message. Common: sender ID not yet approved, invalid recipient, insufficient credits. Retry manually after fixing. |
| Recipient rejected | Parent phone must be PH format. The app converts `09xx…` → `639xx…`; store `09xxxxxxxxx` in Students. |
| Sender shows a number, not your name | Sender ID not registered/approved yet, or blank → falls back to school name. |
| Outgoing texts never arrive | Smart/Globe/DITO occasionally filters messages with URLs/shorteners or non-ASCII chars — keep templates ASCII and use full URLs only. |
| Messages cost 2 credits each | Template contains non-ASCII characters (e.g. `—`, `ñ`, accents) → force `plain` by keeping the template ASCII-only. |

---

## Appendix — environment variables (optional)

You can also pre-seed the PhilSMS config via `.env` (used as defaults until
changed in Settings):

```env
CLOUD_PROVIDER=philsms
CLOUD_API_KEY=your_philsms_api_token
CLOUD_SENDER=TAPINSCHL
```

---

*Related code: `electron/sms/providers/cloud.ts` (PhilSMS adapter),
`electron/sms/queue-worker.ts` (delivery queue), `src/screens/admin/Settings.tsx`
(configuration UI), `src/screens/admin/SmsOutbox.tsx` (message status/retry).*
