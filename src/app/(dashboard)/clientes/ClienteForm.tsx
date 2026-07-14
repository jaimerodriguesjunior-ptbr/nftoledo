"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveClient } from "@/actions/clientes";
import { Plus, Trash2 } from "lucide-react";

type Service = {
  descricao: string;
  valor_mensal: string;
};

type InitialData = {
  id?: string;
  nome?: string;
  cpf_cnpj?: string;
  email?: string;
  telefone?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  codigo_municipio_ibge?: string;
  client_services?: Array<{
    descricao: string;
    valor_mensal?: number | null;
  }>;
};

export default function ClienteForm({ initial }: { initial?: InitialData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    nome: initial?.nome || "",
    cpf_cnpj: initial?.cpf_cnpj || "",
    email: initial?.email || "",
    telefone: initial?.telefone || "",
    logradouro: initial?.logradouro || "",
    numero: initial?.numero || "",
    complemento: initial?.complemento || "",
    bairro: initial?.bairro || "",
    cidade: initial?.cidade || "",
    uf: initial?.uf || "",
    cep: initial?.cep || "",
    codigo_municipio_ibge: initial?.codigo_municipio_ibge || "",
  });

  const [services, setServices] = useState<Service[]>(
    initial?.client_services?.map((service) => ({
      descricao: service.descricao || "",
      valor_mensal: service.valor_mensal != null ? String(service.valor_mensal) : "",
    })) || []
  );

  const setField = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const setService = (index: number, field: keyof Service, value: string) =>
    setServices((prev) => prev.map((service, i) => (i === index ? { ...service, [field]: value } : service)));

  const addService = () =>
    setServices((prev) => [...prev, { descricao: "", valor_mensal: "" }]);

  const removeService = (index: number) =>
    setServices((prev) => prev.filter((_, i) => i !== index));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) {
      setError("Nome e obrigatorio.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await saveClient({
        id: initial?.id,
        ...form,
        services: services.map((service) => ({
          descricao: service.descricao,
          valor_mensal: service.valor_mensal ? parseFloat(service.valor_mensal.replace(",", ".")) : null,
        })),
      });

      if (result?.error) setError(result.error);
      else router.push("/clientes");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="card space-y-4">
        <h2 className="font-semibold text-gray-800">Dados do cliente</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="label">Nome *</label>
            <input className="input" value={form.nome} onChange={(e) => setField("nome", e.target.value)} required />
          </div>
          <div>
            <label className="label">CPF / CNPJ</label>
            <input className="input" value={form.cpf_cnpj} onChange={(e) => setField("cpf_cnpj", e.target.value)} placeholder="Somente numeros" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} />
          </div>
          <div>
            <label className="label">Telefone</label>
            <input className="input" value={form.telefone} onChange={(e) => setField("telefone", e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-gray-800">Endereco <span className="text-sm font-normal text-gray-400">(opcional)</span></h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className="label">Logradouro</label>
            <input className="input" value={form.logradouro} onChange={(e) => setField("logradouro", e.target.value)} />
          </div>
          <div>
            <label className="label">Numero</label>
            <input className="input" value={form.numero} onChange={(e) => setField("numero", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Bairro</label>
            <input className="input" value={form.bairro} onChange={(e) => setField("bairro", e.target.value)} />
          </div>
          <div>
            <label className="label">CEP</label>
            <input className="input" value={form.cep} onChange={(e) => setField("cep", e.target.value)} placeholder="00000-000" />
          </div>
          <div>
            <label className="label">Complemento</label>
            <input className="input" value={form.complemento} onChange={(e) => setField("complemento", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Cidade</label>
            <input className="input" value={form.cidade} onChange={(e) => setField("cidade", e.target.value)} />
          </div>
          <div>
            <label className="label">UF</label>
            <input className="input" value={form.uf} onChange={(e) => setField("uf", e.target.value)} maxLength={2} />
          </div>
          <div>
            <label className="label">IBGE Municipio</label>
            <input className="input" value={form.codigo_municipio_ibge} onChange={(e) => setField("codigo_municipio_ibge", e.target.value)} placeholder="Ex: 4127700" />
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Servicos mensais</h2>
            <p className="mt-0.5 text-xs text-gray-400">Para emissao em lote ou nota recorrente</p>
          </div>
          <button type="button" onClick={addService} className="btn-secondary flex items-center gap-1.5 py-1.5 text-xs">
            <Plus size={14} /> Adicionar
          </button>
        </div>

        {services.length === 0 && (
          <p className="text-sm text-gray-400">Nenhum servico mensal cadastrado.</p>
        )}

        {services.map((service, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <label className="label">Descricao do servico *</label>
                <input className="input" value={service.descricao} onChange={(e) => setService(index, "descricao", e.target.value)} placeholder="Ex: Honorarios contabeis - abril/2026" />
              </div>
              <button type="button" onClick={() => removeService(index)} className="mt-6 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                <Trash2 size={15} />
              </button>
            </div>
            <div>
              <label className="label">Valor mensal (R$)</label>
              <input className="input" value={service.valor_mensal} onChange={(e) => setService(index, "valor_mensal", e.target.value)} placeholder="0,00" />
            </div>
          </div>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={isPending} className="btn-primary">
          {isPending ? "Salvando..." : "Salvar cliente"}
        </button>
        <button type="button" onClick={() => router.back()} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </form>
  );
}
