"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { MqttClient } from "mqtt";
import { ArrowLeft, Copy, Droplets, Lightbulb, MousePointer2, Hand, Thermometer } from "lucide-react";
import { toast } from "sonner";
import type { CampusMap, IotDevice } from "@/types";
import {
  connectMqttClient,
  disconnectMqttClient,
  publishCommand,
  subscribeToTopic,
} from "@/lib/mqtt-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeviceList } from "@/components/iot/DeviceList";
import { IotMapView } from "@/components/iot/IotMapView";
import { IotImportExport } from "@/components/iot/IotImportExport";

interface IotDashboardProps {
  maps: { id: string; name: string }[];
}

const BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";

export function IotDashboard({ maps }: IotDashboardProps) {
  const [selectedMapId, setSelectedMapId] = useState<string>(maps[0]?.id ?? "");
  const [selectedMap, setSelectedMap] = useState<CampusMap | null>(null);
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placementType, setPlacementType] = useState<"light" | "water_valve" | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [pinSelectedToTop, setPinSelectedToTop] = useState(false);
  const [mqttStatus, setMqttStatus] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  const [pendingDeleteDevice, setPendingDeleteDevice] = useState<IotDevice | null>(null);

  const mqttRef = useRef<MqttClient | null>(null);
  const subscriptionRef = useRef<string | null>(null);

  const fetchMapAndDevices = useCallback(async () => {
    if (!selectedMapId) return;
    setLoading(true);
    setError(null);
    try {
      const [mapRes, devicesRes] = await Promise.all([
        fetch(`/api/maps/${selectedMapId}`),
        fetch(`/api/maps/${selectedMapId}/devices`),
      ]);
      if (!mapRes.ok) throw new Error("Failed to load map");
      if (!devicesRes.ok) throw new Error("Failed to load devices");
      const mapData = (await mapRes.json()) as { map: CampusMap };
      const deviceData = (await devicesRes.json()) as { devices: IotDevice[] };
      setSelectedMap(mapData.map);
      setDevices(deviceData.devices);
      setSelectedBuildingId(null);
      setSelectedDeviceId(null);
      setPinSelectedToTop(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load IoT data");
    } finally {
      setLoading(false);
    }
  }, [selectedMapId]);

  useEffect(() => {
    void fetchMapAndDevices();
  }, [fetchMapAndDevices]);

  useEffect(() => {
    if (!selectedMapId) return;

    const client = connectMqttClient(BROKER_URL);
    mqttRef.current = client;
    setMqttStatus(client.connected ? "connected" : "connecting");

    const statusTopic = `campus/${selectedMapId}/device/+/status`;
    const onConnect = async () => {
      try {
        if (subscriptionRef.current && subscriptionRef.current !== statusTopic) {
          client.unsubscribe(subscriptionRef.current);
        }
        await subscribeToTopic(client, statusTopic);
        subscriptionRef.current = statusTopic;
        setMqttStatus("connected");
      } catch (err) {
        console.error("[iot] subscribe failed", err);
        setMqttStatus("error");
        toast.error("MQTT connected, but failed to subscribe to status updates.");
      }
    };

    const onMessage = (topic: string, payload: Uint8Array) => {
      const parts = topic.split("/");
      const deviceId = parts[3];
      if (!deviceId) return;
      try {
        const parsed = JSON.parse(payload.toString()) as {
          state?: boolean;
          temperature?: number;
          humidity?: number;
        };
        setDevices((prev) =>
          prev.map((d) => {
            if (d.id !== deviceId) return d;
            return {
              ...d,
              state: typeof parsed.state === "boolean" ? parsed.state : d.state,
              temperature:
                typeof parsed.temperature === "number"
                  ? parsed.temperature
                  : d.temperature ?? null,
              humidity:
                typeof parsed.humidity === "number"
                  ? parsed.humidity
                  : d.humidity ?? null,
            };
          }),
        );
      } catch {
        // Ignore malformed MQTT payloads from public broker traffic.
      }
    };

    const onError = () => {
      setMqttStatus("error");
      toast.error("MQTT connection error. Device updates will rely on API only.");
    };

    const onReconnect = () => {
      setMqttStatus("connecting");
    };

    client.on("connect", onConnect);
    client.on("message", onMessage);
    client.on("error", onError);
    client.on("reconnect", onReconnect);
    if (client.connected) void onConnect();

    return () => {
      client.removeListener("connect", onConnect);
      client.removeListener("message", onMessage);
      client.removeListener("error", onError);
      client.removeListener("reconnect", onReconnect);
      if (subscriptionRef.current) {
        client.unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [selectedMapId]);

  useEffect(() => {
    return () => {
      disconnectMqttClient();
      setMqttStatus("connecting");
    };
  }, []);

  const handleToggle = useCallback(
    async (device: IotDevice, nextState: boolean) => {
      setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, state: nextState } : d)));

      const commandTopic = `campus/${device.mapId}/device/${device.id}/command`;
      const payload = JSON.stringify({ state: nextState });

      try {
        if (mqttRef.current) {
          await publishCommand(mqttRef.current, commandTopic, payload);
        }

        const res = await fetch(`/api/maps/${device.mapId}/devices/${device.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: nextState }),
        });
        if (!res.ok) {
          throw new Error("Failed to persist device state");
        }
      } catch (err) {
        setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, state: device.state } : d)));
        toast.error(err instanceof Error ? err.message : "Failed to toggle device");
      }
    },
    [],
  );

  const handleToggleLock = useCallback(async (device: IotDevice, nextLocked: boolean) => {
    setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, locked: nextLocked } : d)));
    try {
      const res = await fetch(`/api/maps/${device.mapId}/devices/${device.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: nextLocked }),
      });
      if (!res.ok) throw new Error("Failed to update lock state");
    } catch (err) {
      setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, locked: device.locked } : d)));
      toast.error(err instanceof Error ? err.message : "Lock update failed");
    }
  }, []);

  const confirmDeleteDevice = useCallback(async (device: IotDevice) => {
    const prev = devices;
    setPendingDeleteDevice(null);
    setDevices((list) => list.filter((d) => d.id !== device.id));
    try {
      const res = await fetch(`/api/maps/${device.mapId}/devices/${device.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete device");
      toast.success("Device deleted");
    } catch (err) {
      setDevices(prev);
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }, [devices]);

  const updateDevice = useCallback(
    async (
      device: IotDevice,
      patch: {
        name?: string;
        type?: "light" | "water_valve" | "temp_humidity";
        positionX?: number;
        positionY?: number;
        buildingId?: string | null;
      },
    ) => {
      const optimistic = { ...device, ...patch };
      setDevices((prev) => prev.map((d) => (d.id === device.id ? optimistic : d)));
      try {
        const res = await fetch(`/api/maps/${device.mapId}/devices/${device.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("Failed to update device");
        const data = (await res.json()) as { device: IotDevice };
        setDevices((prev) => prev.map((d) => (d.id === device.id ? data.device : d)));
      } catch (err) {
        setDevices((prev) => prev.map((d) => (d.id === device.id ? device : d)));
        toast.error(err instanceof Error ? err.message : "Update failed");
      }
    },
    [],
  );

  const createExternalDevice = useCallback(
    async (x: number, y: number) => {
      if (!selectedMapId || !placementType || !selectedMap) return;
      const containingBuilding = selectedMap.buildings.find((b) =>
        pointInPolygon([x, y], b.polygonPoints),
      );
      if (containingBuilding) {
        setSelectedBuildingId(containingBuilding.id);
        toast.error("Inside building area. Add from building section.");
        return;
      }

      try {
        const defaultName = placementType === "light" ? "New Light" : "New Water Valve";
        const res = await fetch(`/api/maps/${selectedMapId}/devices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: defaultName,
            type: placementType,
            positionX: x,
            positionY: y,
            buildingId: null,
            locked: false,
          }),
        });
        if (!res.ok) throw new Error("Failed to create device");
        const data = (await res.json()) as { device: IotDevice };
        setDevices((prev) => [data.device, ...prev]);
        setSelectedDeviceId(data.device.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create device");
      }
    },
    [placementType, selectedMap, selectedMapId],
  );

  const addDeviceToBuilding = useCallback(
    async (type: "light" | "water_valve") => {
      const selectedBuildingForAdd = selectedMap?.buildings.find((b) => b.id === selectedBuildingId) ?? null;
      if (!selectedMapId || !selectedBuildingForAdd) return;
      try {
        const defaultName =
          type === "light"
            ? `${selectedBuildingForAdd.abbreviation} Light`
            : `${selectedBuildingForAdd.abbreviation} Valve`;
        const res = await fetch(`/api/maps/${selectedMapId}/devices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: defaultName,
            type,
            buildingId: selectedBuildingForAdd.id,
            locked: false,
          }),
        });
        if (!res.ok) throw new Error("Failed to add building device");
        const data = (await res.json()) as { device: IotDevice };
        setDevices((prev) => [data.device, ...prev]);
        setSelectedDeviceId(data.device.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to add device");
      }
    },
    [selectedBuildingId, selectedMap, selectedMapId],
  );

  const mapBuildings = useMemo(() => selectedMap?.buildings ?? [], [selectedMap]);
  const globalSensor = useMemo(
    () => devices.find((d) => d.type === "temp_humidity") ?? null,
    [devices],
  );
  const mapDevices = useMemo(
    () => devices.filter((d) => d.type !== "temp_humidity"),
    [devices],
  );
  const selectedBuilding = useMemo(
    () => mapBuildings.find((b) => b.id === selectedBuildingId) ?? null,
    [mapBuildings, selectedBuildingId],
  );
  const visibleDevices = useMemo(
    () => {
      const filtered = selectedBuildingId
        ? mapDevices.filter((device) => device.buildingId === selectedBuildingId)
        : mapDevices;

      if (!pinSelectedToTop || !selectedDeviceId) return filtered;

      const selected = filtered.find((device) => device.id === selectedDeviceId);
      if (!selected) return filtered;

      return [
        selected,
        ...filtered.filter((device) => device.id !== selectedDeviceId),
      ];
    },
    [mapDevices, selectedBuildingId, selectedDeviceId, pinSelectedToTop],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between gap-3 border-b bg-background px-4 py-2">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" />
              Dashboard
            </Link>
          </Button>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Select value={selectedMapId} onValueChange={setSelectedMapId}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="Select map" />
            </SelectTrigger>
            <SelectContent>
              {maps.map((map) => (
                <SelectItem key={map.id} value={map.id}>
                  {map.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1">
            <Thermometer className="size-4 text-rose-500" />
            {globalSensor ? (
              <>
                <span className="text-xs font-medium">
                  {globalSensor.temperature != null ? `${globalSensor.temperature.toFixed(1)} C` : "-- C"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {globalSensor.humidity != null ? `${globalSensor.humidity.toFixed(1)} %` : "-- %"}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(globalSensor.mqttTopicPrefix);
                      toast.success("Sensor topic copied");
                    } catch {
                      toast.error("Failed to copy topic");
                    }
                  }}
                  aria-label="Copy sensor topic"
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive"
                  onClick={() => setPendingDeleteDevice(globalSensor)}
                >
                  Delete
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={async () => {
                  if (!selectedMapId) return;
                  try {
                    const res = await fetch(`/api/maps/${selectedMapId}/devices`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: "Global Temp/Humidity Sensor",
                        type: "temp_humidity",
                        locked: true,
                      }),
                    });
                    if (!res.ok) {
                      const msg = await res.text();
                      throw new Error(msg || "Failed to create sensor");
                    }
                    const data = (await res.json()) as { device: IotDevice };
                    setDevices((prev) => [data.device, ...prev]);
                    toast.success("Sensor created");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Create failed");
                  }
                }}
              >
                Add Temp/Humi
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border bg-background p-1 shadow-sm">
            <ToggleGroup
              type="single"
              value={placementType ?? "select"}
              onValueChange={(v) => {
                if (!v || v === "select" || v === "pan") {
                  setPlacementType(null);
                  return;
                }
                setPlacementType(v as "light" | "water_valve");
              }}
              size="sm"
              disabled={!selectedMap}
            >
              <ToolButton value="select" label="Select" icon={<MousePointer2 className="size-4" />} />
              <ToolButton value="light" label="Place Light" icon={<Lightbulb className="size-4" />} />
              <ToolButton value="water_valve" label="Place Water Valve" icon={<Droplets className="size-4" />} />
              <ToolButton value="pan" label="Pan" icon={<Hand className="size-4" />} />
            </ToggleGroup>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <Badge
              variant={
                mqttStatus === "connected"
                  ? "default"
                  : mqttStatus === "connecting"
                    ? "secondary"
                    : "destructive"
              }
              className="h-8"
            >
              MQTT:{" "}
              {mqttStatus === "connected"
                ? "Connected"
                : mqttStatus === "connecting"
                  ? "Connecting"
                  : "Error"}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {loading ? (
            <div className="grid h-full gap-4 p-4">
              <Skeleton className="h-full w-full" />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="rounded-lg border border-destructive/50 p-6 text-sm text-destructive">
                {error}
              </div>
            </div>
          ) : !selectedMap ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Select a map to view IoT devices.
              </div>
            </div>
          ) : (
            <IotMapView
              map={selectedMap}
              devices={mapDevices}
              selectedBuildingId={selectedBuildingId}
              selectedDeviceId={selectedDeviceId}
              placementType={placementType}
              onMoveDevice={(device, x, y) => {
                setDevices((prev) =>
                  prev.map((d) =>
                    d.id === device.id ? { ...d, positionX: x, positionY: y } : d,
                  ),
                );
              }}
              onCommitMoveDevice={(device) => {
                const latest = devices.find((d) => d.id === device.id);
                if (!latest || latest.locked) return;
                void updateDevice(device, {
                  positionX: latest.positionX,
                  positionY: latest.positionY,
                });
              }}
              onBuildingSelect={setSelectedBuildingId}
              onDeviceSelect={(deviceId) => {
                setSelectedDeviceId(deviceId);
                setPinSelectedToTop(true);
              }}
              onPlaceDevice={createExternalDevice}
            />
          )}
        </div>

        <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l bg-background lg:block">
          <div className="flex flex-col gap-6 p-4">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">
                  IoT Devices ({visibleDevices.length}
                  {selectedBuilding ? ` in ${selectedBuilding.abbreviation}` : ""})
                </h3>
                <IotImportExport
                  mapId={selectedMapId}
                  mapName={selectedMap?.name ?? "map"}
                  devices={devices}
                  onRefresh={fetchMapAndDevices}
                />
              </div>
              {selectedBuilding && (
                <div className="mb-2 flex items-center justify-between rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
                  <span className="truncate">
                    Filtering by: {selectedBuilding.name}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setSelectedBuildingId(null)}
                  >
                    Clear
                  </Button>
                </div>
              )}
              {selectedBuilding && (
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <Button type="button" size="sm" onClick={() => void addDeviceToBuilding("light")}>
                    <Lightbulb className="size-4" />
                    Add Light
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void addDeviceToBuilding("water_valve")}>
                    <Droplets className="size-4" />
                    Add Valve
                  </Button>
                </div>
              )}
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (
                <DeviceList
                  devices={visibleDevices}
                  selectedDeviceId={selectedDeviceId}
                  onSelectDevice={(deviceId) => {
                    setSelectedDeviceId(deviceId);
                    if (pinSelectedToTop && deviceId === selectedDeviceId) {
                      setPinSelectedToTop(true);
                    } else {
                      setPinSelectedToTop(false);
                    }
                  }}
                  onToggle={handleToggle}
                  onToggleLock={handleToggleLock}
                  onUpdate={(device, patch) => void updateDevice(device, patch)}
                  onDelete={(device) => setPendingDeleteDevice(device)}
                />
              )}
            </section>

            <Separator />

            <section className="text-sm text-muted-foreground">
              Pick a tool (Light/Water Valve), click map to drop outside devices, drag unlocked markers to move, and edit details inline in this tray.
            </section>
          </div>
        </aside>
      </div>

      <AlertDialog
        open={!!pendingDeleteDevice}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteDevice(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete IoT device?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteDevice
                ? `This will permanently delete "${pendingDeleteDevice.name}".`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingDeleteDevice) return;
                void confirmDeleteDevice(pendingDeleteDevice);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ToolButton({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem value={value} aria-label={label} className="size-8">
          {icon}
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function pointInPolygon(
  point: [number, number],
  polygon: [number, number][],
): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
