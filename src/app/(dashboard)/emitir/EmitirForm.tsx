"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { emitirNFSe } from "@/actions/fiscal";
import { AlertCircle, CheckCircle } from "lucide-react";

type Client = {
  id: string;
  nome: string;
  cpf_cnpj?: string | null;
  client_services?: Array<{
    descricao: string;
    valor_mensal?: number | null;
  }>;
};

type Empresa = {
  codigo_servico_padrao?: string | null;
  environment?: string | null;
};

export default function EmitirForm({ clientes, empresa }: { clientes: Client[]; empresa: Empresa }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; error?: string; invoiceId?: string } | null>(null);

  const [clienteId, setClienteId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [environment, setEnvironment] = useState(empresa.environment || "production");

  function handleClienteChange(nextClienteId: string) {
    setClienteId(nextClienteId);
    if (!nextClienteId) return;

    const cliente = clientes.find((item) => item.id === nextClienteId);
    const servico = cliente?.client_services?.[0];
    if (servico?.descricao) setDescricao(servico.descricao);
    if (servico?.valor_mensal) setValor(String(servico.valor_mensal));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clienteId) {
      setResult({ success: false, error: "Selecione um cliente." });
      return;
    }

    const valorNum = parseFloat(valor.replace(",", "."));
    if (!valorNum || valorNum <= 0) {
      setResult({ success: false, error: "Informe um valor valido." });
      return;
    }

    if (!empresa.codigo_servico_padrao?.trim()) {
      setResult({ success: false, error: "Configure o codigo de servico em Minha Empresa antes de emitir." });
      return;
    }

    setResult(null);
    startTransition(async () => {
      const res = await emitirNFSe({
        clientId: clienteId,
        descricao: descricao.trim(),
        valor: valorNum,
        environment: environment as "production" | "homologation",
      });

      setResult({ ...res, invoiceId: res.invoiceId ?? undefined });
      if (res.success) {
        setDescricao("");
        setValor("");
        setClienteId("");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5">
      <div>
        <label className="label">Cliente *</label>
        <select className="input" value={clienteId} onChange={(e) => handleClienteChange(e.target.value)} required>
          <option value="">Selecione um cliente...</option>
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {cliente.nome}{cliente.cpf_cnpj ? ` - ${cliente.cpf_cnpj}` : ""}
            </option>
          ))}
        </select>
        {clientes.length === 0 && (
          <p className="mt-1 text-xs text-amber-600">
            Nenhum cliente cadastrado. <Link href="/clientes/novo" className="underline">Cadastrar agora</Link>
          </p>
        )}
      </div>

      <div>
        <label className="label">Descricao do servico *</label>
        <input
          className="input"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          required
          placeholder="Ex: Consultoria contabil - Abril/2026"
        />
      </div>

      <div>
        <label className="label">Valor (R$) *</label>
        <input
          className="input"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          required
          placeholder="0,00"
        />
      </div>

      <div>
        <label className="label">Ambiente</label>
        <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
          <option value="production">Producao</option>
          <option value="homologation">Homologacao (testes)</option>
        </select>
      </div>

      {result?.success && (
        <div className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-700">
          <CheckCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Nota enviada com sucesso!</p>
            <p className="mt-0.5 text-green-600">
              A nota está em processamento no fluxo da SEFIN Nacional. Acompanhe em <Link href="/notas" className="underline">Notas Emitidas</Link>.
            </p>
          </div>
        </div>
      )}

      {result && !result.success && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Erro ao emitir</p>
            <p className="mt-0.5 whitespace-pre-wrap text-red-600">{result.error}</p>
          </div>
        </div>
      )}

      <button type="submit" disabled={isPending} className="btn-primary w-full py-2.5">
        {isPending ? "Emitindo nota..." : "Emitir NFS-e"}
      </button>
    </form>
  );
}
