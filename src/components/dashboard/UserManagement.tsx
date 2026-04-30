"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type UserRole = "admin" | "operator";

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

const emptyCreate = {
  name: "",
  email: "",
  password: "",
  role: "operator" as UserRole,
};

export function UserManagement() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "operator" as UserRole,
  });

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");
      setUsers(data.users ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleCreate() {
    if (!createForm.name || !createForm.email || !createForm.password) {
      toast.error("Name, email, and password are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create user");
      setUsers((prev) => [data.user, ...prev]);
      setCreateForm(emptyCreate);
      toast.success("User created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(user: AppUser) {
    setEditingId(user.id);
    setEditForm({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
    });
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
      };
      if (editForm.password) payload.password = editForm.password;

      const res = await fetch(`/api/users/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update user");
      setUsers((prev) => prev.map((u) => (u.id === editingId ? data.user : u)));
      setEditingId(null);
      toast.success("User updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(userId: string) {
    if (!confirm("Delete this user?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete user");
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setSaving(false);
    }
  }

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

  return (
    <div className="container mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">User management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create, edit, and remove administrator and operator accounts.
        </p>
      </div>

      <section className="rounded-lg border p-4 md:p-6">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="size-4" />
          <h2 className="text-lg font-medium">Add user</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={createForm.name}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              value={createForm.email}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, email: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Password</Label>
            <Input
              type="password"
              value={createForm.password}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, password: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select
              value={createForm.role}
              onValueChange={(value: UserRole) =>
                setCreateForm((prev) => ({ ...prev, role: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button className="mt-4" disabled={saving} onClick={handleCreate}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Create user
        </Button>
      </section>

      <section className="rounded-lg border p-4 md:p-6">
        <h2 className="mb-4 text-lg font-medium">Users</h2>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading users...</div>
        ) : sortedUsers.length === 0 ? (
          <div className="text-sm text-muted-foreground">No users found.</div>
        ) : (
          <div className="space-y-3">
            {sortedUsers.map((user) => {
              const isEditing = editingId === user.id;
              return (
                <div
                  key={user.id}
                  className="rounded-md border p-3 md:p-4"
                >
                  {isEditing ? (
                    <div className="grid gap-3 md:grid-cols-5">
                      <Input
                        value={editForm.name}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                      <Input
                        value={editForm.email}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, email: e.target.value }))
                        }
                      />
                      <Input
                        type="password"
                        placeholder="New password (optional)"
                        value={editForm.password}
                        onChange={(e) =>
                          setEditForm((prev) => ({ ...prev, password: e.target.value }))
                        }
                      />
                      <Select
                        value={editForm.role}
                        onValueChange={(value: UserRole) =>
                          setEditForm((prev) => ({ ...prev, role: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="operator">Operator</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{user.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {user.email}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{user.role}</Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => startEdit(user)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(user.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
