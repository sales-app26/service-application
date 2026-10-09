# Sales Tracker — service application

NestJS API for the Sales Tracker (see `../sales-tracker-BRD.md`, `../sales-tracker-PRD.md`,
`../sales-tracker-DB-design.md`). Leads and follow-ups are logged against projects, door-to-door
visits are proven with a live photo and GPS, and admins track conversion targets.

Stack: NestJS 11, TypeORM, PostgreSQL on Supabase (schema **`sales`**), Supabase Auth and Storage.

## Setup

```bash
npm install
cp .env.example .env          # fill in the Supabase keys and CAPTURE_TOKEN_SECRET
npm run migration:run         # creates schema `sales` and the 7 tables
npm run db:seed               # first Super Admin, from SEED_SUPER_ADMIN_* in .env
npm run start:dev             # http://localhost:4100/api/v1, docs at /docs
```

Supabase needs:

- **Auth**: email provider on. `AUTH_REDIRECT_URL` points at the app screen that reads the token
  from an invite or reset link and calls `POST /auth/set-password`.
- **Storage**: a **private** bucket named `SUPABASE_STORAGE_BUCKET`. Photos are only ever served
  through short-lived signed URLs.
- **Fonts on the server** (Docker images): the photo stamp is rendered by sharp/librsvg, so install
  a font package, e.g. `apk add font-dejavu` on Alpine.

## Database

Everything lives in the `sales` schema; nothing is created in `public`.
`src/database/sql/01_sales_schema.sql` is the source of truth and the migration replays it.
The database enforces what a single row or a unique index can express: allowed values, no
duplicate phone per project, one pending transfer per lead, target count and period set together,
and all-or-nothing visit proof. The API enforces everything that depends on role, project type or
time of day.

## How the rules are implemented

| Rule | Where |
| --- | --- |
| Every route needs a login; a deactivated user is refused on their next request | `modules/auth/guards/auth.guard.ts` |
| Project scope (Super Admin: all, Moderator: his projects, Sales person: his own leads) | `modules/access/project-access.service.ts`, `modules/leads/lead-access.service.ts` |
| Status model, next follow-up date, conversion credit | `modules/leads/lead-rules.ts` (pure functions, unit-tested) |
| Live photo + GPS, 10-minute window on the server clock, stamp, ~200–300 KB | `modules/visits/*`, `modules/media/image.service.ts` |
| Idempotent saves (`clientRequestId`) | `follow_ups.client_request_id` unique, replay in `lead-access.service.ts` |
| Same-day edit lock at midnight IST | `modules/leads/entries.service.ts` → `edit` |
| Transfers: approval, no self-approval, first decision wins, auto-reject | `modules/transfers/*` |
| Targets, Due today, timeline, dashboard, CSV exports (max 92 days) | `modules/reports/*` |

All "today", week (Monday–Sunday) and month boundaries are India time (`common/utils/ist-time.util.ts`).

## Tests

```bash
npm test          # unit tests + schema constraints on real Postgres (PGlite, in-process)
npm run test:e2e  # boots the API against PGlite and a fake Supabase
```

## API map (`/api/v1`)

| Area | Endpoints |
| --- | --- |
| Auth | `POST auth/login · refresh · logout · forgot-password · set-password · change-password`, `GET/PATCH auth/me` |
| Users | `GET/POST users`, `GET/PATCH users/:id`, `POST users/:id/deactivate · reactivate`, `PATCH users/:id/role · email` |
| Projects | `GET/POST projects`, `GET projects/joinable`, `GET/PATCH projects/:id`, `POST projects/:id/close · reopen · image · join`, `DELETE projects/:id/image` |
| Members | `GET/POST projects/:id/members`, `DELETE projects/:id/members/:userId`, `PATCH …/:userId/target` |
| Locations | `GET projects/:id/locations?q=` |
| Leads | `GET/POST projects/:id/leads`, `GET/PATCH/DELETE leads/:id`, `GET leads/:id/entries` |
| Entries | `POST leads/:id/follow-ups`, `POST leads/:id/status`, `GET/PATCH/DELETE entries/:id`, `GET entries/:id/photo` |
| Visits | `POST visits/capture-token` |
| Transfers | `POST leads/:id/transfers · reassign`, `POST projects/:id/leads/reassign`, `GET transfers`, `GET transfers/pending-count`, `POST transfers/:id/approve · reject` |
| Reports | `GET me/home`, `GET me/due-today`, `GET timeline`, `GET dashboard`, `GET exports/leads · follow-ups` |
# service-application
