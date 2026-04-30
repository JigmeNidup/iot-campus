import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ buildId: string }> };

function isAdmin(role?: string) {
  return role === "admin";
}

export async function GET(_req: Request, { params }: RouteContext) {
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

  const origin = process.env.NEXTAUTH_URL || "http://localhost:3004";
  const url = `${origin}/api/ota/firmware/${buildId}/download`;
  return NextResponse.json({ url });
}
