import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  mapRowToBuilding,
  mapRowToCampusMap,
  type BuildingRow,
  type CampusMapRow,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canAccessOperator(role?: string) {
  return role === "operator" || role === "admin";
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid map id" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccessOperator(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const mapResult = await query<CampusMapRow>(
      "SELECT * FROM campus_maps WHERE id = $1",
      [id],
    );
    if (mapResult.rowCount === 0) {
      return NextResponse.json({ error: "Map not found" }, { status: 404 });
    }

    const buildingResult = await query<BuildingRow>(
      "SELECT * FROM buildings WHERE map_id = $1 ORDER BY sort_order ASC, created_at ASC",
      [id],
    );

    return NextResponse.json({
      map: mapRowToCampusMap(mapResult.rows[0], buildingResult.rows.map(mapRowToBuilding)),
    });
  } catch (err) {
    console.error("[api/operator/maps/:id GET]", err);
    return NextResponse.json({ error: "Failed to load map" }, { status: 500 });
  }
}
