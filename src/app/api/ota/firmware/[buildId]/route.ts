import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { OTA_UPLOAD_DIR } from "@/lib/ota";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ buildId: string }> };

function isAdmin(role?: string) {
  return role === "admin";
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { buildId } = await params;
  if (!UUID_RE.test(buildId)) {
    return NextResponse.json({ error: "Invalid build id" }, { status: 400 });
  }

  try {
    const existing = await query<{ file_path: string }>(
      "SELECT file_path FROM firmware_builds WHERE id = $1",
      [buildId],
    );
    if (existing.rowCount === 0) {
      return NextResponse.json({ error: "Firmware build not found" }, { status: 404 });
    }

    const filePath = path.resolve(path.join(OTA_UPLOAD_DIR, existing.rows[0].file_path));
    const baseDir = path.resolve(OTA_UPLOAD_DIR) + path.sep;
    if (!filePath.startsWith(baseDir)) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    await query("DELETE FROM firmware_builds WHERE id = $1", [buildId]);
    await fs.unlink(filePath).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/ota/firmware/:buildId DELETE]", err);
    return NextResponse.json(
      { error: "Failed to delete firmware build" },
      { status: 500 },
    );
  }
}
