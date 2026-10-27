import Link from "next/link";
import { getDashboardStats, getInvoices } from "@/actions/fiscal";
import { AlertCircle, FilePlus, FileText, ListOrdered, TrendingUp, Users } from "lucide-react";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  authorized: { label: "Autorizada", className: "bg-green-100 text-green-700" },
  processing: { label: "Processando", className: "bg-yellow-100 text-yellow-700" },
  error: { label: "Erro", className: "bg-red-100 text-red-700" },
  draft: { label: "Rascunho", className: "bg-gray-100 text-gray-600" },
  cancelled: { label: "Cancelada", className: "bg-gray-100 text-gray-500" },
};

type RecentInvoice = {
  id: string;
  status: string;
  valor_total?: number | null;
  descricao_servico?: string | null;
  clients?: { nome?: string | null } | null;
};

export default async function DashboardPage() {
  const [stats, notas] = await Promise.all([
    getDashboardStats(),
    getInvoices({ mes: undefined }),
  ]);

  const recentes = notas.slice(0, 5) as RecentInvoice[];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="page-title">Início</h1>
        <p className="page-subtitle">
          {new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/emitir"
          className="card flex min-h-24 items-center gap-4 transition-all hover:border-blue-300 hover:shadow-sm"
        >
          <div className="rounded-lg bg-blue-600 p-3">
            <FilePlus size={22} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Emitir Nota</p>
            <p className="text-sm text-gray-500">Nota avulsa para qualquer cliente</p>
          </div>
        </Link>

        <Link
          href="/lote"
          className="card flex min-h-24 items-center gap-4 transition-all hover:border-blue-300 hover:shadow-sm"
        >
          <div className="rounded-lg bg-indigo-600 p-3">
            <ListOrdered size={22} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Emissão em Lote</p>
            <p className="text-sm text-gray-500">Emitir todas as notas do mês</p>
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card flex items-center gap-4">
          <div className="rounded-lg bg-blue-50 p-2.5">
            <FileText size={20} className="text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.notasNoMes}</p>
            <p className="text-sm text-gray-500">Notas no mês</p>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div className="rounded-lg bg-green-50 p-2.5">
            <TrendingUp size={20} className="text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">
              {stats.totalFaturado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <p className="text-sm text-gray-500">Faturado (autorizadas)</p>
          </div>
        </div>

        <div className="card flex items-center gap-4">
          <div className="rounded-lg bg-purple-50 p-2.5">
            <Users size={20} className="text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalClientes}</p>
            <p className="text-sm text-gray-500">Clientes ativos</p>
          </div>
        </div>
      </div>

      {recentes.length > 0 && (
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Notas recentes</h2>
            <Link href="/notas" className="text-sm text-blue-600 hover:underline">
              Ver todas
            </Link>
          </div>

          <div className="space-y-2">
            {recentes.map((nota) => {
              const status = STATUS_LABEL[nota.status] || {
                label: nota.status,
                className: "bg-gray-100 text-gray-600",
              };

              return (
                <div key={nota.id} className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {nota.clients?.nome || "Cliente não encontrado"}
                    </p>
                    <p className="truncate text-xs text-gray-500">{nota.descricao_servico}</p>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-sm font-medium text-gray-900">
                      {(nota.valor_total || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recentes.length === 0 && (
        <div className="card py-10 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">Nenhuma nota emitida ainda.</p>
          <p className="mt-1 text-sm text-gray-400">
            Comece cadastrando sua empresa e seus clientes.
          </p>
        </div>
      )}
    </div>
  );
}
