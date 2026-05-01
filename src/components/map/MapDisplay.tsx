"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { MqttClient } from "mqtt";
import { Droplets, Lightbulb, Thermometer } from "lucide-react";

import { useMapTransform } from "@/hooks/useMapTransform";
import { MapOverlay } from "@/components/map/MapOverlay";
import { MapControls } from "@/components/map/MapControls";
import { SearchBar } from "@/components/map/SearchBar";
import { CategoryFilter } from "@/components/map/CategoryFilter";
import { BuildingDrawer } from "@/components/map/BuildingDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BUILDING_CATEGORIES,
  type Building,
  type BuildingCategory,
  type CampusMap,
  type IotDevice,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  connectMqttClient,
  disconnectMqttClient,
  subscribeToTopic,
} from "@/lib/mqtt-client";

interface MapDisplayProps {
  map: CampusMap;
  initialDevices?: IotDevice[];
  showIot?: boolean;
}

const PUBLIC_BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";

export function MapDisplay({ map, initialDevices = [], showIot = true }: MapDisplayProps) {
  const {
    transform,
    containerRef,
    svgRef,
    bindContainer,
    view,
    resetView,
    zoomBy,
    centerOn,
    isPanning,
  } = useMapTransform();

  const [visible, setVisible] = useState<Set<BuildingCategory>>(
    () => new Set(BUILDING_CATEGORIES),
  );
  const [selected, setSelected] = useState<Building | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [devices, setDevices] = useState<IotDevice[]>(initialDevices);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [showLight, setShowLight] = useState(true);
  const [showWaterValve, setShowWaterValve] = useState(true);
  const [showOn, setShowOn] = useState(true);
  const [showOff, setShowOff] = useState(true);
  const [hoveredDevice, setHoveredDevice] = useState<{
    device: IotDevice;
    clientX: number;
    clientY: number;
  } | null>(null);
  const mqttRef = useRef<MqttClient | null>(null);

  useEffect(() => {
    setDevices(initialDevices);
    setSelectedDeviceId(null);
  }, [initialDevices, map.id]);

  useEffect(() => {
    if (!showIot) return;
    const client = connectMqttClient(PUBLIC_BROKER_URL);
    mqttRef.current = client;
    const statusTopic = `campus/${map.id}/device/+/status`;

    const onConnect = async () => {
      try {
        await subscribeToTopic(client, statusTopic);
      } catch {
        // Public map stays functional without realtime updates.
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
        // Ignore invalid broker traffic.
      }
    };

    client.on("connect", onConnect);
    client.on("message", onMessage);
    if (client.connected) void onConnect();

    return () => {
      client.removeListener("connect", onConnect);
      client.removeListener("message", onMessage);
      client.unsubscribe(statusTopic);
      disconnectMqttClient();
    };
  }, [map.id, showIot]);

  const filteredBuildings = useMemo(
    () => map.buildings.filter((b) => visible.has(b.category)),
    [map.buildings, visible],
  );

  function focusBuilding(b: Building) {
    centerOn(b.centerX, b.centerY, Math.max(view.scale, 2), 0.5);
    setHighlightedId(b.id);
    window.setTimeout(() => setHighlightedId(null), 2500);
  }

  function handleBuildingClick(b: Building) {
    setHighlightedId(null);
    setSelected(b);
  }

  function handleDrawerClose() {
    setSelected(null);
  }

  const globalSensor = devices.find((device) => device.type === "temp_humidity") ?? null;
  const mappableDevices = devices.filter((device) => device.type !== "temp_humidity");
  const selectedDevice =
    mappableDevices.find((device) => device.id === selectedDeviceId) ?? null;
  const filteredDevices = mappableDevices.filter((device) => {
    if (!showLight && device.type === "light") return false;
    if (!showWaterValve && device.type === "water_valve") return false;
    if (!showOn && device.state) return false;
    if (!showOff && !device.state) return false;
    return true;
  });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 font-semibold"
        >
          <Image
            src="/logo.png"
            alt="Campus Map logo"
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-md object-contain"
            priority
          />
          <span className="truncate text-sm sm:text-base">{map.name}</span>
        </Link>

        {map.description ? (
          <p className="hidden flex-1 truncate text-sm text-muted-foreground lg:block">
            {map.description}
          </p>
        ) : null}

        <div className="shrink-0">
          <SearchBar
            buildings={map.buildings}
            onPick={(b) => focusBuilding(b)}
          />
        </div>
      </header>

      <div className="border-b bg-background">
        <div className="overflow-x-auto px-3 py-2 sm:px-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <CategoryFilter visible={visible} onChange={setVisible} />
        </div>
      </div>

      <div
        ref={containerRef}
        data-pan="true"
        className={cn(
          "map-canvas relative min-h-0 w-full min-w-0 flex-1 touch-none self-stretch overflow-hidden bg-muted/30",
          isPanning ? "cursor-grabbing" : "cursor-grab",
        )}
        {...bindContainer}
      >
        <MapOverlay
          svgRef={svgRef}
          imageUrl={map.imageUrl}
          viewBoxWidth={map.viewBoxWidth}
          viewBoxHeight={map.viewBoxHeight}
          buildings={filteredBuildings}
          transform={transform}
          viewScale={view.scale}
          selectedId={selected?.id ?? null}
          highlightedId={highlightedId}
          onBuildingClick={handleBuildingClick}
        />
        {showIot ? (
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${map.viewBoxWidth} ${map.viewBoxHeight}`}
            preserveAspectRatio="xMidYMid meet"
            className="pointer-events-none absolute inset-0"
          >
            <g transform={transform}>
              {filteredDevices.map((device) => {
                const Icon = device.type === "light" ? Lightbulb : Droplets;
                const activeColor = device.type === "light" ? "#f59e0b" : "#06b6d4";
                return (
                  <g
                    key={device.id}
                    transform={`translate(${device.positionX} ${device.positionY})`}
                    className="pointer-events-auto"
                    onPointerEnter={(e) => {
                      setHoveredDevice({
                        device,
                        clientX: e.clientX,
                        clientY: e.clientY,
                      });
                    }}
                    onPointerMove={(e) => {
                      setHoveredDevice((current) =>
                        current && current.device.id === device.id
                          ? {
                              ...current,
                              clientX: e.clientX,
                              clientY: e.clientY,
                            }
                          : current,
                      );
                    }}
                    onPointerLeave={() => {
                      setHoveredDevice((current) =>
                        current && current.device.id === device.id ? null : current,
                      );
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelectedDeviceId(device.id);
                    }}
                  >
                    <circle
                      r={9 / view.scale}
                      fill={device.state ? activeColor : "#6b7280"}
                      stroke={selectedDeviceId === device.id ? "#111827" : "white"}
                      strokeWidth={(selectedDeviceId === device.id ? 2.5 : 1.5) / view.scale}
                    />
                    <foreignObject
                      x={-6 / view.scale}
                      y={-6 / view.scale}
                      width={12 / view.scale}
                      height={12 / view.scale}
                      pointerEvents="none"
                    >
                      <div className="flex h-full w-full items-center justify-center text-white">
                        <Icon size={9 / view.scale} />
                      </div>
                    </foreignObject>
                  </g>
                );
              })}
            </g>
          </svg>
        ) : null}
        <MapControls
          onZoomIn={() => zoomBy(1.2)}
          onZoomOut={() => zoomBy(1 / 1.2)}
          onReset={resetView}
        />
        {showIot ? (
          <div
            className="absolute left-3 top-3 z-10 rounded-md border bg-background/95 px-3 py-2 text-xs shadow"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium">IoT Devices</span>
            <Badge variant="secondary">{filteredDevices.length}</Badge>
          </div>
          {globalSensor ? (
            <div className="mb-2 flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1.5">
              <Thermometer className="size-3.5 text-rose-500" />
              <span className="text-[11px] font-medium">
                {globalSensor.temperature != null ? `${globalSensor.temperature.toFixed(1)} C` : "-- C"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {globalSensor.humidity != null ? `${globalSensor.humidity.toFixed(1)} %` : "-- %"}
              </span>
            </div>
          ) : null}
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={showLight ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setShowLight((v) => !v)}
            >
              Light
            </Button>
            <Button
              type="button"
              size="sm"
              variant={showWaterValve ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setShowWaterValve((v) => !v)}
            >
              Water Valve
            </Button>
            <Button
              type="button"
              size="sm"
              variant={showOn ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setShowOn((v) => !v)}
            >
              ON
            </Button>
            <Button
              type="button"
              size="sm"
              variant={showOff ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => setShowOff((v) => !v)}
            >
              OFF
            </Button>
          </div>
          {selectedDevice ? (
            <div className="text-muted-foreground">
              <div className="font-medium text-foreground">{selectedDevice.name}</div>
              <div>
                {selectedDevice.type === "light" ? "Light" : "Water Valve"} -{" "}
                {selectedDevice.state ? "ON" : "OFF"}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground">Tap a device marker for details.</div>
          )}
          </div>
        ) : null}
        {showIot && hoveredDevice ? (
          <div
            className="pointer-events-none fixed z-50 rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            style={{
              left: hoveredDevice.clientX + 12,
              top: hoveredDevice.clientY + 12,
            }}
          >
            <div className="font-medium">{hoveredDevice.device.name}</div>
            {hoveredDevice.device.type === "temp_humidity" ? (
              <div className="text-muted-foreground">
                Temp/Humidity - {hoveredDevice.device.temperature ?? "--"} C /{" "}
                {hoveredDevice.device.humidity ?? "--"} %
              </div>
            ) : (
              <div className="text-muted-foreground">
                {hoveredDevice.device.type === "light" ? "Light" : "Water Valve"} -{" "}
                {hoveredDevice.device.state ? "ON" : "OFF"}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <BuildingDrawer building={selected} onClose={handleDrawerClose} />
    </div>
  );
}
