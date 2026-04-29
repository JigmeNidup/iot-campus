import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { updateDeviceSchema } from "@/lib/validators";
import { mapRowToIotDevice, type CampusMapRow, type IotDeviceRow } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string; deviceId: string }> };

export async function PUT(req: Request, { params }: RouteContext) {
  const { id, deviceId } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid map id" }, { status: 400 });
  }
  if (!UUID_RE.test(deviceId)) {
    return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
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

  const parsed = updateDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const mapResult = await query<Pick<CampusMapRow, "id" | "view_box_width" | "view_box_height">>(
      "SELECT id, view_box_width, view_box_height FROM campus_maps WHERE id = $1 AND user_id = $2",
      [id, session.user.id],
    );
    if (mapResult.rowCount === 0) {
      return NextResponse.json({ error: "Map not found or not yours" }, { status: 404 });
    }
    const map = mapResult.rows[0];

    const data = parsed.data;
    if (
      (data.positionX !== undefined && data.positionX > map.view_box_width) ||
      (data.positionY !== undefined && data.positionY > map.view_box_height)
    ) {
      return NextResponse.json(
        { error: "Device position is outside the map bounds" },
        { status: 400 },
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let p = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${p++}`);
      values.push(data.name);
    }
    if (data.type !== undefined) {
      updates.push(`type = $${p++}`);
      values.push(data.type);
    }
    if (data.positionX !== undefined) {
      updates.push(`position_x = $${p++}`);
      values.push(data.positionX);
    }
    if (data.positionY !== undefined) {
      updates.push(`position_y = $${p++}`);
      values.push(data.positionY);
    }
    if (data.buildingId !== undefined) {
      updates.push(`building_id = $${p++}`);
      values.push(data.buildingId ?? null);
    }
    if (data.state !== undefined) {
      updates.push(`state = $${p++}`);
      values.push(data.state);
    }
    if (data.locked !== undefined) {
      updates.push(`locked = $${p++}`);
      values.push(data.locked);
    }
    if (data.temperature !== undefined) {
      updates.push(`temperature = $${p++}`);
      values.push(data.temperature);
    }
    if (data.humidity !== undefined) {
      updates.push(`humidity = $${p++}`);
      values.push(data.humidity);
    }
    updates.push("updated_at = NOW()");

    values.push(deviceId, id);
    const result = await query<IotDeviceRow>(
      `UPDATE iot_devices
       SET ${updates.join(", ")}
       WHERE id = $${p++} AND map_id = $${p}
       RETURNING *`,
      values,
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    return NextResponse.json({ device: mapRowToIotDevice(result.rows[0]) });
  } catch (err) {
    console.error("[api/maps/:id/devices/:deviceId PUT]", err);
    return NextResponse.json(
      { error: "Failed to update device" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { id, deviceId } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid map id" }, { status: 400 });
  }
  if (!UUID_RE.test(deviceId)) {
    return NextResponse.json({ error: "Invalid device id" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await query(
      `DELETE FROM iot_devices d
       USING campus_maps m
       WHERE d.id = $1 AND d.map_id = $2 AND m.id = d.map_id AND m.user_id = $3`,
      [deviceId, id, session.user.id],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Device not found or not yours" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/maps/:id/devices/:deviceId DELETE]", err);
    return NextResponse.json(
      { error: "Failed to delete device" },
      { status: 500 },
    );
  }
}
