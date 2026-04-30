import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { registerStartSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
  const parsed = registerStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { mapId, deviceId, boardTarget } = parsed.data;

  try {
    const check = await query<{ id: string }>(
      `SELECT d.id FROM iot_devices d
       JOIN campus_maps m ON m.id = d.map_id
       WHERE d.id = $1 AND d.map_id = $2 AND m.user_id = $3`,
      [deviceId, mapId, session.user.id],
    );
    if (check.rowCount === 0) {
      return NextResponse.json({ error: "Device not found or not yours" }, { status: 404 });
    }
    const token = randomUUID() + randomUUID().slice(0, 8);
    await query(
      `UPDATE iot_devices
       SET registration_token = $1, board_target = $2, updated_at = NOW()
       WHERE id = $3`,
      [token, boardTarget, deviceId],
    );
    return NextResponse.json({ registrationToken: token });
  } catch (err) {
    console.error("[api/iot/register/start POST]", err);
    return NextResponse.json({ error: "Failed to start registration" }, { status: 500 });
  }
}
