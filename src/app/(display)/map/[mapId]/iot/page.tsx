import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { query } from "@/lib/db";
import {
  mapRowToBuilding,
  mapRowToCampusMap,
  mapRowToIotDevice,
  type BuildingRow,
  type CampusMapRow,
  type IotDeviceRow,
} from "@/lib/utils";
import { MapDisplay } from "@/components/map/MapDisplay";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ mapId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { mapId } = await params;
  if (!UUID_RE.test(mapId)) return { title: "Map (IoT) - Campus Map" };
  try {
    const result = await query<{ name: string; is_published: boolean }>(
      "SELECT name, is_published FROM campus_maps WHERE id = $1",
      [mapId],
    );
    const row = result.rows[0];
    if (!row || !row.is_published) return { title: "Map (IoT) - Campus Map" };
    return { title: `${row.name} (IoT) - Campus Map` };
  } catch {
    return { title: "Map (IoT) - Campus Map" };
  }
}

export default async function PublicMapIotPage({ params }: PageProps) {
  const { mapId } = await params;
  if (!UUID_RE.test(mapId)) notFound();

  const mapResult = await query<CampusMapRow>(
    "SELECT * FROM campus_maps WHERE id = $1",
    [mapId],
  );
  const mapRow = mapResult.rows[0];
  if (!mapRow || !mapRow.is_published) notFound();

  const buildingsResult = await query<BuildingRow>(
    "SELECT * FROM buildings WHERE map_id = $1 ORDER BY sort_order ASC, created_at ASC",
    [mapId],
  );

  const map = mapRowToCampusMap(
    mapRow,
    buildingsResult.rows.map(mapRowToBuilding),
  );

  const devicesResult = await query<IotDeviceRow>(
    "SELECT * FROM iot_devices WHERE map_id = $1 ORDER BY created_at ASC",
    [mapId],
  );

  return (
    <MapDisplay
      map={map}
      showIot
      initialDevices={devicesResult.rows.map(mapRowToIotDevice)}
    />
  );
}

