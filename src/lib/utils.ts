import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function centroidOf(points: [number, number][]): [number, number] {
  if (points.length === 0) return [0, 0];
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
  }
  return [sumX / points.length, sumY / points.length];
}

export function rectFromTwoPoints(
  a: [number, number],
  b: [number, number],
): [number, number][] {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

export type CampusMapRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  image_url: string;
  view_box_width: number;
  view_box_height: number;
  is_published: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export type BuildingRow = {
  id: string;
  map_id: string;
  name: string;
  abbreviation: string;
  category: string;
  description: string | null;
  polygon_points: unknown;
  center_x: number | string;
  center_y: number | string;
  floors: number | null;
  departments: string[] | null;
  color: string | null;
  image_url: string | null;
  sort_order: number;
  locked: boolean | null;
};

export type IotDeviceRow = {
  id: string;
  map_id: string;
  building_id: string | null;
  name: string;
  type: "light" | "water_valve" | "temp_humidity";
  state: boolean | null;
  locked: boolean | null;
  temperature: number | string | null;
  humidity: number | string | null;
  position_x: number | string;
  position_y: number | string;
  mqtt_topic_prefix: string;
  board_target: "esp32" | "esp01" | null;
  firmware_version: string | null;
  wifi_ssid: string | null;
  ota_status: string | null;
  last_seen_at: Date | string | null;
  registration_token: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type FirmwareBuildRow = {
  id: string;
  device_type: "light" | "water_valve" | "temp_humidity";
  board_target: "esp32" | "esp01";
  version: string;
  file_path: string;
  checksum: string;
  size_bytes: number;
  changelog: string | null;
  created_by_user_id: string;
  created_at: Date | string;
};

import type {
  Building,
  BuildingCategory,
  CampusMap,
  FirmwareBuild,
  IotDevice,
} from "@/types";

export function mapRowToCampusMap(
  row: CampusMapRow,
  buildings: Building[] = [],
): CampusMap {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? undefined,
    imageUrl: row.image_url,
    viewBoxWidth: row.view_box_width,
    viewBoxHeight: row.view_box_height,
    isPublished: row.is_published,
    buildings,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  };
}

export function mapRowToBuilding(row: BuildingRow): Building {
  const points = Array.isArray(row.polygon_points)
    ? (row.polygon_points as [number, number][])
    : (JSON.parse(String(row.polygon_points)) as [number, number][]);
  return {
    id: row.id,
    mapId: row.map_id,
    name: row.name,
    abbreviation: row.abbreviation,
    category: row.category as BuildingCategory,
    description: row.description ?? undefined,
    polygonPoints: points,
    centerX: typeof row.center_x === "string" ? parseFloat(row.center_x) : row.center_x,
    centerY: typeof row.center_y === "string" ? parseFloat(row.center_y) : row.center_y,
    floors: row.floors ?? undefined,
    departments: row.departments ?? [],
    color: row.color ?? undefined,
    imageUrl: row.image_url ?? undefined,
    sortOrder: row.sort_order,
    locked: row.locked ?? false,
  };
}

export function mapRowToIotDevice(row: IotDeviceRow): IotDevice {
  return {
    id: row.id,
    mapId: row.map_id,
    buildingId: row.building_id,
    name: row.name,
    type: row.type,
    state: row.state ?? false,
    locked: row.locked ?? false,
    temperature:
      row.temperature == null
        ? null
        : typeof row.temperature === "string"
          ? parseFloat(row.temperature)
          : row.temperature,
    humidity:
      row.humidity == null
        ? null
        : typeof row.humidity === "string"
          ? parseFloat(row.humidity)
          : row.humidity,
    positionX:
      typeof row.position_x === "string" ? parseFloat(row.position_x) : row.position_x,
    positionY:
      typeof row.position_y === "string" ? parseFloat(row.position_y) : row.position_y,
    mqttTopicPrefix: row.mqtt_topic_prefix,
    boardTarget: row.board_target,
    firmwareVersion: row.firmware_version,
    wifiSsid: row.wifi_ssid,
    otaStatus: row.ota_status,
    lastSeenAt:
      row.last_seen_at == null
        ? null
        : row.last_seen_at instanceof Date
          ? row.last_seen_at.toISOString()
          : row.last_seen_at,
    registrationToken: row.registration_token,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  };
}

export function mapRowToFirmwareBuild(row: FirmwareBuildRow): FirmwareBuild {
  return {
    id: row.id,
    deviceType: row.device_type,
    boardTarget: row.board_target,
    version: row.version,
    filePath: row.file_path,
    checksum: row.checksum,
    sizeBytes: row.size_bytes,
    changelog: row.changelog,
    createdByUserId: row.created_by_user_id,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}
