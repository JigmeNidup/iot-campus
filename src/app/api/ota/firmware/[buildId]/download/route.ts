import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { query } from "@/lib/db";
import { OTA_UPLOAD_DIR, verifyOtaToken } from "@/lib/ota";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ buildId: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  const { buildId } = await params;
  if (!UUID_RE.test(buildId)) {
    return NextResponse.json({ error: "Invalid build id" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }
  const payload = verifyOtaToken(token);
  if (!payload || payload.buildId !== buildId) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const result = await query<{ file_path: string; checksum: string }>(
      "SELECT file_path, checksum FROM firmware_builds WHERE id = $1",
      [buildId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Firmware build not found" }, { status: 404 });
    }
    const row = result.rows[0];
    const filePath = path.resolve(path.join(OTA_UPLOAD_DIR, row.file_path));
    const baseDir = path.resolve(OTA_UPLOAD_DIR) + path.sep;
    if (!filePath.startsWith(baseDir)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    const buffer = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Length": String(buffer.byteLength),
        "X-Firmware-Sha256": row.checksum,
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Firmware file not found" }, { status: 404 });
    }
    console.error("[api/ota/firmware/:buildId/download GET]", err);
    return NextResponse.json(
      { error: "Failed to download firmware" },
      { status: 500 },
    );
  }
}
