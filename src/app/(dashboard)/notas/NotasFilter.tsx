"use client";

import { useRouter } from "next/navigation";

function getMeses() {
  const meses = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    meses.push({ val, label });
  }
  return meses;
}

export default function NotasFilter({ mesAtual, statusAtual, ambienteAtual }: { mesAtual: string; statusAtual: string; ambienteAtual: string }) {
  const router = useRouter();
  const meses = getMeses();

  function update(mes: string, status: string, ambiente: string) {
    const params = new URLSearchParams();
    if (mes) params.set("mes", mes);
    if (status) params.set("status", status);
    if (ambiente) params.set("ambiente", ambiente);
    router.push(`/notas?${params.toString()}`);
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="min-w-0">
        <label className="mb-1 block text-xs font-medium text-gray-700">Mês</label>
        <select
          className="input h-10 px-2 text-sm"
          value={mesAtual}
          onChange={(e) => update(e.target.value, statusAtual, ambienteAtual)}
        >
          <option value="">Todos os meses</option>
          {meses.map((mes) => (
            <option key={mes.val} value={mes.val}>{mes.label}</option>
          ))}
        </select>
      </div>

      <div className="min-w-0">
        <label className="mb-1 block text-xs font-medium text-gray-700">Status</label>
        <select
          className="input h-10 px-2 text-sm"
          value={statusAtual}
          onChange={(e) => update(mesAtual, e.target.value, ambienteAtual)}
        >
          <option value="">Todos</option>
          <option value="authorized">Autorizada</option>
          <option value="processing">Processando</option>
          <option value="error">Erro</option>
          <option value="cancelled">Cancelada</option>
        </select>
      </div>

      <div className="min-w-0">
        <label className="mb-1 block text-xs font-medium text-gray-700">Ambiente</label>
        <select
          className="input h-10 px-2 text-sm"
          value={ambienteAtual}
          onChange={(e) => update(mesAtual, statusAtual, e.target.value)}
        >
          <option value="production">Somente produção</option>
          <option value="all">Todos (produção + homologação)</option>
          <option value="homologation">Somente homologação</option>
        </select>
      </div>
    </div>
  );
}
