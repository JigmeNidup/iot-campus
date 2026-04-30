import { NextResponse } from "next/server";
import mqtt from "mqtt";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { otaPushSchema } from "@/lib/validators";
import type { IotDeviceRow, FirmwareBuildRow } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(role?: string) {
  return role === "admin";
}

function publishMqtt(topic: string, payload: string) {
  // In hosted/serverless environments raw TCP 1883 is often blocked.
  // Prefer secure websocket broker URL unless explicitly overridden.
  const broker =
    process.env.MQTT_PUSH_BROKER_URL || "wss://broker.hivemq.com:8884/mqtt";
  return new Promise<void>((resolve, reject) => {
    const client = mqtt.connect(broker, {
      reconnectPeriod: 0,
      connectTimeout: 10000,
      protocolVersion: 4,
      clean: true,
    });
    const failTimer = setTimeout(() => {
      client.end(true);
      reject(new Error("MQTT connect timeout"));
    }, 12000);

    client.once("connect", () => {
      clearTimeout(failTimer);
      client.publish(topic, payload, { qos: 1, retain: false }, (err?: Error) => {
        client.end(true);
        if (err) reject(err);
        else resolve();
      });
    });
    client.once("error", (err: Error) => {
      clearTimeout(failTimer);
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
  const reqUrl = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  const origin =
    process.env.NEXTAUTH_URL ||
    (host
      ? `${forwardedProto || reqUrl.protocol.replace(":", "")}://${host}`
      : `${reqUrl.protocol}//${reqUrl.host}`);

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
      const primaryTopic = `${device.mqtt_topic_prefix}/ota/update`;
      const canonicalTopic = `campus/${mapId}/device/${device.id}/ota/update`;
      const topics =
        primaryTopic === canonicalTopic
          ? [primaryTopic]
          : [primaryTopic, canonicalTopic];
      const downloadUrl = `${origin}/api/ota/firmware/${firmwareBuildId}/download`;
      const payload = JSON.stringify({
        action: "update",
        url: downloadUrl,
        version: fw.version,
        buildId: firmwareBuildId,
        checksum: fw.checksum,
        downloadUrl,
      });

      try {
        let delivered = 0;
        for (const topic of topics) {
          await publishMqtt(topic, payload);
          delivered += 1;
        }
        await query(
          `INSERT INTO ota_update_logs
           (map_id, device_id, firmware_build_id, triggered_by_user_id, status, detail)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            mapId,
            device.id,
            firmwareBuildId,
            session.user.id,
            "queued",
            `mqtt dispatched to ${delivered} topic(s): ${topics.join(", ")}`,
          ],
        );
        await query(
          "UPDATE iot_devices SET ota_status = 'queued', updated_at = NOW() WHERE id = $1",
          [device.id],
        );
        outcomes.push({ deviceId: device.id, topic: topics.join(" | "), ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "publish failed";
        outcomes.push({
          deviceId: device.id,
          topic: topics.join(" | "),
          ok: false,
          error: message,
        });
      }
    }

    return NextResponse.json({ outcomes });
  } catch (err) {
    console.error("[api/ota/push POST]", err);
    return NextResponse.json({ error: "Failed to push OTA update" }, { status: 500 });
  }
}
