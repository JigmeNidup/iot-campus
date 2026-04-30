"use client";

import { useMemo, useState } from "react";
import { Copy, Droplets, Lightbulb, Lock, LockOpen, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { IotDevice } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface DeviceListProps {
  devices: IotDevice[];
  selectedDeviceId?: string | null;
  onSelectDevice?: (deviceId: string | null) => void;
  onToggle: (device: IotDevice, nextState: boolean) => void;
  onToggleLock?: (device: IotDevice, nextLocked: boolean) => void;
  onUpdate: (
    device: IotDevice,
    patch: {
      name?: string;
      type?: "light" | "water_valve" | "temp_humidity";
      positionX?: number;
      positionY?: number;
      buildingId?: string | null;
    },
  ) => void;
  onDelete?: (device: IotDevice) => void;
  mode?: "default" | "operator";
}

export function DeviceList({
  devices,
  selectedDeviceId = null,
  onSelectDevice,
  onToggle,
  onToggleLock,
  onUpdate,
  onDelete,
  mode = "default",
}: DeviceListProps) {
  if (devices.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        No devices yet. Add a light or valve to begin.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {devices.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          isSelected={selectedDeviceId === device.id}
          onSelect={() => onSelectDevice?.(device.id)}
          onToggle={onToggle}
          onToggleLock={onToggleLock}
          onUpdate={onUpdate}
          onDelete={onDelete}
          mode={mode}
        />
      ))}
    </div>
  );
}

function DeviceRow({
  device,
  isSelected,
  onSelect,
  onToggle,
  onToggleLock,
  onUpdate,
  onDelete,
  mode,
}: {
  device: IotDevice;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: (device: IotDevice, nextState: boolean) => void;
  onToggleLock?: (device: IotDevice, nextLocked: boolean) => void;
  onUpdate: (
    device: IotDevice,
    patch: {
      name?: string;
      type?: "light" | "water_valve" | "temp_humidity";
      positionX?: number;
      positionY?: number;
      buildingId?: string | null;
    },
  ) => void;
  onDelete?: (device: IotDevice) => void;
  mode: "default" | "operator";
}) {
  const [name, setName] = useState(device.name);
  const [type, setType] = useState<"light" | "water_valve" | "temp_humidity">(device.type);

  const showOperatorControls = mode === "operator";
  const dirty = useMemo(
    () => name.trim() !== device.name || type !== device.type,
    [name, type, device.name, device.type],
  );

  const Icon = type === "light" ? Lightbulb : Droplets;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors",
        isSelected
          ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
          : "",
      )}
      onPointerDown={onSelect}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn("size-4", device.type === "light" ? "text-amber-500" : "text-cyan-500")} />
          <Badge variant={device.state ? "default" : "outline"}>
            {device.state ? "ON" : "OFF"}
          </Badge>
          <Badge variant={device.locked ? "secondary" : "outline"}>
            {device.locked ? "Locked" : "Unlocked"}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={device.state ? "default" : "outline"}
            onClick={() => onToggle(device, !device.state)}
          >
            {device.state ? "Turn Off" : "Turn On"}
          </Button>
          {!showOperatorControls ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onToggleLock?.(device, !device.locked)}
              aria-label={device.locked ? "Unlock" : "Lock"}
            >
              {device.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {!showOperatorControls ? (
          <>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Device name"
              maxLength={255}
            />
            <div className="flex items-center gap-2">
              <Select value={type} onValueChange={(v) => setType(v as "light" | "water_valve" | "temp_humidity")}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="water_valve">Water Valve</SelectItem>
                  <SelectItem value="temp_humidity">Temp/Humidity Sensor</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="outline"
                disabled={!dirty || name.trim().length === 0}
                onClick={() => onUpdate(device, { name: name.trim(), type })}
                aria-label="Save device changes"
              >
                <Save className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(device.mqttTopicPrefix);
                    toast.success("MQTT topic copied");
                  } catch {
                    toast.error("Failed to copy topic");
                  }
                }}
                aria-label="Copy MQTT topic"
              >
                <Copy className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onDelete?.(device)}
                aria-label="Delete device"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </>
        ) : null}
        <p className="text-xs text-muted-foreground">
          x: {device.positionX.toFixed(1)} , y: {device.positionY.toFixed(1)}
        </p>
      </div>
    </div>
  );
}
