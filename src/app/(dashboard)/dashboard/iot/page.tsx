import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { IotDashboard } from "@/components/iot/IotDashboard";

export const dynamic = "force-dynamic";

export const metadata = { title: "IoT Dashboard - Campus Map" };

type MapSelectorRow = {
  id: string;
  name: string;
};

export default async function IotDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role === "operator") redirect("/operator");

  const result = await query<MapSelectorRow>(
    "SELECT id, name FROM campus_maps WHERE user_id = $1 ORDER BY created_at DESC",
    [session.user.id],
  );

  return <IotDashboard maps={result.rows} />;
}
