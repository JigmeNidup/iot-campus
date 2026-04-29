# Campus Map

Full-stack interactive campus map application. Upload a map image, draw building polygons over it, attach metadata (categories, departments, floors, images, descriptions), and publish a polished public view with search, filters, and zoom.

Built with **Next.js 16 (App Router)**, **TypeScript** (strict mode), **Tailwind CSS v4**, **shadcn/ui**, **PostgreSQL** (`pg`, parameterized queries), **NextAuth v5** (Credentials, JWT), **Zustand**, **Zod**, and **Sonner**.

---

## Highlights

- Credentials-based authentication (NextAuth v5, JWT sessions, Edge-safe middleware split)
- Multi-map dashboard, per-user ownership, draft / published states
- Polygon and rectangle drawing with vertex editing, body drag, and per-building lock
- Per-building metadata: name, abbreviation, category, color, floors, departments, **image**, description
- Left-side **building drawer** with image, title, and description on the public map
- **Import / export** buildings as portable JSON (no map IDs baked in - works across maps)
- Drag-and-drop building reordering (dnd-kit)
- Zoom / pan SVG canvas with pinch and wheel-to-zoom
- Search, category filter, hover tooltips, fit-to-screen
- File uploads (PNG / JPG / SVG, up to 25 MB) served through a custom API route so they survive production builds
- Copy-link button on the dashboard for any published map
- IoT device management dashboard (`/dashboard/iot`) with map overlays, drag-to-move, lock/unlock, and inline editing
- Public map IoT display for unauthenticated users with live MQTT status updates and marker hover details
- Global per-map `temp_humidity` sensor (one per map) with editor and public display cards
- Import / export IoT devices as JSON (replace or append mode)
- Custom logo + favicon

---

## Quick start

### 1. Install

```powershell
npm install
```

### 2. Configure environment

Create `.env.local` from `.env.example`:

```env
DATABASE_URL=postgresql://campusmap_admin:admin123@localhost:5432/campusmap
AUTH_SECRET=<32-byte hex secret>
NEXTAUTH_URL=http://localhost:3000
```

Generate `AUTH_SECRET` with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 3. Initialise the database

You have two options.

**a) Pure SQL** - run `[database/setup.sql](database/setup.sql)` once as a Postgres superuser. It creates the `campusmap_admin` role, the `campusmap` database, all tables, indexes, and seeds the default admin (`admin@campusmap.com` / `admin123`) using `pgcrypto`'s bcrypt.

```powershell
psql -U postgres -f database/setup.sql
```

**b) Node script** - if the role and database already exist, run:

```powershell
npm run db:setup
```

This creates / migrates the tables and seeds the admin user via `bcryptjs`.

### 4. Run the dev server

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), click **Sign in**, and use:

- **Email:** `admin@campusmap.com`
- **Password:** `admin123`

---

## Scripts


| Command               | Description                                     |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | Start the Next.js dev server (Turbopack)        |
| `npm run build`       | Production build                                |
| `npm run start`       | Start the production server                     |
| `npm run lint`        | Run `next lint`                                 |
| `npm run typecheck`   | Run `tsc --noEmit`                              |
| `npm run db:setup`    | Create / migrate tables and seed the admin user |
| `npm run db:teardown` | Drop all tables (with confirmation)             |


---

## Project layout

```
src/
  app/
    (auth)/           # /login (public)
    (dashboard)/      # /dashboard, /editor, /editor/[mapId], /dashboard/iot (auth-guarded)
    (display)/        # /map/[mapId]   (public, only when published; includes IoT read-only layer)
    api/
      auth/[...nextauth]/   # NextAuth route handler
      maps/                 # CRUD + transactional building updates
      maps/[id]/devices     # IoT device CRUD for owned maps
      upload/               # Multipart upload to ./uploads/
      files/[id]/           # Reads ./uploads/ and streams the file
  components/
    auth/             # SessionProvider, LoginForm
    dashboard/        # DashboardHeader, MapCard
    iot/              # IotDashboard, IotMapView, DeviceList, IotImportExport
    editor/           # MapEditor, EditorCanvas, BuildingForm, BuildingList,
                      # MapUploader, MapPreview, BuildingImportExport, EditorToolbar
    map/              # MapDisplay, MapOverlay, MapControls, BuildingDrawer,
                      # SearchBar, CategoryFilter
    ui/               # shadcn primitives
  hooks/              # useMapTransform, usePolygonDrawing, useBuildingSearch
  lib/
    auth.config.ts    # Edge-safe NextAuth config (used by middleware)
    auth.ts           # Full NextAuth (Credentials, pg, bcryptjs)
    db.ts             # Singleton pg Pool, query / getClient helpers
    uploads.ts        # UPLOAD_DIR (./uploads/), filename validator, fileUrl()
    utils.ts          # cn, centroid, snake_case -> camelCase mappers
    validators.ts     # Zod schemas
  stores/
    editor-store.ts   # Zustand: drawing, buildings, view, history, save state
  types/              # Building, CampusMap, NextAuth augmentation
  middleware.ts       # Edge guard for /dashboard and /editor

database/
  setup.sql           # One-shot SQL to create role, database, schema, admin
scripts/
  setup-db.ts         # Same schema via tsx + bcryptjs
  teardown-db.ts
uploads/              # Created at first upload. Gitignored.
public/
  logo.png            # App brand mark
```

---

## IoT management

- Broker transport uses browser WebSocket MQTT client (`mqtt`) with topic namespace:
  - command: `campus/{mapId}/device/{deviceId}/command`
  - status: `campus/{mapId}/device/{deviceId}/status`
- Supported device types:
  - `light`
  - `water_valve`
  - `temp_humidity` (singleton per map; one allowed)
- Lock semantics:
  - `locked` prevents moving overlays
  - ON/OFF toggling remains available from device list
- Device data is persisted in PostgreSQL `iot_devices`, and map/public UIs both use DB state as initial source of truth.
- Real-time updates:
  - editor dashboard and public map subscribe to map wildcard status topic (`campus/{mapId}/device/+/status`)
  - clients update in-memory device state on incoming MQTT payloads.

---

## Uploads and static files

- Allowed MIME types: `image/png`, `image/jpeg`, `image/svg+xml`. Hard limit: 25 MB.
- Files are written to `./uploads/` at the **project root**, not `public/`. This keeps them visible in production (`next build` does not copy `public/uploads/` if it's added later).
- Files are served via `GET /api/files/[id]` with a strict filename allowlist, path-traversal guard, and a long immutable cache header.
- The folder is created lazily on the first upload.

---

## Authentication

NextAuth v5's middleware runs in the Edge runtime, which doesn't allow Node-only modules (`pg`, `bcryptjs`). Hence the **two-file split**:

- `src/lib/auth.config.ts` - Edge-safe config (`trustHost: true`, `session`, callbacks). No providers.
- `src/lib/auth.ts` - adds the `Credentials` provider with `pg` + `bcryptjs`. Imported by API routes only.
- `src/middleware.ts` - uses **only** `authConfig` so the Edge bundle stays clean.

Sessions are JWT (no DB session table). The JWT carries `id` and `role` for the route guards.

---

## Production notes

The included `[pm2_guide.txt](pm2_guide.txt)` shows the basic PM2 commands for running the app under PM2:

```powershell
pm2 start npm --name "iot" -- start
pm2 stop "iot"
pm2 restart "iot"
```

Run `npm run build` first, then start under PM2.

---

## License

Private. All rights reserved.