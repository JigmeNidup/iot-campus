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
    <div className="flex w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm transition-shadow duration-200 ease-out hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/40 md:min-h-[220px] md:flex-row">
      <div className="relative h-52 w-full shrink-0 bg-muted md:h-auto md:w-3/5 md:min-h-[220px]">
        {map.imageUrl ? (
          <Image
            src={map.imageUrl}
            alt={map.name}
            fill
            sizes="75vw"
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

      <div className="flex w-full flex-col justify-between gap-4 border-t border-border p-4 md:w-2/5 md:border-l md:border-t-0 md:py-4">
        <div className="min-w-0 space-y-1">
          <h2 className="line-clamp-2 text-base font-semibold leading-tight">{map.name}</h2>
          <p className="line-clamp-3 text-xs text-muted-foreground">
            {map.description ?? "No description"}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button asChild size="sm" variant="default" className="w-full justify-start">
            <Link href={`/editor/${map.id}`}>
              <Pencil className="size-4 shrink-0" />
              Edit
            </Link>
          </Button>

          <Button asChild size="sm" variant="outline" className="w-full justify-start" disabled={!map.isPublished}>
            <Link
              href={`/map/${map.id}`}
              target="_blank"
              aria-disabled={!map.isPublished}
              className={!map.isPublished ? "pointer-events-none opacity-50" : ""}
            >
              <Eye className="size-4 shrink-0" />
              Buildings
            </Link>
          </Button>

          <Button asChild size="sm" variant="outline" className="w-full justify-start" disabled={!map.isPublished}>
            <Link
              href={`/map/${map.id}/iot`}
              target="_blank"
              aria-disabled={!map.isPublished}
              className={!map.isPublished ? "pointer-events-none opacity-50" : ""}
            >
              <Eye className="size-4 shrink-0" />
              IoT
            </Link>
          </Button>

          {map.isPublished ? (
            <Button size="sm" variant="outline" className="w-full justify-start" onClick={handleCopyLink}>
              {copied ? <Check className="size-4 shrink-0 text-emerald-600" /> : <Copy className="size-4 shrink-0" />}
              Buildings link
            </Button>
          ) : null}

          {map.isPublished ? (
            <Button size="sm" variant="outline" className="w-full justify-start" onClick={handleCopyIotLink}>
              {copiedIot ? <Check className="size-4 shrink-0 text-emerald-600" /> : <Copy className="size-4 shrink-0" />}
              IoT link
            </Button>
          ) : null}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" className="w-full justify-start" aria-label="Delete map">
                <Trash2 className="size-4 shrink-0" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this map?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove &quot;{map.name}&quot; and all of its buildings and devices. This
                  cannot be undone.
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
      </div>
    </div>
  );
}

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return null;
  }
}
