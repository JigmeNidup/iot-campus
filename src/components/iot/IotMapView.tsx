"use client";

import { useRef, useState } from "react";
import { Droplets, Lightbulb } from "lucide-react";
import type { CampusMap, IotDevice } from "@/types";
import { useMapTransform } from "@/hooks/useMapTransform";
import { MapControls } from "@/components/map/MapControls";
import { MapOverlay } from "@/components/map/MapOverlay";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface IotMapViewProps {
  map: CampusMap;
  devices: IotDevice[];
  selectedBuildingId: string | null;
  selectedDeviceId: string | null;
  placementType: "light" | "water_valve" | null;
  onPlaceDevice: (x: number, y: number) => void;
  onMoveDevice: (device: IotDevice, x: number, y: number) => void;
  onCommitMoveDevice: (device: IotDevice) => void;
  onBuildingSelect: (buildingId: string | null) => void;
  onDeviceSelect: (deviceId: string | null) => void;
  showDeviceLabels?: boolean;
  showDeviceHoverTooltip?: boolean;
}

export function IotMapView({
  map,
  devices,
  selectedBuildingId,
  selectedDeviceId,
  placementType,
  onPlaceDevice,
  onMoveDevice,
  onCommitMoveDevice,
  onBuildingSelect,
  onDeviceSelect,
  showDeviceLabels = false,
  showDeviceHoverTooltip = false,
}: IotMapViewProps) {
  const { containerRef, svgRef, bindContainer, transform, view, zoomBy, resetView, screenToSvg } =
    useMapTransform({ initial: { x: 0, y: 0, scale: 1 } });
  const dragRef = useRef<{
    pointerId: number;
    deviceId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [hoveredDevice, setHoveredDevice] = useState<{
    name: string;
    type: "light" | "water_valve" | "temp_humidity";
    state: boolean;
    clientX: number;
    clientY: number;
  } | null>(null);

  return (
    <div
      ref={containerRef}
      data-pan="true"
      className="map-canvas relative h-full w-full select-none overflow-hidden bg-muted/30"
      {...bindContainer}
    >
      <MapOverlay
        svgRef={svgRef}
        imageUrl={map.imageUrl}
        viewBoxWidth={map.viewBoxWidth}
        viewBoxHeight={map.viewBoxHeight}
        buildings={map.buildings}
        transform={transform}
        viewScale={view.scale}
        selectedId={selectedBuildingId}
        onBuildingClick={(building) => onBuildingSelect(building.id)}
        onSvgPointerDown={(e) => {
          if (!placementType) {
            onBuildingSelect(null);
            onDeviceSelect(null);
            return;
          }
          const [x, y] = screenToSvg(e.clientX, e.clientY);
          e.stopPropagation();
          onPlaceDevice(x, y);
        }}
      />

      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${map.viewBoxWidth} ${map.viewBoxHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute inset-0"
      >
        <g transform={transform}>
          {devices.map((device) => {
            const isOn = device.state;
            const Icon = device.type === "light" ? Lightbulb : Droplets;
            const activeColor = device.type === "light" ? "#f59e0b" : "#06b6d4";
            const fillColor = isOn ? activeColor : "#6b7280";
            const isSelected = selectedDeviceId === device.id;
            return (
              <g
                key={device.id}
                transform={`translate(${device.positionX} ${device.positionY})`}
                className="pointer-events-auto"
                onPointerEnter={(e) => {
                  if (!showDeviceHoverTooltip) return;
                  setHoveredDevice({
                    name: device.name,
                    type: device.type,
                    state: device.state,
                    clientX: e.clientX,
                    clientY: e.clientY,
                  });
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onBuildingSelect(device.buildingId ?? null);
                  onDeviceSelect(device.id);
                  if (device.locked || e.button !== 0) return;
                  const [px, py] = screenToSvg(e.clientX, e.clientY);
                  dragRef.current = {
                    pointerId: e.pointerId,
                    deviceId: device.id,
                    offsetX: px - device.positionX,
                    offsetY: py - device.positionY,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (showDeviceHoverTooltip) {
                    setHoveredDevice((prev) =>
                      prev
                        ? {
                            ...prev,
                            name: device.name,
                            type: device.type,
                            state: device.state,
                            clientX: e.clientX,
                            clientY: e.clientY,
                          }
                        : {
                            name: device.name,
                            type: device.type,
                            state: device.state,
                            clientX: e.clientX,
                            clientY: e.clientY,
                          },
                    );
                  }
                  const drag = dragRef.current;
                  if (!drag || drag.pointerId !== e.pointerId || drag.deviceId !== device.id) return;
                  const [px, py] = screenToSvg(e.clientX, e.clientY);
                  const nx = Math.max(0, Math.min(map.viewBoxWidth, px - drag.offsetX));
                  const ny = Math.max(0, Math.min(map.viewBoxHeight, py - drag.offsetY));
                  onMoveDevice(device, nx, ny);
                }}
                onPointerUp={(e) => {
                  const drag = dragRef.current;
                  if (!drag || drag.pointerId !== e.pointerId || drag.deviceId !== device.id) return;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  dragRef.current = null;
                  onCommitMoveDevice(device);
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                onPointerLeave={() => {
                  setHoveredDevice(null);
                }}
              >
                <circle
                  r={10 / view.scale}
                  fill={fillColor}
                  stroke={isSelected ? "#111827" : "white"}
                  strokeWidth={(isSelected ? 2.5 : 1.5) / view.scale}
                />
                <foreignObject
                  x={-7 / view.scale}
                  y={-7 / view.scale}
                  width={14 / view.scale}
                  height={14 / view.scale}
                  pointerEvents="none"
                >
                  <div className="flex h-full w-full items-center justify-center text-white">
                    <Icon size={10 / view.scale} />
                  </div>
                </foreignObject>
                {showDeviceLabels ? (
                  <text
                    x={0}
                    y={18 / view.scale}
                    textAnchor="middle"
                    dominantBaseline="hanging"
                    fontSize={10 / view.scale}
                    fontWeight={600}
                    fill="#111827"
                    stroke="white"
                    strokeWidth={2 / view.scale}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {device.name}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {placementType && (
        <div
          className="absolute left-3 top-3 z-10 rounded-md border bg-background/95 px-3 py-2 text-xs shadow"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          Click on the map to drop a {placementType === "light" ? "light" : "water valve"}.
        </div>
      )}

      <MapControls
        onZoomIn={() => zoomBy(1.12)}
        onZoomOut={() => zoomBy(1 / 1.12)}
        onReset={resetView}
      />
      {showDeviceHoverTooltip && hoveredDevice ? (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          style={{
            left: hoveredDevice.clientX + 12,
            top: hoveredDevice.clientY + 12,
          }}
        >
          <div className="font-medium">{hoveredDevice.name}</div>
          <div className="text-muted-foreground">
            {hoveredDevice.type === "light" ? "Light" : "Water Valve"} -{" "}
            {hoveredDevice.state ? "ON" : "OFF"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
