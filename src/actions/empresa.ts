"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { syncCompanyWithLocalFiscal } from "@/lib/nuvem-local-fiscal";

async function getOrgId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  return { supabase, orgId: profile?.organization_id as string };
}

export async function getCompany() {
  const { supabase, orgId } = await getOrgId();
  if (!orgId) return null;

  const { data } = await supabase
    .from("company_settings")
    .select("*")
    .eq("organization_id", orgId)
    .single();

  return data;
}

export async function saveCompany(data: Record<string, unknown>) {
  const { supabase, orgId } = await getOrgId();
  if (!orgId) return { error: "Organização não encontrada" };

  const settings = {
    organization_id: orgId,
    ...data,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("company_settings").upsert(
    settings,
    { onConflict: "organization_id" }
  );

  if (error) return { error: error.message };

  const sync = await syncCompanyWithLocalFiscal({
    organizationId: orgId,
    ...settings,
  });

  await supabase
    .from("company_settings")
    .update({
      local_fiscal_sync_status: sync.ok ? "success" : "error",
      local_fiscal_sync_message: sync.ok ? null : sync.message,
      local_fiscal_last_sync_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId);

  revalidatePath("/empresa");
  return { success: true, syncError: sync.ok ? undefined : sync.message };
}
