"use client";

import { useEffect, useMemo, useState } from "react";
import type { Building, IotDevice } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DeviceFormData = {
  name: string;
  type: "light" | "water_valve" | "temp_humidity";
  positionX?: number;
  positionY?: number;
  buildingId: string | null;
  locked: boolean;
};

interface DeviceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  createVariant?: "outside" | "building";
  initialDevice?: IotDevice | null;
  initialPosition?: { x: number; y: number } | null;
  initialBuildingId?: string | null;
  buildings: Building[];
  onSubmit: (data: DeviceFormData) => Promise<void> | void;
}

export function DeviceForm({
  open,
  onOpenChange,
  mode,
  createVariant = "outside",
  initialDevice,
  initialPosition,
  initialBuildingId,
  buildings,
  onSubmit,
}: DeviceFormProps) {
  const title =
    mode === "edit"
      ? "Edit Device"
      : createVariant === "building"
        ? "Add Device to Building"
        : "Add Outside Device";
  const [name, setName] = useState("");
  const [type, setType] = useState<"light" | "water_valve" | "temp_humidity">("light");
  const [positionX, setPositionX] = useState(0);
  const [positionY, setPositionY] = useState(0);
  const [buildingId, setBuildingId] = useState<string>("none");
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);

  const buildingOptions = useMemo(
    () => [...buildings].sort((a, b) => a.name.localeCompare(b.name)),
    [buildings],
  );

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialDevice) {
      setName(initialDevice.name);
      setType(initialDevice.type);
      setPositionX(initialDevice.positionX);
      setPositionY(initialDevice.positionY);
      setBuildingId(initialDevice.buildingId ?? "none");
      setLocked(initialDevice.locked);
      return;
    }
    setName("");
    setType("light");
    setPositionX(initialPosition?.x ?? 0);
    setPositionY(initialPosition?.y ?? 0);
    setBuildingId(initialBuildingId ?? "none");
    setLocked(false);
  }, [mode, open, initialDevice, initialPosition, initialBuildingId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        name,
        type,
        positionX: mode === "edit" || createVariant === "outside" ? positionX : undefined,
        positionY: mode === "edit" || createVariant === "outside" ? positionY : undefined,
        buildingId: buildingId === "none" ? null : buildingId,
        locked,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Configure device details and placement behavior.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="device-name">Name</Label>
            <Input
              id="device-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "light" | "water_valve" | "temp_humidity")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="water_valve">Water Valve</SelectItem>
                <SelectItem value="temp_humidity">Temp/Humidity Sensor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(mode === "edit" || createVariant === "outside") && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="pos-x">Position X</Label>
                <Input
                  id="pos-x"
                  type="number"
                  min={0}
                  step="0.1"
                  value={positionX}
                  onChange={(e) => setPositionX(Number(e.target.value))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pos-y">Position Y</Label>
                <Input
                  id="pos-y"
                  type="number"
                  min={0}
                  step="0.1"
                  value={positionY}
                  onChange={(e) => setPositionY(Number(e.target.value))}
                  required
                />
              </div>
            </div>
          )}

          {(mode === "edit" || createVariant === "outside") && (
            <div className="space-y-2">
              <Label>Building (optional)</Label>
              <Select value={buildingId} onValueChange={setBuildingId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {buildingOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label htmlFor="device-locked">Locked</Label>
              <p className="text-xs text-muted-foreground">
                Prevent accidental repositioning of this device.
              </p>
            </div>
            <Button
              id="device-locked"
              type="button"
              size="sm"
              variant={locked ? "default" : "outline"}
              onClick={() => setLocked((prev) => !prev)}
            >
              {locked ? "Locked" : "Unlocked"}
            </Button>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : mode === "create" ? "Create Device" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
