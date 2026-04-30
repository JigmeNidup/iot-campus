import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Deprecated endpoint. OTA publish now happens from frontend MQTT client. Use /api/ota/diagnostics and /api/ota/queue.",
    },
    { status: 410 },
  );
}
