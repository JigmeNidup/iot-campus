import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DeviceType = "light" | "water_valve" | "temp_humidity";
type BoardTarget = "esp32" | "esp01";

function resolveFirmwarePath(deviceType: DeviceType, board: BoardTarget) {
  const root = process.cwd();
  const rel =
    deviceType === "light"
      ? board === "esp32"
        ? path.join("iot", "light", "light.ino")
        : path.join("iot", "light", "esp01", "light_esp01", "light_esp01.ino")
      : deviceType === "water_valve"
        ? board === "esp32"
          ? path.join("iot", "water_valve", "water_valve.ino")
          : path.join(
              "iot",
              "water_valve",
              "esp01",
              "water_valve_esp01",
              "water_valve_esp01.ino",
            )
        : board === "esp32"
          ? path.join("iot", "temp_humi", "temp_humi.ino")
          : path.join("iot", "temp_humi", "esp01", "temp_humi_esp01", "temp_humi_esp01.ino");
  return path.resolve(path.join(root, rel));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const deviceType = searchParams.get("deviceType") as DeviceType | null;
  const board = searchParams.get("board") as BoardTarget | null;

  if (!deviceType || !board) {
    return NextResponse.json(
      { error: "deviceType and board are required" },
      { status: 400 },
    );
  }
  if (
    !["light", "water_valve", "temp_humidity"].includes(deviceType) ||
    !["esp32", "esp01"].includes(board)
  ) {
    return NextResponse.json({ error: "Invalid deviceType or board" }, { status: 400 });
  }

  try {
    const filePath = resolveFirmwarePath(deviceType, board);
    let content = await fs.readFile(filePath, "utf8");
    const frontendServer = process.env.NEXTAUTH_URL || "http://localhost:3004";
    const registrationToken =
      process.env.REGISTRATION_TOKEN || "campus-reg-token-dev";
    content = content
      .replaceAll(
        /http:\/\/YOUR_SERVER\/api\/iot\/register\/complete/g,
        `${frontendServer}/api/iot/register/complete`,
      )
      .replaceAll(
        /http:\/\/localhost:3004\/api\/iot\/register\/complete/g,
        `${frontendServer}/api/iot/register/complete`,
      )
      .replaceAll(
        /http:\/\/YOUR_SERVER\/api\/iot\/status/g,
        `${frontendServer}/api/iot/status`,
      )
      .replaceAll(
        /http:\/\/localhost:3004\/api\/iot\/status/g,
        `${frontendServer}/api/iot/status`,
      )
      .replaceAll(
        /REPLACE_WITH_REGISTRATION_TOKEN/g,
        registrationToken,
      );
    return NextResponse.json({
      deviceType,
      board,
      path: path.relative(process.cwd(), filePath).replace(/\\/g, "/"),
      content,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Base firmware file not found" }, { status: 404 });
    }
    console.error("[api/programming/base-code GET]", err);
    return NextResponse.json(
      { error: "Failed to read base firmware file" },
      { status: 500 },
    );
  }
}
