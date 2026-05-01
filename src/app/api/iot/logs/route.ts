import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";

function isAdmin(role?: string) {
  return role === "admin";
}

type LogSource = "device" | "ota";

type DeviceLogRow = {
  source: LogSource;
  id: string;
  map_id: string;
  device_id: string;
  kind: string;
  state: boolean | null;
  firmware_version: string | null;
  detail: string | null;
  created_at: string;
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const mapId = searchParams.get("mapId");
  const deviceId = searchParams.get("deviceId");
  const source = searchParams.get("source") as LogSource | null;
  const kind = searchParams.get("kind");
  const from = searchParams.get("from"); // ISO string
  const to = searchParams.get("to"); // ISO string
  const q = searchParams.get("q");

  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");
  const limit = Math.max(1, Math.min(200, Number(limitRaw ?? 100) || 100));
  const offset = Math.max(0, Number(offsetRaw ?? 0) || 0);

  const where: string[] = [];
  const values: (string | number)[] = [];
  let p = 1;

  if (mapId) {
    where.push(`l.map_id = $${p++}`);
    values.push(mapId);
  }
  if (deviceId) {
    where.push(`l.device_id = $${p++}`);
    values.push(deviceId);
  }
  if (source === "device" || source === "ota") {
    where.push(`l.source = $${p++}`);
    values.push(source);
  }
  if (kind) {
    where.push(`l.kind = $${p++}`);
    values.push(kind);
  }
  if (from) {
    where.push(`l.created_at >= $${p++}::timestamptz`);
    values.push(from);
  }
  if (to) {
    where.push(`l.created_at <= $${p++}::timestamptz`);
    values.push(to);
  }
  if (q) {
    where.push(`COALESCE(l.detail, '') ILIKE $${p++}`);
    values.push(`%${q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const rows = await query<DeviceLogRow>(
      `
      WITH logs AS (
        SELECT
          'device'::text AS source,
          id,
          map_id,
          device_id,
          event_type AS kind,
          state,
          firmware_version,
          detail,
          created_at
        FROM iot_device_logs
        UNION ALL
        SELECT
          'ota'::text AS source,
          l.id,
          l.map_id,
          l.device_id,
          l.status AS kind,
          NULL::boolean AS state,
          b.version AS firmware_version,
          l.detail,
          l.created_at
        FROM ota_update_logs l
        JOIN firmware_builds b ON b.id = l.firmware_build_id
      )
      SELECT
        l.source,
        l.id,
        l.map_id,
        l.device_id,
        l.kind,
        l.state,
        l.firmware_version,
        l.detail,
        l.created_at
      FROM logs l
      ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT $${p++} OFFSET $${p++}
      `,
      [...values, limit, offset],
    );

    const countResult = await query<{ count: string }>(
      `
      WITH logs AS (
        SELECT 'device'::text AS source, id, map_id, device_id, event_type AS kind, detail, created_at FROM iot_device_logs
        UNION ALL
        SELECT 'ota'::text AS source, l.id, l.map_id, l.device_id, l.status AS kind, l.detail, l.created_at
        FROM ota_update_logs l
      )
      SELECT COUNT(*)::text AS count
      FROM logs l
      ${whereSql}
      `,
      values,
    );

    return NextResponse.json({
      logs: rows.rows,
      total: Number(countResult.rows[0]?.count ?? "0"),
      limit,
      offset,
    });
  } catch (err) {
    console.error("[api/iot/logs GET]", err);
    return NextResponse.json({ error: "Failed to load device logs" }, { status: 500 });
  }
}

