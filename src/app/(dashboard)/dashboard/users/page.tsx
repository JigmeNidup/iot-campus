import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { UserManagement } from "@/components/dashboard/UserManagement";

export const dynamic = "force-dynamic";

export const metadata = { title: "Users - Campus Map" };

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return <UserManagement />;
}
