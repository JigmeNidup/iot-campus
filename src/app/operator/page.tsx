import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { OperatorDashboard } from "@/components/operator/OperatorDashboard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Operator Dashboard - Campus Map" };

export default async function OperatorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "operator" && session.user.role !== "admin") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        user={{
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        }}
      />
      <main className="flex-1">
        <OperatorDashboard />
      </main>
    </div>
  );
}
