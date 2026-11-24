# SIA G9 Registration

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
   `/events/:id` where guests register (name, email, organization, phone), get an 8-character
   ticket code and a QR PNG, and can share the event link. Registration is open only while the
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
cp .env.example .env      # set DB_*, ADMIN_EMAIL, ADMIN_PASSWORD
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

To share it through localtunnel, build and start the server with the tunnel:

```bash
npm run share   # build + start on :4000 + https://<TUNNEL_SUBDOMAIN>.loca.lt
```

Use `npm run share` rather than tunnelling `npm run dev`: the Vite dev server serves dozens of
module requests, so one dropped request through the tunnel leaves a blank page. The built app is
a handful of requests served by Express. `npm run tunnel` starts the tunnel alone.

### Environment

| Variable | Purpose |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection (default database `sia_event_registration`) |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Owner account for `/dev/admin`, applied by `npm run db:migrate` |
| `PORT` | API port (default `4000`). If changed, update the Vite proxy in `web/vite.config.ts`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | Email delivery |
| `EVENT_NAME` | Name for the first event seeded by the migration |
| `TUNNEL_SUBDOMAIN`, `TUNNEL_USE_SUBDOMAIN` | localtunnel name; set the latter to `FALSE` to accept a random URL |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy so rate limiting sees real client IPs |

With no `SMTP_HOST`, mail goes to a throwaway Ethereal inbox: the preview link is printed to the
console and shown on the ticket screen. Any SMTP provider works (SendGrid, Postmark, Gmail app
password, SES…).

## Accounts

- IDs are UUIDs, so they are safe to expose and to reference across tables.
- `owner` — created and edited only by the migration script from `.env`. Sees every event, can
  approve any volunteer, and can add, disable and re-enable organizers.
- `organizer` — signs in at `/dev/admin` and manages only the events they created. Can approve
  volunteers who chose one of their events.
- `staff` — signs up at `/staff`, chooses an event, and starts `pending`. Once approved, they can
  check in attendees and see the attendee list for that event only. Rejected or unassigned
  staff cannot use the check-in tools.
- Passwords are hashed with `scrypt`; sessions are random 256-bit tokens stored as SHA-256 hashes
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
  HTTPS (a tunnel such as `cloudflared` works) or type the ticket code instead — the manual field
  is always available.
- Staff sign in once per device; the session lasts 7 days.
- The registration endpoint is rate limited to 10 attempts per IP per 10 minutes, in memory
  (per process), and sign-in and volunteer sign-up to 10 attempts per 10 minutes.
- Back up the `attendees` table before the event.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/events` | — | Public event list, each with `open` |
| `GET` | `/api/events/:id` | — | Public event detail |
| `POST` | `/api/register` | — | Register for an event (`eventId`), return ticket + QR URL, send email |
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
| `GET` | `/api/admin/staff-requests` | admin session | Pending volunteer requests (organizer: own events) |
| `PATCH` | `/api/admin/staff-requests/:id` | admin session | Approve or reject a volunteer |
| `GET` | `/api/admin/users` | owner | List owner/organizer accounts |
| `POST` | `/api/admin/users` | owner | Add an organizer |
| `PATCH` | `/api/admin/users/:id` | owner | Enable / disable an organizer |
| `GET` | `/api/health` | — | API + database health |
