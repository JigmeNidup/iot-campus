import { NextResponse } from "next/server";
import mqtt from "mqtt";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { createOtaToken } from "@/lib/ota";
import { otaPushSchema } from "@/lib/validators";
import type { IotDeviceRow, FirmwareBuildRow } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(role?: string) {
  return role === "admin";
}

function publishMqtt(topic: string, payload: string) {
  const broker = process.env.MQTT_PUSH_BROKER_URL || "mqtt://broker.hivemq.com:1883";
  return new Promise<void>((resolve, reject) => {
    const client = mqtt.connect(broker, { reconnectPeriod: 0, connectTimeout: 10000 });
    client.once("connect", () => {
      client.publish(topic, payload, (err?: Error) => {
        client.end(true);
        if (err) reject(err);
        else resolve();
      });
    });
    client.once("error", (err: Error) => {
      client.end(true);
      reject(err);
    });
  });
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

  const parsed = otaPushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { mapId, deviceIds, firmwareBuildId } = parsed.data;
  const targetDeviceId = deviceIds[0];

  try {
    const mapCheck = await query<{ id: string }>(
      "SELECT id FROM campus_maps WHERE id = $1 AND user_id = $2",
      [mapId, session.user.id],
    );
    if (mapCheck.rowCount === 0) {
      return NextResponse.json({ error: "Map not found or not yours" }, { status: 404 });
    }

    const fwResult = await query<FirmwareBuildRow>(
      "SELECT * FROM firmware_builds WHERE id = $1",
      [firmwareBuildId],
    );
    if (fwResult.rowCount === 0) {
      return NextResponse.json({ error: "Firmware build not found" }, { status: 404 });
    }
    const fw = fwResult.rows[0];

    const devicesResult = await query<IotDeviceRow>(
      `SELECT * FROM iot_devices
       WHERE map_id = $1 AND id = $2`,
      [mapId, targetDeviceId],
    );
    if (devicesResult.rowCount === 0) {
      return NextResponse.json({ error: "No target devices found" }, { status: 404 });
    }

    const outcomes: Array<{ deviceId: string; topic: string; ok: boolean; error?: string }> = [];
    for (const device of devicesResult.rows) {
      const token = createOtaToken({
        buildId: firmwareBuildId,
        deviceId: device.id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      const otaTopic = `${device.mqtt_topic_prefix}/ota/update`;
      const downloadUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3004"}/api/ota/firmware/${firmwareBuildId}/download?token=${encodeURIComponent(token)}`;
      const payload = JSON.stringify({
        buildId: firmwareBuildId,
        version: fw.version,
        checksum: fw.checksum,
        downloadUrl,
      });

      try {
        await publishMqtt(otaTopic, payload);
        await query(
          `INSERT INTO ota_update_logs
           (map_id, device_id, firmware_build_id, triggered_by_user_id, status, detail)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [mapId, device.id, firmwareBuildId, session.user.id, "queued", "mqtt dispatched"],
        );
        await query(
          "UPDATE iot_devices SET ota_status = 'queued', updated_at = NOW() WHERE id = $1",
          [device.id],
        );
        outcomes.push({ deviceId: device.id, topic: otaTopic, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "publish failed";
        outcomes.push({ deviceId: device.id, topic: otaTopic, ok: false, error: message });
      }
    }

    return NextResponse.json({ outcomes });
  } catch (err) {
    console.error("[api/ota/push POST]", err);
    return NextResponse.json({ error: "Failed to push OTA update" }, { status: 500 });
  }
}
