"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { iotDeviceImportFileSchema } from "@/lib/validators";
import type { IotDevice } from "@/types";

const EXPORT_VERSION = 1;
const MAX_PASTE_BYTES = 1024 * 1024;
type ImportMode = "replace" | "append";

interface IotImportExportProps {
  mapId: string;
  mapName: string;
  devices: IotDevice[];
  onRefresh: () => Promise<void>;
}

export function IotImportExport({
  mapId,
  mapName,
  devices,
  onRefresh,
}: IotImportExportProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("replace");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  function handleExport() {
    if (devices.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const payload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      source: { mapName },
      devices: devices.map((device) => ({
        name: device.name,
        type: device.type,
        state: device.state,
        locked: device.locked,
        buildingId: device.buildingId ?? null,
        positionX: device.positionX,
        positionY: device.positionY,
        temperature: device.temperature ?? null,
        humidity: device.humidity ?? null,
      })),
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(mapName) || "map"}-iot-devices.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${devices.length} IoT device(s)`);
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_PASTE_BYTES) {
      toast.error("File too large (max 1MB)");
      return;
    }
    try {
      setText(await file.text());
    } catch {
      toast.error("Could not read file");
    }
  }

  async function handleImport() {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("Paste JSON or load a file first");
      return;
    }
    if (trimmed.length > MAX_PASTE_BYTES) {
      toast.error("JSON content too large (max 1MB)");
      return;
    }

    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        toast.error("Invalid JSON");
        return;
      }
      const result = iotDeviceImportFileSchema.safeParse(parsed);
      if (!result.success) {
        const first = result.error.issues[0];
        const path = first?.path.join(".") || "(root)";
        toast.error(`Invalid file - ${path}: ${first?.message ?? "validation failed"}`);
        return;
      }

      if (mode === "replace") {
        for (const device of devices) {
          const res = await fetch(`/api/maps/${mapId}/devices/${device.id}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error("Failed to clear existing devices");
        }
      }

      for (const device of result.data.devices) {
        const res = await fetch(`/api/maps/${mapId}/devices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: device.name,
            type: device.type,
            state: device.state ?? false,
            locked: device.locked ?? false,
            buildingId: device.buildingId ?? null,
            positionX: device.positionX,
            positionY: device.positionY,
            temperature: device.temperature ?? null,
            humidity: device.humidity ?? null,
          }),
        });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || `Failed to import device "${device.name}"`);
        }
      }

      await onRefresh();
      toast.success(
        mode === "replace"
          ? `Imported ${result.data.devices.length} device(s) (replace)`
          : `Imported ${result.data.devices.length} device(s) (append)`,
      );
      setOpen(false);
      setText("");
      setMode("replace");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={devices.length === 0}
          >
            <Download className="size-3.5" />
            Export
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download IoT devices as JSON</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            <Upload className="size-3.5" />
            Import
          </Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 border-b p-6 pb-4">
            <DialogTitle>Import IoT devices</DialogTitle>
            <DialogDescription>
              Import IoT devices from exported JSON.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Mode
              </Label>
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(v) => v && setMode(v as ImportMode)}
                size="sm"
                variant="outline"
                className="w-full"
              >
                <ToggleGroupItem value="replace" className="flex-1">
                  Replace existing
                </ToggleGroupItem>
                <ToggleGroupItem value="append" className="flex-1">
                  Add to existing
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="iot-import-json">JSON content</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="size-3.5" />
                  Load from file
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handlePickFile}
                />
              </div>
              <Textarea
                id="iot-import-json"
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Paste JSON, e.g.\n{\n  "version": 1,\n  "devices": [ ... ]\n}`}
                className="max-h-64 resize-none overflow-auto font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t bg-background p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleImport()} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
