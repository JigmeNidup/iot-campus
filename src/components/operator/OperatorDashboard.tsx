"use client";

import { useEffect, useMemo, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import type { MqttClient } from "mqtt";
import type { CampusMap, IotDevice } from "@/types";
import { connectMqttClient, publishCommand, subscribeToTopic } from "@/lib/mqtt-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IotMapView } from "@/components/iot/IotMapView";
import { DeviceList } from "@/components/iot/DeviceList";

interface MapOption {
  id: string;
  name: string;
}

const MQTT_BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";

export function OperatorDashboard() {
  const [maps, setMaps] = useState<MapOption[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string>("");
  const [selectedMap, setSelectedMap] = useState<CampusMap | null>(null);
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [loadingMaps, setLoadingMaps] = useState(true);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [mqttClient, setMqttClient] = useState<MqttClient | null>(null);

  useEffect(() => {
    async function loadMaps() {
      setLoadingMaps(true);
      try {
        const res = await fetch("/api/operator/maps", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load maps");
        const mapRows = (data.maps ?? []) as MapOption[];
        setMaps(mapRows);
        if (mapRows.length > 0) {
          setSelectedMapId(mapRows[0].id);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load maps");
      } finally {
        setLoadingMaps(false);
      }
    }

    void loadMaps();
  }, []);

  useEffect(() => {
    if (!selectedMapId) {
      setDevices([]);
      setSelectedMap(null);
      return;
    }

    async function loadMapAndDevices() {
      setLoadingDevices(true);
      try {
        const [mapRes, devicesRes] = await Promise.all([
          fetch(`/api/operator/maps/${selectedMapId}`, { cache: "no-store" }),
          fetch(`/api/operator/maps/${selectedMapId}/devices`, { cache: "no-store" }),
        ]);
        const mapData = await mapRes.json();
        const deviceData = await devicesRes.json();
        if (!mapRes.ok) throw new Error(mapData.error || "Failed to load map");
        if (!devicesRes.ok) throw new Error(deviceData.error || "Failed to load devices");
        setSelectedMap(mapData.map ?? null);
        setDevices(deviceData.devices ?? []);
        setSelectedBuildingId(null);
        setSelectedDeviceId(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load map devices");
      } finally {
        setLoadingDevices(false);
      }
    }

    void loadMapAndDevices();
  }, [selectedMapId]);

  useEffect(() => {
    if (!selectedMapId) return;

    const client = connectMqttClient(MQTT_BROKER_URL);
    setMqttClient(client);

    const onConnect = () => setMqttConnected(true);
    const onClose = () => setMqttConnected(false);
    const onError = () => setMqttConnected(false);
    const onMessage = (topic: string, payload: Buffer) => {
      if (!topic.startsWith(`campus/${selectedMapId}/device/`) || !topic.endsWith("/status")) {
        return;
      }
      const chunks = topic.split("/");
      const deviceId = chunks[3];
      let nextState: boolean | null = null;
      const text = payload.toString();
      try {
        const parsed = JSON.parse(text) as { state?: unknown };
        if (typeof parsed.state === "boolean") nextState = parsed.state;
      } catch {
        if (text === "ON") nextState = true;
        if (text === "OFF") nextState = false;
      }
      if (nextState === null) return;
      setDevices((prev) =>
        prev.map((d) => (d.id === deviceId ? { ...d, state: nextState as boolean } : d)),
      );
    };

    client.on("connect", onConnect);
    client.on("reconnect", onConnect);
    client.on("close", onClose);
    client.on("error", onError);
    client.on("message", onMessage);

    void subscribeToTopic(client, `campus/${selectedMapId}/device/+/status`).catch(() => {
      setMqttConnected(false);
    });

    return () => {
      client.removeListener("connect", onConnect);
      client.removeListener("reconnect", onConnect);
      client.removeListener("close", onClose);
      client.removeListener("error", onError);
      client.removeListener("message", onMessage);
      client.unsubscribe(`campus/${selectedMapId}/device/+/status`);
    };
  }, [selectedMapId]);

  async function toggleDevice(device: IotDevice) {
    const nextState = !device.state;
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, state: nextState } : d)),
    );

    try {
      if (mqttClient && mqttConnected) {
        await publishCommand(
          mqttClient,
          `${device.mqttTopicPrefix}/command`,
          JSON.stringify({ state: nextState }),
        );
      }

      const res = await fetch(
        `/api/operator/maps/${selectedMapId}/devices/${device.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: nextState }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update device");
    } catch (err) {
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? { ...d, state: device.state } : d)),
      );
      toast.error(err instanceof Error ? err.message : "Failed to toggle device");
    }
  }

  const visibleDevices = useMemo(
    () =>
      selectedBuildingId
        ? devices.filter((d) => d.buildingId === selectedBuildingId)
        : devices,
    [devices, selectedBuildingId],
  );

  const selectedBuilding = useMemo(
    () => selectedMap?.buildings.find((b) => b.id === selectedBuildingId) ?? null,
    [selectedMap, selectedBuildingId],
  );

  const mapOverlayDevices = useMemo(
    () => devices.map((d) => ({ ...d, locked: true })),
    [devices],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-semibold">Operator dashboard</h1>
            <p className="text-xs text-muted-foreground">Control lights and water valves</p>
          </div>
          <Select value={selectedMapId} onValueChange={setSelectedMapId} disabled={loadingMaps}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder={loadingMaps ? "Loading maps..." : "Select map"} />
            </SelectTrigger>
            <SelectContent>
              {maps.map((map) => (
                <SelectItem key={map.id} value={map.id}>
                  {map.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge
          variant={mqttConnected ? "default" : "secondary"}
          className="inline-flex items-center gap-1"
        >
          {mqttConnected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {mqttConnected ? "MQTT connected" : "MQTT disconnected"}
        </Badge>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1">
          {loadingDevices ? (
            <div className="p-4">
              <Skeleton className="h-full min-h-[420px] w-full" />
            </div>
          ) : !selectedMap ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a map to view overlays and controls.
            </div>
          ) : (
            <IotMapView
              map={selectedMap}
              devices={mapOverlayDevices}
              selectedBuildingId={selectedBuildingId}
              selectedDeviceId={selectedDeviceId}
              showDeviceLabels
              showDeviceHoverTooltip
              placementType={null}
              onPlaceDevice={() => undefined}
              onMoveDevice={() => undefined}
              onCommitMoveDevice={() => undefined}
              onBuildingSelect={setSelectedBuildingId}
              onDeviceSelect={(deviceId) => setSelectedDeviceId(deviceId)}
            />
          )}
        </div>

        <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l bg-background lg:block">
          <div className="space-y-4 p-4">
            {selectedBuilding ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
                <span className="truncate">Filtering by: {selectedBuilding.name}</span>
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
            ) : null}

            <section>
              <h2 className="mb-2 text-sm font-medium">
                IoT Devices ({visibleDevices.length})
              </h2>
              <DeviceList
                mode="operator"
                devices={visibleDevices}
                selectedDeviceId={selectedDeviceId}
                onSelectDevice={(deviceId) => {
                  setSelectedDeviceId(deviceId);
                  const selectedDevice = visibleDevices.find((d) => d.id === deviceId);
                  if (selectedDevice) setSelectedBuildingId(selectedDevice.buildingId ?? null);
                }}
                onToggle={(device, nextState) => {
                  if (nextState !== device.state) void toggleDevice(device);
                }}
                onUpdate={() => undefined}
              />
            </section>
            {visibleDevices.length === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No controllable devices available.
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
