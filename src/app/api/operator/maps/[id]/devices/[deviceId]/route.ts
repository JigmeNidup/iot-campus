import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { mapRowToIotDevice, type IotDeviceRow } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canAccessOperator(role?: string) {
  return role === "operator" || role === "admin";
}

type RouteContext = { params: Promise<{ id: string; deviceId: string }> };

export async function PUT(req: Request, { params }: RouteContext) {
  const { id, deviceId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(deviceId)) {
    return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccessOperator(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const state = (body as { state?: unknown })?.state;
  if (typeof state !== "boolean") {
    return NextResponse.json({ error: "state must be boolean" }, { status: 400 });
  }

  try {
    const result = await query<IotDeviceRow>(
      `UPDATE iot_devices
       SET state = $1, updated_at = NOW()
       WHERE id = $2 AND map_id = $3 AND type IN ('light', 'water_valve')
       RETURNING *`,
      [state, deviceId, id],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    return NextResponse.json({ device: mapRowToIotDevice(result.rows[0]) });
  } catch (err) {
    console.error("[api/operator/maps/:id/devices/:deviceId PUT]", err);
    return NextResponse.json({ error: "Failed to update device" }, { status: 500 });
  }
}
