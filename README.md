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
- Programming dashboard (`/dashboard/programming`) for per-device ESP firmware generation and OTA lifecycle controls
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
    (dashboard)/      # /dashboard, /editor, /editor/[mapId], /dashboard/iot, /dashboard/programming (auth-guarded)
    (display)/        # /map/[mapId]   (public, only when published; includes IoT read-only layer)
    api/
      auth/[...nextauth]/   # NextAuth route handler
      maps/                 # CRUD + transactional building updates
      maps/[id]/devices     # IoT device CRUD for owned maps
      ota/                  # Firmware upload/list/download + OTA push APIs
      iot/register/*        # Device provisioning registration APIs
      iot/ota/ack           # Device OTA status ack API
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
- OTA lifecycle fields are tracked per device: board target, firmware version, registration token, OTA status, and last seen timestamp.
- Real-time updates:
  - editor dashboard and public map subscribe to map wildcard status topic (`campus/{mapId}/device/+/status`)
  - clients update in-memory device state on incoming MQTT payloads.

### OTA lifecycle

- Lifecycle flow:
  - initial base firmware flash
  - AP provisioning on device (SSID/password/topic)
  - registration completion call to app API
  - OTA push trigger from dashboard over MQTT
  - device downloads `.bin` from app HTTP OTA endpoint and flashes
- Firmware artifacts are stored in `uploads/firmware` and indexed in `firmware_builds`.
- OTA pushes are audit-logged in `ota_update_logs`.

### Firmware templates (ESP32 + ESP-01)

- **Base server URL**: firmware templates use `BASE_SERVER_URL` (default `http://localhost:3004`) to call:
  - `POST /api/iot/register/complete`
  - `POST /api/iot/status`
- **Provisioning trigger**: on-device provisioning AP can be forced by **3 resets within ~3 seconds**.
  - This **does not erase** stored WiFi/topic settings; the stored config is only overwritten when you submit new values in the AP portal.
  - The reset counter is cleared when AP mode is entered, so **resetting while in AP mode returns to normal boot** (unless you triple-reset again).
  - Implementation detail:
    - **ESP32**: uses `Preferences` (namespace `"rst"`, key `"cnt"`) as a boot counter that auto-clears after ~3 seconds of uptime.
    - **ESP-01**: uses a single EEPROM byte at address **1023** as the same boot counter (auto-clears after ~3 seconds of uptime).
- **Provisioning UI**: the AP portal uses a simple mobile-friendly form UI (SSID, password, topic prefix) on both ESP32 and ESP-01 templates.
- **Firmware version**:
  - Starts at **`v1.0.0`** by default.
  - Updated and persisted **only after a successful OTA** (using the `version` field from the OTA command payload).
- **OTA MQTT payload**: devices expect a small JSON body:
  - `action`
  - `url`
  - `version`

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