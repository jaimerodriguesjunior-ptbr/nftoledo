"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckSquare } from "lucide-react";
import NotaRow from "./NotaRow";

type Nota = {
  id: string;
  client_id?: string | null;
  status?: string | null;
  numero?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
  error_message?: string | null;
  data_emissao?: string | null;
  created_at?: string | null;
  descricao_servico?: string | null;
  valor_total?: number | null;
  clients?: { nome?: string | null } | null;
};

type SpecialItem = {
  clientId: string;
  clientName: string;
  invoiceId: string;
  createdAt: string;
  valor: number;
  descricao: string;
};

function encodePayload(value: unknown) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

export default function NotasList({
  notas,
  mesAtual,
  ambienteAtual,
}: {
  notas: Nota[];
  mesAtual: string;
  ambienteAtual: string;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const errorNotas = useMemo(
    () => notas.filter((nota) => nota.status === "error" && nota.client_id),
    [notas]
  );
  const selectedCount = selectedIds.length;
  const allSelected = errorNotas.length > 0 && selectedCount === errorNotas.length;

  function toggle(notaId: string) {
    setSelectedIds((prev) => (
      prev.includes(notaId)
        ? prev.filter((id) => id !== notaId)
        : [...prev, notaId]
    ));
  }

  function selectAllVisible() {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(errorNotas.map((nota) => nota.id));
  }

  function createSpecialBatch() {
    const selectedNotas = notas.filter((nota) => selectedIds.includes(nota.id) && nota.status === "error" && nota.client_id);
    if (selectedNotas.length === 0) return;

    const byClient = new Map<string, SpecialItem>();
    for (const nota of selectedNotas) {
      const clientId = nota.client_id as string;
      const createdAt = nota.created_at || nota.data_emissao || new Date().toISOString();
      const current = byClient.get(clientId);
      if (current && new Date(current.createdAt).getTime() >= new Date(createdAt).getTime()) continue;

      byClient.set(clientId, {
        clientId,
        clientName: nota.clients?.nome || "Cliente sem nome",
        invoiceId: nota.id,
        createdAt,
        valor: Number(nota.valor_total || 0),
        descricao: nota.descricao_servico || "",
      });
    }

    const payload = Array.from(byClient.values());
    const encoded = encodePayload(payload);
    const params = new URLSearchParams({
      mes: mesAtual,
      ambiente: ambienteAtual,
      special: "1",
    });

    if (encoded.length <= 1500) {
      params.set("reemit", encoded);
    } else {
      const key = `special-batch-${Date.now()}`;
      sessionStorage.setItem(key, JSON.stringify(payload));
      params.set("reemitKey", key);
    }

    router.push(`/lote?${params.toString()}`);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium text-gray-700">
          {selectedCount} erro{selectedCount !== 1 ? "s" : ""} selecionado{selectedCount !== 1 ? "s" : ""}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            onClick={selectAllVisible}
            disabled={errorNotas.length === 0}
          >
            <CheckSquare size={15} />
            {allSelected ? "Limpar seleção" : "Selecionar erros visíveis"}
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            onClick={createSpecialBatch}
            disabled={selectedCount === 0}
          >
            Criar lote especial <ArrowRight size={15} />
          </button>
        </div>
      </div>

      <div className="card block overflow-hidden p-0 md:hidden">
        {notas.map((nota) => (
          <NotaRow
            key={nota.id}
            nota={nota}
            variant="mobile"
            selectable={nota.status === "error" && Boolean(nota.client_id)}
            selected={selectedIds.includes(nota.id)}
            onToggleSelect={() => toggle(nota.id)}
          />
        ))}
      </div>

      <div className="card hidden overflow-hidden p-0 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left">
              <th className="w-10 px-2 py-3"></th>
              <th className="px-4 py-3 font-medium text-gray-600">Data</th>
              <th className="px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="px-4 py-3 font-medium text-gray-600">Descrição</th>
              <th className="px-4 py-3 font-medium text-gray-600">Valor</th>
              <th className="px-4 py-3 font-medium text-gray-600">Nº NF</th>
              <th className="px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {notas.map((nota) => (
              <NotaRow
                key={nota.id}
                nota={nota}
                variant="desktop"
                selectable={nota.status === "error" && Boolean(nota.client_id)}
                selected={selectedIds.includes(nota.id)}
                onToggleSelect={() => toggle(nota.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
