"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { syncCompanyWithLocalFiscal } from "@/lib/nuvem-local-fiscal";
import { pickCompanySettings } from "@/lib/company-settings";

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
    ...pickCompanySettings(data),
    organization_id: orgId,
    updated_at: new Date().toISOString(),
  };

  const syncResults = await Promise.all(
    (["production", "homologation"] as const).map(async (environment) => ({
      environment,
      result: await syncCompanyWithLocalFiscal({
        ...settings,
        organizationId: orgId,
        environment,
      }),
    }))
  );
  const syncFailure = syncResults.find(({ result }) => !result.ok);
  if (syncFailure && !syncFailure.result.ok) {
    return {
      error:
        `A empresa não foi salva porque a sincronização fiscal falhou em ${syncFailure.environment}: ` +
        syncFailure.result.message,
    };
  }

  const { error } = await supabase.from("company_settings").upsert(
    {
      ...settings,
      local_fiscal_sync_status: "success",
      local_fiscal_sync_message: null,
      local_fiscal_last_sync_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );

  if (error) return { error: error.message };

  revalidatePath("/empresa");
  return { success: true };
}
