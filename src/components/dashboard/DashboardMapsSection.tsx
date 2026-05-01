"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { CampusMap } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapCard } from "@/components/dashboard/MapCard";

interface DashboardMapsSectionProps {
  maps: CampusMap[];
}

export function DashboardMapsSection({ maps }: DashboardMapsSectionProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return maps;
    return maps.filter((m) => m.name.toLowerCase().includes(q));
  }, [maps, query]);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your maps</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your campus maps. Create one, add buildings, and publish.
          </p>
        </div>
        <Button asChild className="w-full shrink-0 sm:w-auto">
          <Link href="/editor">
            <Plus className="size-4" />
            New map
          </Link>
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search maps by title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={maps.length === 0}
          aria-label="Search maps by title"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4">
        {maps.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-24 text-center">
            <h2 className="text-xl font-medium">No maps yet</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Get started by creating your first interactive campus map. Upload an image and start
              drawing building polygons.
            </p>
            <Button asChild className="mt-6">
              <Link href="/editor">
                <Plus className="size-4" />
                Create your first map
              </Link>
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center text-sm text-muted-foreground">
            No maps match &ldquo;{query.trim()}&rdquo;. Try a different search.
          </div>
        ) : (
          filtered.map((m) => <MapCard key={m.id} map={m} />)
        )}
      </div>
    </div>
  );
}
