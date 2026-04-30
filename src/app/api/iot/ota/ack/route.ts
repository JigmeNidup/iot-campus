import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { otaAckSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = otaAckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { deviceId, mapId, status, detail } = parsed.data;

  try {
    await query(
      `UPDATE iot_devices
       SET ota_status = $1, last_seen_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND map_id = $3`,
      [status, deviceId, mapId],
    );
    await query(
      `UPDATE ota_update_logs
       SET status = $1, detail = COALESCE($2, detail), updated_at = NOW()
       WHERE id = (
         SELECT id FROM ota_update_logs
         WHERE device_id = $3
         ORDER BY created_at DESC
         LIMIT 1
       )`,
      [status, detail ?? null, deviceId],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/iot/ota/ack POST]", err);
    return NextResponse.json({ error: "Failed to store OTA ack" }, { status: 500 });
  }
}
