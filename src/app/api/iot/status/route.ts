import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { deviceBootLogSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = deviceBootLogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    mapId,
    deviceId,
    state,
    firmwareVersion,
    wifiSsid,
    mqttTopicPrefix,
    boardTarget,
  } = parsed.data;

  try {
    const updated = await query<{ id: string }>(
      `UPDATE iot_devices
       SET state = $1,
           firmware_version = $2,
           wifi_ssid = COALESCE($3, wifi_ssid),
           mqtt_topic_prefix = COALESCE($4, mqtt_topic_prefix),
           board_target = COALESCE($5, board_target),
           ota_status = 'online',
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $6 AND map_id = $7
       RETURNING id`,
      [
        state,
        firmwareVersion,
        wifiSsid ?? null,
        mqttTopicPrefix ?? null,
        boardTarget ?? null,
        deviceId,
        mapId,
      ],
    );

    if (updated.rowCount === 0) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    await query(
      `INSERT INTO iot_device_logs
       (map_id, device_id, event_type, state, firmware_version, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        mapId,
        deviceId,
        "boot_online",
        state,
        firmwareVersion,
        `wifi=${wifiSsid ?? ""}; topic=${mqttTopicPrefix ?? ""}`,
      ],
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/iot/status POST]", err);
    return NextResponse.json({ error: "Failed to store device status" }, { status: 500 });
  }
}
