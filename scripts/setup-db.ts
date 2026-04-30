import { config } from "dotenv";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

config({ path: ".env.local" });
config();

const c = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

function step(label: string) {
  console.log(`${c.cyan}${c.bold}>${c.reset} ${label}`);
}

function ok(label: string) {
  console.log(`  ${c.green}OK${c.reset}  ${label}`);
}

function warn(label: string) {
  console.log(`  ${c.yellow}!!${c.reset}  ${label}`);
}

const SCHEMA_STATEMENTS: { label: string; sql: string }[] = [
  {
    label: "ensure pgcrypto extension (for gen_random_uuid)",
    sql: `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  },
  {
    label: "create users table",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
  },
  {
    label: "create campus_maps table",
    sql: `
      CREATE TABLE IF NOT EXISTS campus_maps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        image_url VARCHAR(500) NOT NULL,
        view_box_width INTEGER DEFAULT 800,
        view_box_height INTEGER DEFAULT 600,
        is_published BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
  },
  {
    label: "create buildings table",
    sql: `
      CREATE TABLE IF NOT EXISTS buildings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        map_id UUID NOT NULL REFERENCES campus_maps(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        abbreviation VARCHAR(10) NOT NULL,
        category VARCHAR(50) NOT NULL CHECK (category IN ('academic','residence','dining','parking','athletics','admin','other')),
        description TEXT,
        polygon_points JSONB NOT NULL,
        center_x FLOAT NOT NULL,
        center_y FLOAT NOT NULL,
        floors INTEGER,
        departments TEXT[] DEFAULT '{}',
        color VARCHAR(7),
        image_url VARCHAR(500),
        sort_order INTEGER DEFAULT 0,
        locked BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
  },
  {
    label: "create iot_devices table",
    sql: `
      CREATE TABLE IF NOT EXISTS iot_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        map_id UUID NOT NULL REFERENCES campus_maps(id) ON DELETE CASCADE,
        building_id UUID REFERENCES buildings(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('light', 'water_valve', 'temp_humidity')),
        state BOOLEAN DEFAULT false,
        locked BOOLEAN NOT NULL DEFAULT false,
        temperature FLOAT,
        humidity FLOAT,
        position_x FLOAT NOT NULL,
        position_y FLOAT NOT NULL,
        mqtt_topic_prefix VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
  },
  {
    label: "create firmware_builds table",
    sql: `
      CREATE TABLE IF NOT EXISTS firmware_builds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_type VARCHAR(50) NOT NULL CHECK (device_type IN ('light', 'water_valve', 'temp_humidity')),
        board_target VARCHAR(20) NOT NULL CHECK (board_target IN ('esp32', 'esp01')),
        version VARCHAR(100) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        checksum VARCHAR(128) NOT NULL,
        size_bytes INTEGER NOT NULL,
        changelog TEXT,
        created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
  },
  {
    label: "create ota_update_logs table",
    sql: `
      CREATE TABLE IF NOT EXISTS ota_update_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        map_id UUID NOT NULL REFERENCES campus_maps(id) ON DELETE CASCADE,
        device_id UUID NOT NULL REFERENCES iot_devices(id) ON DELETE CASCADE,
        firmware_build_id UUID NOT NULL REFERENCES firmware_builds(id) ON DELETE CASCADE,
        triggered_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'queued',
        detail TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
  },
  {
    label: "create iot_device_logs table",
    sql: `
      CREATE TABLE IF NOT EXISTS iot_device_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        map_id UUID NOT NULL REFERENCES campus_maps(id) ON DELETE CASCADE,
        device_id UUID NOT NULL REFERENCES iot_devices(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        state BOOLEAN,
        firmware_version VARCHAR(100),
        detail TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
  },
  {
    label: "ensure buildings.locked column (idempotent migration)",
    sql: `ALTER TABLE buildings ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false`,
  },
  {
    label: "ensure buildings.image_url column (idempotent migration)",
    sql: `ALTER TABLE buildings ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)`,
  },
  {
    label: "ensure iot_devices.locked column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false`,
  },
  {
    label: "ensure iot_devices.temperature column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS temperature FLOAT`,
  },
  {
    label: "ensure iot_devices.humidity column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS humidity FLOAT`,
  },
  {
    label: "ensure iot_devices.board_target column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS board_target VARCHAR(20)`,
  },
  {
    label: "ensure iot_devices.firmware_version column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(100)`,
  },
  {
    label: "ensure iot_devices.wifi_ssid column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(255)`,
  },
  {
    label: "ensure iot_devices.ota_status column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS ota_status VARCHAR(50)`,
  },
  {
    label: "ensure iot_devices.last_seen_at column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`,
  },
  {
    label: "ensure iot_devices.registration_token column (idempotent migration)",
    sql: `ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS registration_token VARCHAR(255)`,
  },
  {
    label: "create idx_campus_maps_user_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_campus_maps_user_id ON campus_maps(user_id)`,
  },
  {
    label: "create idx_buildings_map_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_buildings_map_id ON buildings(map_id)`,
  },
  {
    label: "create idx_buildings_category",
    sql: `CREATE INDEX IF NOT EXISTS idx_buildings_category ON buildings(category)`,
  },
  {
    label: "create idx_iot_devices_map_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_iot_devices_map_id ON iot_devices(map_id)`,
  },
  {
    label: "create idx_iot_devices_building_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_iot_devices_building_id ON iot_devices(building_id)`,
  },
  {
    label: "create idx_firmware_builds_device_board_version",
    sql: `CREATE INDEX IF NOT EXISTS idx_firmware_builds_device_board_version ON firmware_builds(device_type, board_target, version)`,
  },
  {
    label: "create idx_ota_update_logs_device_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_ota_update_logs_device_id ON ota_update_logs(device_id)`,
  },
  {
    label: "create idx_ota_update_logs_map_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_ota_update_logs_map_id ON ota_update_logs(map_id)`,
  },
  {
    label: "create idx_iot_device_logs_device_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_iot_device_logs_device_id ON iot_device_logs(device_id)`,
  },
  {
    label: "create idx_iot_device_logs_map_id",
    sql: `CREATE INDEX IF NOT EXISTS idx_iot_device_logs_map_id ON iot_device_logs(map_id)`,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(`${c.red}DATABASE_URL is not set in .env.local${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.bold}Campus Map :: database setup${c.reset}\n`);
  step(`connecting to ${maskUrl(url)}`);
  const pool = new Pool({ connectionString: url });

  try {
    await pool.query("SELECT 1");
    ok("connected");

    for (const stmt of SCHEMA_STATEMENTS) {
      step(stmt.label);
      await pool.query(stmt.sql);
      ok("done");
    }

    step("seed admin user");
    const email = "admin@campusmap.com";
    const password = "admin123";
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [email, "Administrator", passwordHash, "admin"],
    );
    if (result.rowCount && result.rowCount > 0) {
      ok(`admin user created (${email} / ${password})`);
    } else {
      warn(`admin user already existed (${email}) - left untouched`);
    }

    console.log(`\n${c.green}${c.bold}Setup complete.${c.reset}`);
  } catch (err) {
    console.error(`\n${c.red}Setup failed:${c.reset}`, err);
    process.exitCode = 1;
  } finally {
    await pool.end();
    process.exit(process.exitCode ?? 0);
  }
}

function maskUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

void main();
