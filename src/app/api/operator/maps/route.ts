import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface MapRow {
  id: string;
  name: string;
}

function canAccessOperator(role?: string) {
  return role === "operator" || role === "admin";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccessOperator(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await query<MapRow>(
      "SELECT id, name FROM campus_maps ORDER BY created_at DESC",
    );
    return NextResponse.json({ maps: result.rows });
  } catch (err) {
    console.error("[api/operator/maps GET]", err);
    return NextResponse.json({ error: "Failed to load maps" }, { status: 500 });
  }
}
