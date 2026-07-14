import { getClientsForBatch } from "@/actions/clientes";
import { getCompany } from "@/actions/empresa";
import LoteForm from "./LoteForm";
import { CheckCircle2, ListOrdered, RotateCw, Users } from "lucide-react";
import Link from "next/link";

function getMesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMes(mes: string) {
  const [year, month] = mes.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LotePage({
  searchParams,
}: {
  searchParams: Promise<{
    novo?: string | string[];
    mes?: string | string[];
    ambiente?: "all" | "production" | "homologation" | string[];
    special?: string | string[];
    reemit?: string | string[];
    reemitKey?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const forceNew = firstParam(params.novo) === "1";
  const mesAtual = firstParam(params.mes) || getMesAtual();
  const ambienteParam = firstParam(params.ambiente);
  const environment =
    ambienteParam === "production" || ambienteParam === "homologation"
      ? ambienteParam
      : undefined;
  const special = firstParam(params.special) === "1";
  const reemit = firstParam(params.reemit) || null;
  const reemitKey = firstParam(params.reemitKey) || null;

  const [clientesResult, empresa] = await Promise.allSettled([
    getClientsForBatch(mesAtual, environment),
    getCompany(),
  ]);
  const clientesError = clientesResult.status === "rejected" ? clientesResult.reason : null;
  const batchData = clientesResult.status === "fulfilled" ? clientesResult.value : null;
  const clientes = batchData?.clients || [];
  const company = empresa.status === "fulfilled" ? empresa.value : null;

  if (!company?.cnpj) {
    return (
      <div className="max-w-2xl">
        <h1 className="page-title flex items-center gap-2 mb-6"><ListOrdered size={24} /> Emissão em Lote</h1>
        <div className="card text-center py-10">
          <p className="text-gray-600 font-medium">Configure sua empresa primeiro</p>
          <Link href="/empresa" className="btn-primary mt-4 inline-block">Configurar empresa</Link>
        </div>
      </div>
    );
  }

  if (clientesError) {
    return (
      <div className="max-w-2xl">
        <h1 className="page-title flex items-center gap-2 mb-6"><ListOrdered size={24} /> Emissão em Lote</h1>
        <div className="card space-y-3">
          <p className="font-medium text-gray-900">Atualização do banco pendente</p>
          <p className="text-sm text-gray-600">
            Execute o arquivo <span className="font-mono">migration_batch_origin.sql</span> no SQL Editor do Supabase e recarregue esta página.
          </p>
          <p className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">
            {clientesError instanceof Error ? clientesError.message : "Não foi possível carregar os clientes do lote."}
          </p>
        </div>
      </div>
    );
  }

  const mesFormatado = formatMes(mesAtual);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2"><ListOrdered size={24} /> Emissão em Lote</h1>
        <p className="page-subtitle">Selecione os clientes, revise valores e emita as notas do mês</p>
      </div>

      {clientes.length === 0 ? (
        <div className="card py-10 text-center space-y-3">
          {!forceNew && batchData && batchData.alreadyEmitted > 0 ? (
            <>
              <CheckCircle2 size={36} className="mx-auto text-green-600" />
              <p className="font-bold text-gray-900">
                Lote de {mesFormatado} já foi emitido!
              </p>
              <p className="text-sm text-gray-500">
                {batchData.alreadyEmitted} nota{batchData.alreadyEmitted !== 1 ? "s" : ""} emitida{batchData.alreadyEmitted !== 1 ? "s" : ""} em lote neste mês.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-2">
                <Link href="/lote?novo=1" className="btn-primary inline-flex items-center gap-2">
                  <RotateCw size={15} /> Emitir novo lote
                </Link>
                <Link href="/notas" className="btn-secondary inline-flex items-center gap-2">
                  Ver notas emitidas
                </Link>
              </div>
            </>
          ) : forceNew && batchData && batchData.alreadyEmitted > 0 ? (
            <>
              <Users size={36} className="mx-auto text-gray-300" />
              <p className="font-bold text-gray-900">Nenhum cliente disponível para um novo lote</p>
              <p className="text-sm text-gray-500">
                Todos os clientes com serviço ativo já tiveram suas notas emitidas neste mês.
                Se você cadastrar novos clientes, eles aparecerão aqui automaticamente.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-2">
                <Link href="/clientes/novo" className="btn-primary inline-flex items-center gap-2">
                  Cadastrar cliente
                </Link>
                <Link href="/notas" className="btn-secondary inline-flex items-center gap-2">
                  Ver notas emitidas
                </Link>
              </div>
            </>
          ) : batchData && batchData.totalClients > 0 ? (
            <>
              <Users size={36} className="mx-auto text-gray-300" />
              <p className="font-bold text-gray-900">Nenhum cliente com serviço configurado</p>
              <p className="text-sm text-gray-500">
                Você tem {batchData.totalClients} cliente{batchData.totalClients !== 1 ? "s" : ""}, mas nenhum possui serviço mensal ativo para emitir em lote.
              </p>
              <Link href="/clientes" className="btn-primary inline-flex items-center gap-2 mt-2">
                Configurar clientes
              </Link>
            </>
          ) : (
            <>
              <Users size={36} className="mx-auto text-gray-300" />
              <p className="font-bold text-gray-900">Nenhum cliente cadastrado</p>
              <p className="text-sm text-gray-500">
                Cadastre clientes com serviço mensal para emitir notas em lote.
              </p>
              <Link href="/clientes/novo" className="btn-primary inline-flex items-center gap-2 mt-2">
                Cadastrar cliente
              </Link>
            </>
          )}
        </div>
      ) : (
        <LoteForm
          initialClientes={clientes}
          empresa={company}
          initialMes={mesAtual}
          initialEnvironment={environment || company.environment || "production"}
          initialSpecialPayload={reemit}
          initialSpecialKey={reemitKey}
          isSpecialMode={special}
        />
      )}
    </div>
  );
}
