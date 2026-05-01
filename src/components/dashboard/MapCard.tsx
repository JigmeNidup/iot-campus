"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Eye,
  ImageOff,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { CampusMap } from "@/types";

interface MapCardProps {
  map: CampusMap;
}

export function MapCard({ map }: MapCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedIot, setCopiedIot] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const deletePhrase = "delete this map";
  const deleteEnabled = useMemo(
    () => deleteConfirmText.trim().toLowerCase() === deletePhrase,
    [deleteConfirmText],
  );

  async function handleCopyLink() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/map/${map.id}`
        : `/map/${map.id}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      toast.success("Link copied to clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error(err);
      toast.error("Could not copy link");
    }
  }

  async function handleCopyIotLink() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/map/${map.id}/iot`
        : `/map/${map.id}/iot`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopiedIot(true);
      toast.success("IoT link copied to clipboard");
      window.setTimeout(() => setCopiedIot(false), 1500);
    } catch (err) {
      console.error(err);
      toast.error("Could not copy IoT link");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/maps/${map.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await safeJson(res);
        toast.error(data?.error ?? "Failed to delete map");
        return;
      }
      toast.success(`"${map.name}" deleted`);
      startTransition(() => router.refresh());
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete map");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
        {map.imageUrl ? (
          <Image
            src={map.imageUrl}
            alt={map.name}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-10" />
          </div>
        )}
        <div className="absolute right-2 top-2">
          {map.isPublished ? (
            <Badge>Published</Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )}
        </div>
      </div>

      <CardHeader className="px-4 pt-4">
        <CardTitle className="line-clamp-1">{map.name}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
          {map.description ?? "No description"}
        </p>
      </CardContent>
      <CardFooter className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="default">
            <Link href={`/editor/${map.id}`}>
              <Pencil className="size-4" />
              Edit
            </Link>
          </Button>

          <Button asChild size="sm" variant="outline" disabled={!map.isPublished}>
            <Link
              href={`/map/${map.id}`}
              target="_blank"
              aria-disabled={!map.isPublished}
              className={!map.isPublished ? "pointer-events-none opacity-50" : ""}
            >
              <Eye className="size-4" />
              Buildings
            </Link>
          </Button>

          <Button asChild size="sm" variant="outline" disabled={!map.isPublished}>
            <Link
              href={`/map/${map.id}/iot`}
              target="_blank"
              aria-disabled={!map.isPublished}
              className={!map.isPublished ? "pointer-events-none opacity-50" : ""}
            >
              <Eye className="size-4" />
              IoT
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {map.isPublished ? (
            <Button size="sm" variant="outline" onClick={handleCopyLink}>
              {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
              Buildings link
            </Button>
          ) : null}

          {map.isPublished ? (
            <Button size="sm" variant="outline" onClick={handleCopyIotLink}>
              {copiedIot ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
              IoT link
            </Button>
          ) : null}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" aria-label="Delete map">
                <Trash2 className="size-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this map?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove &quot;{map.name}&quot; and all of its buildings and devices. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  Type <span className="font-mono text-foreground">delete this map</span> to confirm.
                </div>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="delete this map"
                  autoComplete="off"
                />
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel
                  disabled={deleting || pending}
                  onClick={() => setDeleteConfirmText("")}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting || pending || !deleteEnabled}
                  onClick={handleDelete}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  {deleting || pending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    "Delete"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardFooter>
    </Card>
  );
}

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return null;
  }
}
