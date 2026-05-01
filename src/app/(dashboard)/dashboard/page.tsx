import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { mapRowToCampusMap, type CampusMapRow } from "@/lib/utils";
import { DashboardMapsSection } from "@/components/dashboard/DashboardMapsSection";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard - Smart Campus" };

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role === "operator") redirect("/operator");

  const { rows } = await query<CampusMapRow>(
    "SELECT * FROM campus_maps WHERE user_id = $1 ORDER BY created_at DESC",
    [session.user.id],
  );
  const maps = rows.map((r) => mapRowToCampusMap(r));

  return <DashboardMapsSection maps={maps} />;
}
