# Event Manager

Event registration with QR tickets, emailed tickets, and on-site check-in, plus a staff dashboard
and an admin panel for events, organizers and volunteer approvals.

- **Frontend** — React 19 + Vite + Tailwind v4 + shadcn/ui components
- **Backend** — Node (Express 5)
- **Database** — MySQL
- **QR codes** — generated on demand by the server (`qrcode`)
- **Email** — SMTP via `nodemailer` (Ethereal test inbox when SMTP is not configured)

## How it works

1. `/` — asks whether you are a guest or staff.
2. `/events` — guests browse every published event. Each event has its own page at
   `/events/:id` where guests register (name, email, organization, phone) and receive an
   8-character ticket code and QR PNG by email. Registration is open only while the
   event is `open`, has not started, and its deadline has not passed.
3. The QR image is emailed as an inline attachment (`cid:ticket-qr`) plus a downloadable copy.
4. `/staff` — staff sign in to check in attendees and see the attendee list for the event they
   were assigned. New volunteers sign up here, choose an event, and wait for approval.
5. `/dev/admin` — unlisted admin dashboard with tabs for overview, events, approvals and
   (owner only) organizers. Create, edit and delete events; approve or decline volunteer
   requests. Signing out returns to the public page.

The QR payload is the ticket code itself (e.g. `R26XWRRB`), so a generic phone camera shows a
readable code with no personal data. Old `/scan` and `/attendees` links redirect to `/staff`.

## Setup

Requires Node 20.11+ and MySQL 8+.

```bash
npm install
cp .env.example .env      # set DB_*, ADMIN_EMAIL, ADMIN_PASSWORD (12+ characters)
npm run db:migrate        # creates the database, tables, first event and admin account
npm run dev               # API on :4000, app on :5173
```

Open http://localhost:5173 and sign in at http://localhost:5173/dev/admin.

`db:migrate` is safe to re-run. It creates the schema if missing, upgrades older databases
(per-event attendees, staff accounts and volunteer assignments), seeds a first event when there
are none, and then **inserts or updates** the owner account from `ADMIN_EMAIL` /
`ADMIN_PASSWORD` / `ADMIN_NAME` (sessions for that account are revoked, so a changed password
takes effect immediately).

For a single production process:

```bash
npm run build   # builds web/dist
npm start       # serves the built app and the API on :4000
```

### Sharing over HTTPS (ngrok or localtunnel)

Browsers only allow camera access on `https://` or `localhost`, so a tunnel is needed for QR
scanning on a phone. Two providers are wired up; pick one.

**ngrok (recommended — steadier connection, fixed dev domain, fewer dropped requests):**

```bash
# one-time
brew install ngrok                 # or https://ngrok.com/download
ngrok config add-authtoken <TOKEN> # free token from https://dashboard.ngrok.com/get-started/your-authtoken

# every time
npm run share:ngrok                # build + start on :4000 + your ngrok dev domain
```

`npm run share:ngrok` runs `ngrok http 4000`, which automatically uses your account's dev
domain. Every account gets one fixed dev domain (find it at
https://dashboard.ngrok.com/domains) — set `APP_ORIGIN` to that URL and `TRUST_PROXY=1` in
`.env` once; the URL does not change between restarts. Paid plans can pass a custom domain to
`ngrok` via its own config if needed.

> ngrok's free plan shows a one-click "Visit Site" warning page to browsers. Upgrade, or use
> localtunnel, if guests must land on the event page directly.

**localtunnel (no account needed):**

```bash
npm run share                      # build + start on :4000 + https://<TUNNEL_SUBDOMAIN>.loca.lt
```

Set `TUNNEL_SUBDOMAIN` (default `event-registration-sia`), then set
`APP_ORIGIN=https://<TUNNEL_SUBDOMAIN>.loca.lt` and `TRUST_PROXY=1` in `.env`. If the subdomain
is taken, change it or set `TUNNEL_USE_SUBDOMAIN=FALSE` to accept a random URL (then update
`APP_ORIGIN` and restart). You can also select the provider with `TUNNEL_PROVIDER=ngrok` and use
`npm run share`.

`APP_ORIGIN` and `TRUST_PROXY=1` are required either way, so emailed ticket links point at the
tunnel and rate limits see real client IPs.

Use `npm run share` / `npm run share:ngrok` rather than tunnelling `npm run dev`: the Vite dev
server serves dozens of module requests, so one dropped request through the tunnel leaves a blank
page. The built app is a handful of requests served by Express. `npm run tunnel` and
`npm run tunnel:ngrok` start a tunnel alone.

### Environment

| Variable | Purpose |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection (default database `sia_event_registration`) |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Owner account for `/dev/admin`, applied by `npm run db:migrate` (password 12+ characters, not a placeholder) |
| `APP_ORIGIN` | Public origin used in email links, e.g. `https://events.example.com`. Required for any non-localhost host; never trusts the `Host` header. |
| `PORT` | API port (default `4000`). If changed, update the Vite proxy in `web/vite.config.ts`. |
| `LOG_RETENTION_DAYS` | Days of request/pageview logs kept in `docs/logs` (default `14`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | Email delivery |
| `EVENT_NAME` | Name for the first event seeded by the migration |
| `TUNNEL_SUBDOMAIN`, `TUNNEL_USE_SUBDOMAIN` | localtunnel name; set the latter to `FALSE` to accept a random URL |
| `TUNNEL_PROVIDER` | Tunnel used by `npm run share`: `localtunnel` (default) or `ngrok` |
| `TRUST_PROXY` | A hop count (`1`) or subnet list when behind a reverse proxy/tunnel, so rate limiting sees real client IPs |
| `COOKIE_SECURE` | Set to `true` to force `Secure` on the session cookie when TLS terminates before Express |

With no `SMTP_USER`, mail goes to a throwaway Ethereal inbox: the preview link is printed to the
console and shown on the confirmation screen. The default config is a Gmail app password: set
`SMTP_USER` to the full Gmail address and `SMTP_PASS` to the 16-character app password (2-Step
Verification required). Any other SMTP provider works by overriding `SMTP_HOST`/`SMTP_PORT`.

## Accounts

- IDs are UUIDs, so they are safe to expose and to reference across tables.
- `owner` — created and edited only by the migration script from `.env`. Sees every event, can
  approve any volunteer, and can add, disable and re-enable organizers.
- `organizer` — signs in at `/dev/admin` and manages only the events they created. Can approve
  volunteers who chose one of their events.
- `staff` — signs up at `/staff`, chooses an event, and starts `pending`. Once approved, they can
  check in attendees and see the attendee list for that event only. Rejected or unassigned
  staff cannot use the check-in tools.
- Passwords are hashed with `argon2id`; sessions are random 256-bit tokens stored as SHA-256 hashes
  in an `httpOnly`, `SameSite=Lax` cookie (7 days, `secure` on HTTPS).

## Verification

Run through these once after configuring `.env`:

1. **Migration** — `npm run db:migrate` twice; the second run should say *updated* and not
   duplicate the account.
2. **Guest** — open `/`, choose *I'm a guest*, pick an event, register with a test address, and
   confirm the ticket page shows the QR and code. `SELECT * FROM attendees;` should show the row
   with an `event_id`. The email should render the same QR inline.
3. **Share** — press *Share event* on an event page; on mobile it opens the share sheet, otherwise
   it copies the event link.
4. **Volunteer** — sign up at `/staff` for an event, then sign in at `/dev/admin` and approve the
   request under *Approvals*. The volunteer can now check in attendees for that event.
5. **Check-in** — scan the ticket QR (or type the code) from `/staff`. The attendee should switch
   to *Checked in* in the attendee tab. Scanning again reports *Already checked in*.
6. **Admin** — sign in at `/dev/admin`, use the tabs to create an event and add an organizer.
   Sign in as that organizer and confirm they see only their own event. Deleting an event also
   deletes its registrations and clears any volunteer assigned to it.

## Notes for event day

- Browsers only allow camera access on `https://` or `localhost`. On a phone, serve the app over
  HTTPS (a tunnel such as ngrok or localtunnel — see *Sharing over HTTPS*) or type the ticket
  code instead — the manual field is always available.
- Staff sign in once per device; the session lasts 7 days.
- The registration endpoint is rate limited to 10 attempts per IP per 10 minutes, in memory
  (per process), and sign-in and volunteer sign-up to 10 attempts per 10 minutes.
- Back up the `attendees` table before the event.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/events` | — | Public event list, each with `open` |
| `GET` | `/api/events/:id` | — | Public event detail |
| `POST` | `/api/register` | — | Register for an event (`eventId`) and email the ticket; the code is never returned to the submitter |
| `GET` | `/api/tickets/:code/qr.png` | — | QR image |
| `POST` | `/api/staff/signup` | — | Volunteer sign-up (pending approval, sets session cookie) |
| `POST` | `/api/checkin` | session | Check in by code (staff: assigned event only) |
| `GET` | `/api/attendees?eventId=` | session | List + totals (staff: assigned event only) |
| `POST` | `/api/admin/login` | — | Owner/organizer/staff sign-in (sets session cookie) |
| `POST` | `/api/admin/logout` | session | Sign out |
| `GET` | `/api/admin/me` | session | Current account, or `null` |
| `GET` | `/api/admin/events` | admin session | Events the account may manage |
| `POST` | `/api/admin/events` | admin session | Create an event |
| `PATCH` | `/api/admin/events/:id` | admin session | Update an event (owner: any, organizer: own) |
| `DELETE` | `/api/admin/events/:id` | admin session | Delete an event and its registrations (owner: any, organizer: own) |
| `DELETE` | `/api/admin/attendees/:id` | admin session | Remove one registration (owner: any, organizer: own events) |
| `GET` | `/api/admin/volunteers` | admin session | Every volunteer and their event (organizer: own events) |
| `PATCH` | `/api/admin/volunteers/:id` | admin session | Edit name, event or email (email waits for verification; organizer: own events) |
| `DELETE` | `/api/admin/volunteers/:id` | admin session | Delete a volunteer and their sessions (organizer: own events) |
| `GET` | `/api/admin/volunteers/confirm-email` | token | Confirm a volunteer's new email address |
| `GET` | `/api/admin/staff-requests` | admin session | Pending volunteer requests (organizer: own events) |
| `PATCH` | `/api/admin/staff-requests/:id` | admin session | Approve or reject a volunteer |
| `GET` | `/api/admin/users` | owner | List owner/organizer accounts |
| `POST` | `/api/admin/users` | owner | Add an organizer |
| `PATCH` | `/api/admin/users/:id` | owner | Enable / disable an organizer |
| `GET` | `/api/health` | — | API + database health |
