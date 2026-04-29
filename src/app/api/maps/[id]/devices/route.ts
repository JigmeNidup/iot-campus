import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { deviceSchema } from "@/lib/validators";
import { mapRowToIotDevice, type CampusMapRow, type IotDeviceRow } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> };

async function getOwnedMap(mapId: string, userId: string) {
  return query<Pick<CampusMapRow, "id" | "user_id" | "view_box_width" | "view_box_height">>(
    "SELECT id, user_id, view_box_width, view_box_height FROM campus_maps WHERE id = $1 AND user_id = $2",
    [mapId, userId],
  );
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid map id" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const mapResult = await getOwnedMap(id, session.user.id);
    if (mapResult.rowCount === 0) {
      return NextResponse.json({ error: "Map not found or not yours" }, { status: 404 });
    }

    const result = await query<IotDeviceRow>(
      "SELECT * FROM iot_devices WHERE map_id = $1 ORDER BY created_at ASC",
      [id],
    );

    return NextResponse.json({ devices: result.rows.map(mapRowToIotDevice) });
  } catch (err) {
    console.error("[api/maps/:id/devices GET]", err);
    return NextResponse.json(
      { error: "Failed to load devices" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid map id" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = deviceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const mapResult = await getOwnedMap(id, session.user.id);
    if (mapResult.rowCount === 0) {
      return NextResponse.json({ error: "Map not found or not yours" }, { status: 404 });
    }

    const map = mapResult.rows[0];
    const { name, type, positionX, positionY, buildingId, locked, temperature, humidity } =
      parsed.data;

    let resolvedX = positionX;
    let resolvedY = positionY;

    if (type === "temp_humidity") {
      const sensorResult = await query<{ id: string }>(
        "SELECT id FROM iot_devices WHERE map_id = $1 AND type = 'temp_humidity' LIMIT 1",
        [id],
      );
      if (sensorResult.rowCount && sensorResult.rowCount > 0) {
        return NextResponse.json(
          { error: "Only one temperature/humidity sensor is allowed per map" },
          { status: 400 },
        );
      }
      resolvedX = resolvedX ?? 0;
      resolvedY = resolvedY ?? 0;
    }

    if (buildingId && (resolvedX === undefined || resolvedY === undefined)) {
      const buildingResult = await query<{ center_x: number | string; center_y: number | string }>(
        "SELECT center_x, center_y FROM buildings WHERE id = $1 AND map_id = $2",
        [buildingId, id],
      );
      if (buildingResult.rowCount === 0) {
        return NextResponse.json({ error: "Building not found in map" }, { status: 400 });
      }
      const b = buildingResult.rows[0];
      resolvedX = typeof b.center_x === "string" ? parseFloat(b.center_x) : b.center_x;
      resolvedY = typeof b.center_y === "string" ? parseFloat(b.center_y) : b.center_y;
    }

    if (resolvedX === undefined || resolvedY === undefined) {
      return NextResponse.json(
        { error: "Device position is required for non-building placement" },
        { status: 400 },
      );
    }

    if (resolvedX > map.view_box_width || resolvedY > map.view_box_height) {
      return NextResponse.json(
        { error: "Device position is outside the map bounds" },
        { status: 400 },
      );
    }

    const insertResult = await query<IotDeviceRow>(
      `INSERT INTO iot_devices (
         map_id, building_id, name, type, state, locked, temperature, humidity, position_x, position_y, mqtt_topic_prefix
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '')
       RETURNING *`,
      [
        id,
        type === "temp_humidity" ? null : buildingId ?? null,
        name,
        type,
        false,
        locked ?? false,
        temperature ?? null,
        humidity ?? null,
        resolvedX,
        resolvedY,
      ],
    );
    const created = insertResult.rows[0];
    const topicPrefix = `campus/${id}/device/${created.id}`;

    const updatedResult = await query<IotDeviceRow>(
      "UPDATE iot_devices SET mqtt_topic_prefix = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [topicPrefix, created.id],
    );

    return NextResponse.json({ device: mapRowToIotDevice(updatedResult.rows[0]) }, { status: 201 });
  } catch (err) {
    console.error("[api/maps/:id/devices POST]", err);
    return NextResponse.json(
      { error: "Failed to create device" },
      { status: 500 },
    );
  }
}
