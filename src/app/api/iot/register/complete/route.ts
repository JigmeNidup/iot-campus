import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { registerCompleteSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = registerCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    mapId,
    deviceId,
    registrationToken,
    boardTarget,
    wifiSsid,
    mqttTopicPrefix,
    firmwareVersion,
  } = parsed.data;

  try {
    const result = await query(
      `UPDATE iot_devices
       SET board_target = $1,
           wifi_ssid = $2,
           mqtt_topic_prefix = $3,
           firmware_version = $4,
           ota_status = 'registered',
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $5 AND map_id = $6 AND registration_token = $7
       RETURNING id`,
      [
        boardTarget,
        wifiSsid,
        mqttTopicPrefix,
        firmwareVersion,
        deviceId,
        mapId,
        registrationToken,
      ],
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Registration token invalid or device not found" },
        { status: 401 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/iot/register/complete POST]", err);
    return NextResponse.json(
      { error: "Failed to complete registration" },
      { status: 500 },
    );
  }
}
