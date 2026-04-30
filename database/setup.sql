-- =============================================================================
-- Campus Map :: full database setup
-- =============================================================================
--
-- Usage (PowerShell):
--   psql -U postgres -f database/setup.sql
--
-- This file is split into two sections:
--   Section 1 - Create the role and database (run as a Postgres superuser
--               while connected to any database, e.g. `postgres`).
--   Section 2 - Schema, indexes, default admin (runs inside `campusmap`).
--
-- The script is safe to re-run: every CREATE / ALTER statement that supports
-- IF NOT EXISTS uses it, and the admin INSERT uses ON CONFLICT DO NOTHING.
-- The two CREATE statements in section 1 will fail on re-runs (the role and
-- database already exist) - that is expected; just ignore those errors.
-- =============================================================================


-- =============================================================================
-- Section 1 :: role + database  (run as superuser, e.g. `postgres`)
-- =============================================================================

CREATE USER iot_iot_campusmap_admin WITH PASSWORD 'mypassword';

CREATE DATABASE iot_campusmap
    WITH
    OWNER = iot_iot_campusmap_admin
    ENCODING = 'UTF8'
    LOCALE_PROVIDER = 'libc'
    CONNECTION LIMIT = -1
    IS_TEMPLATE = False;


-- Switch the psql session into the new database for the rest of the file.
\connect campusmap


-- =============================================================================
-- Section 2 :: schema  (runs inside the `campusmap` database)
-- =============================================================================

-- Allow iot_campusmap_admin to create objects inside the public schema
-- (Postgres 15+ locked this down by default).
GRANT USAGE, CREATE ON SCHEMA public TO iot_campusmap_admin;

-- pgcrypto provides:
--   * gen_random_uuid() for primary keys
--   * crypt() + gen_salt('bf', 12) for bcrypt-compatible password hashes
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ---- users -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- ---- campus_maps -------------------------------------------------------------
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
);


-- ---- buildings ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buildings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID NOT NULL REFERENCES campus_maps(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    abbreviation VARCHAR(10) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN (
        'academic','residence','dining','parking','athletics','admin','other'
    )),
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
);

-- ---- iot_devices -------------------------------------------------------------
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
    board_target VARCHAR(20) CHECK (board_target IN ('esp32', 'esp01')),
    firmware_version VARCHAR(100),
    wifi_ssid VARCHAR(255),
    ota_status VARCHAR(50),
    last_seen_at TIMESTAMPTZ,
    registration_token VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---- firmware_builds ----------------------------------------------------------
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
);

-- ---- ota_update_logs ----------------------------------------------------------
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
);

-- ---- iot_device_logs ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS iot_device_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID NOT NULL REFERENCES campus_maps(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES iot_devices(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    state BOOLEAN,
    firmware_version VARCHAR(100),
    detail TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ---- idempotent migrations for older databases -------------------------------
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS locked    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS temperature FLOAT;
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS humidity FLOAT;
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS board_target VARCHAR(20);
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(100);
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(255);
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS ota_status VARCHAR(50);
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE iot_devices ADD COLUMN IF NOT EXISTS registration_token VARCHAR(255);


-- ---- indexes -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campus_maps_user_id ON campus_maps(user_id);
CREATE INDEX IF NOT EXISTS idx_buildings_map_id    ON buildings(map_id);
CREATE INDEX IF NOT EXISTS idx_buildings_category  ON buildings(category);
CREATE INDEX IF NOT EXISTS idx_iot_devices_map_id ON iot_devices(map_id);
CREATE INDEX IF NOT EXISTS idx_iot_devices_building_id ON iot_devices(building_id);
CREATE INDEX IF NOT EXISTS idx_firmware_builds_device_board_version ON firmware_builds(device_type, board_target, version);
CREATE INDEX IF NOT EXISTS idx_ota_update_logs_device_id ON ota_update_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_ota_update_logs_map_id ON ota_update_logs(map_id);
CREATE INDEX IF NOT EXISTS idx_iot_device_logs_device_id ON iot_device_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_iot_device_logs_map_id ON iot_device_logs(map_id);


-- ---- default administrator ---------------------------------------------------
-- Email:    admin@campusmap.com
-- Password: admin123
-- The hash is generated by pgcrypto's bcrypt (`bf`) with cost 12. bcryptjs in
-- the Node app reads the embedded algorithm/salt/cost and verifies correctly.
INSERT INTO users (email, name, password_hash, role)
VALUES (
    'admin@campusmap.com',
    'Administrator',
    crypt('admin123', gen_salt('bf', 12)),
    'admin'
)
ON CONFLICT (email) DO NOTHING;


-- ---- ownership ---------------------------------------------------------------
-- If you ran this whole file as the `postgres` superuser, the tables above are
-- owned by `postgres`. Hand them over to the application role so it can write.
ALTER TABLE users        OWNER TO iot_campusmap_admin;
ALTER TABLE campus_maps  OWNER TO iot_campusmap_admin;
ALTER TABLE buildings    OWNER TO iot_campusmap_admin;
ALTER TABLE iot_devices  OWNER TO iot_campusmap_admin;
ALTER TABLE firmware_builds OWNER TO iot_campusmap_admin;
ALTER TABLE ota_update_logs OWNER TO iot_campusmap_admin;
ALTER TABLE iot_device_logs OWNER TO iot_campusmap_admin;

-- Default privileges for any future objects created by `postgres` in `public`.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES    TO iot_campusmap_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO iot_campusmap_admin;
