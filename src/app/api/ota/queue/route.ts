import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(role?: string) {
  return role === "admin";
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = body as {
    mapId?: string;
    deviceId?: string;
    firmwareBuildId?: string;
    detail?: string;
  };
  if (!input.mapId || !input.deviceId || !input.firmwareBuildId) {
    return NextResponse.json(
      { error: "mapId, deviceId and firmwareBuildId are required" },
      { status: 400 },
    );
  }

  try {
    await query(
      `INSERT INTO ota_update_logs
       (map_id, device_id, firmware_build_id, triggered_by_user_id, status, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.mapId,
        input.deviceId,
        input.firmwareBuildId,
        session.user.id,
        "queued",
        input.detail ?? "mqtt dispatched from frontend",
      ],
    );
    await query(
      "UPDATE iot_devices SET ota_status = 'queued', updated_at = NOW() WHERE id = $1 AND map_id = $2",
      [input.deviceId, input.mapId],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/ota/queue POST]", err);
    return NextResponse.json({ error: "Failed to queue OTA update" }, { status: 500 });
  }
}
