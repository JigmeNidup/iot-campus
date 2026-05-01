import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { ProgrammingDashboard } from "@/components/programming/ProgrammingDashboard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Programming - Smart Campus" };

type MapSelectorRow = {
  id: string;
  name: string;
};

export default async function ProgrammingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/operator");

  const result = await query<MapSelectorRow>(
    "SELECT id, name FROM campus_maps WHERE user_id = $1 ORDER BY created_at DESC",
    [session.user.id],
  );

  return <ProgrammingDashboard maps={result.rows} />;
}
