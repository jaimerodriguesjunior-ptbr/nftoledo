import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Sidebar from "@/components/layout/Sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto min-w-0 p-4 pt-20 md:p-8">{children}</main>
    </div>
  );
}
