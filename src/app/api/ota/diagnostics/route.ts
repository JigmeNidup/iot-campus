import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import type { FirmwareBuildRow, IotDeviceRow } from "@/lib/utils";

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
  };
  if (!input.mapId || !input.deviceId || !input.firmwareBuildId) {
    return NextResponse.json(
      { error: "mapId, deviceId and firmwareBuildId are required" },
      { status: 400 },
    );
  }

  try {
    const mapCheck = await query<{ id: string }>(
      "SELECT id FROM campus_maps WHERE id = $1 AND user_id = $2",
      [input.mapId, session.user.id],
    );
    if (mapCheck.rowCount === 0) {
      return NextResponse.json({ error: "Map not found or not yours" }, { status: 404 });
    }

    const deviceResult = await query<IotDeviceRow>(
      "SELECT * FROM iot_devices WHERE id = $1 AND map_id = $2",
      [input.deviceId, input.mapId],
    );
    if (deviceResult.rowCount === 0) {
      return NextResponse.json({ error: "Device not found in selected map" }, { status: 404 });
    }

    const buildResult = await query<FirmwareBuildRow>(
      "SELECT * FROM firmware_builds WHERE id = $1",
      [input.firmwareBuildId],
    );
    if (buildResult.rowCount === 0) {
      return NextResponse.json({ error: "Firmware build not found" }, { status: 404 });
    }

    const device = deviceResult.rows[0];
    const build = buildResult.rows[0];
    const broker =
      process.env.MQTT_PUSH_BROKER_URL || "wss://broker.hivemq.com:8884/mqtt";
    const canonicalTopic = `campus/${input.mapId}/device/${input.deviceId}/ota/update`;
    const dbTopic = `${device.mqtt_topic_prefix}/ota/update`;
    const topics = canonicalTopic === dbTopic ? [canonicalTopic] : [canonicalTopic, dbTopic];

    const reqUrl = new URL(req.url);
    const forwardedProto = req.headers.get("x-forwarded-proto");
    const forwardedHost = req.headers.get("x-forwarded-host");
    const host = forwardedHost || req.headers.get("host");
    const origin =
      process.env.NEXTAUTH_URL ||
      (host
        ? `${forwardedProto || reqUrl.protocol.replace(":", "")}://${host}`
        : `${reqUrl.protocol}//${reqUrl.host}`);

    const downloadUrl = `${origin}/api/ota/firmware/${input.firmwareBuildId}/download`;

    const payload = {
      action: "update",
      url: downloadUrl,
      version: build.version,
    };

    return NextResponse.json({
      ok: true,
      diagnostics: {
        broker,
        topic: canonicalTopic,
        topics,
        origin,
        compatibility: {
          deviceTypeMatchesBuild: device.type === build.device_type,
          boardTargetMatchesBuild:
            (device.board_target || "unknown") === build.board_target,
        },
        payload,
      },
    });
  } catch (err) {
    console.error("[api/ota/diagnostics POST]", err);
    return NextResponse.json(
      { error: "Failed to generate OTA diagnostics" },
      { status: 500 },
    );
  }
}
