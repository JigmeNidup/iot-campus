import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { createUserSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  created_at: string;
  updated_at: string;
}

function isAdmin(role?: string) {
  return role === "admin";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await query<UserRow>(
      "SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY created_at DESC",
    );
    return NextResponse.json({ users: result.rows });
  } catch (err) {
    console.error("[api/users GET]", err);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
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

  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, email, password, role } = parsed.data;

  try {
    const existing = await query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [email],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      return NextResponse.json({ error: "Email is already in use" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query<UserRow>(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at, updated_at`,
      [name, email, passwordHash, role],
    );

    return NextResponse.json({ user: result.rows[0] }, { status: 201 });
  } catch (err) {
    console.error("[api/users POST]", err);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
