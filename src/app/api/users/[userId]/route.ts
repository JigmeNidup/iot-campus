import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { updateUserSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

type RouteContext = { params: Promise<{ userId: string }> };

export async function PUT(req: Request, { params }: RouteContext) {
  const { userId } = await params;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

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

  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { name, email, password, role } = parsed.data;

  try {
    if (email) {
      const existing = await query<{ id: string }>(
        "SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1",
        [email, userId],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        return NextResponse.json({ error: "Email is already in use" }, { status: 409 });
      }
    }

    const updates: string[] = [];
    const values: Array<string> = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${idx++}`);
      values.push(email);
    }
    if (role !== undefined) {
      updates.push(`role = $${idx++}`);
      values.push(role);
    }
    if (password !== undefined) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${idx++}`);
      values.push(passwordHash);
    }

    values.push(userId);
    const result = await query<UserRow>(
      `UPDATE users
       SET ${updates.join(", ")}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING id, name, email, role, created_at, updated_at`,
      values,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: result.rows[0] });
  } catch (err) {
    console.error("[api/users/:userId PUT]", err);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { userId } = await params;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.id === userId) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 400 },
    );
  }

  try {
    const result = await query<{ id: string }>(
      "DELETE FROM users WHERE id = $1 RETURNING id",
      [userId],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/users/:userId DELETE]", err);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
