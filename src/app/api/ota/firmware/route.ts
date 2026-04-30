import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { firmwareBuildSchema } from "@/lib/validators";
import { mapRowToFirmwareBuild, type FirmwareBuildRow } from "@/lib/utils";
import { OTA_UPLOAD_DIR, sha256Hex } from "@/lib/ota";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAdmin(role?: string) {
  return role === "admin";
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const deviceType = searchParams.get("deviceType");
  const boardTarget = searchParams.get("boardTarget");

  const where: string[] = [];
  const values: string[] = [];
  let p = 1;
  if (deviceType) {
    where.push(`device_type = $${p++}`);
    values.push(deviceType);
  }
  if (boardTarget) {
    where.push(`board_target = $${p++}`);
    values.push(boardTarget);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const result = await query<FirmwareBuildRow>(
      `SELECT * FROM firmware_builds ${whereSql} ORDER BY created_at DESC`,
      values,
    );
    return NextResponse.json({ builds: result.rows.map(mapRowToFirmwareBuild) });
  } catch (err) {
    console.error("[api/ota/firmware GET]", err);
    return NextResponse.json(
      { error: "Failed to load firmware builds" },
      { status: 500 },
    );
  }
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

  const parsed = firmwareBuildSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    deviceType,
    boardTarget,
    version,
    changelog,
    binaryBase64,
    originalFileName,
  } = parsed.data;

  try {
    const buffer = Buffer.from(binaryBase64, "base64");
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Binary content is empty" }, { status: 400 });
    }

    await fs.mkdir(OTA_UPLOAD_DIR, { recursive: true });
    const sanitizedOriginal = originalFileName
      ? originalFileName
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "")
      : "";
    const fallbackBase = `${deviceType}-${boardTarget}-${version.replace(/[^a-zA-Z0-9._-]/g, "_")}.bin`;
    const preservedName = sanitizedOriginal || fallbackBase;
    const fileName = `${randomUUID()}-${preservedName}`;
    const fullPath = path.join(OTA_UPLOAD_DIR, fileName);
    await fs.writeFile(fullPath, buffer);

    const checksum = sha256Hex(buffer);
    const result = await query<FirmwareBuildRow>(
      `INSERT INTO firmware_builds
       (device_type, board_target, version, file_path, checksum, size_bytes, changelog, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        deviceType,
        boardTarget,
        version,
        fileName,
        checksum,
        buffer.byteLength,
        changelog ?? null,
        session.user.id,
      ],
    );

    return NextResponse.json(
      { build: mapRowToFirmwareBuild(result.rows[0]) },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/ota/firmware POST]", err);
    return NextResponse.json(
      { error: "Failed to save firmware build" },
      { status: 500 },
    );
  }
}
