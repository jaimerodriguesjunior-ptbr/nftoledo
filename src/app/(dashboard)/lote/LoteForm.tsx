"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getClientsForBatch, saveClientBatchService } from "@/actions/clientes";
import { emitirNFSe } from "@/actions/fiscal";
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";

type BatchService = {
  id?: string;
  descricao?: string | null;
  valor_mensal?: number | null;
};

type Client = {
  id: string;
  nome: string;
  cpf_cnpj?: string | null;
  batch_service?: BatchService | null;
};

type Empresa = {
  environment?: string | null;
};

type Row = {
  client: Client;
  selected: boolean;
  valor: string;
  preferredDescricao?: string;
  status: "idle" | "loading" | "success" | "error";
  error?: string;
};

type Step = "selection" | "review";
type SpecialBatchItem = {
  clientId: string;
  clientName?: string;
  invoiceId?: string;
  createdAt?: string;
  valor?: number;
  descricao?: string;
};

const PAGE_SIZE = 20;
const BATCH_SIZE = 1;
const RETRY_DELAY_MS = 10000;

function moneyFromNumber(value?: number | null) {
  return value ? String(value).replace(".", ",") : "";
}

function parseMoney(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function onlyDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasValidCpfOrCnpj(value?: string | null) {
  const doc = onlyDigits(value);

  if (doc.length === 11) {
    if (/^(\d)\1+$/.test(doc)) return false;
    const calc = (slice: string, factor: number) => {
      const total = slice.split("").reduce((sum, digit) => sum + Number(digit) * factor--, 0);
      const rest = (total * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    return calc(doc.slice(0, 9), 10) === Number(doc[9]) && calc(doc.slice(0, 10), 11) === Number(doc[10]);
  }

  if (doc.length === 14) {
    if (/^(\d)\1+$/.test(doc)) return false;
    const calc = (slice: string, factors: number[]) => {
      const total = slice.split("").reduce((sum, digit, index) => sum + Number(digit) * factors[index], 0);
      const rest = total % 11;
      return rest < 2 ? 0 : 11 - rest;
    };
    return (
      calc(doc.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(doc[12]) &&
      calc(doc.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(doc[13])
    );
  }

  return false;
}

function getMeses() {
  const meses = [];
  const now = new Date();

  for (let i = -1; i <= 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  return meses;
}

function mesLabel(mes: string) {
  const [year, month] = mes.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function buildRows(
  clientes: Client[],
  overrides?: Map<string, { valor?: number; descricao?: string }>,
  specialOnly = false
): Row[] {
  return clientes.map((client) => {
    const override = overrides?.get(client.id);
    const valor = moneyFromNumber(override?.valor ?? client.batch_service?.valor_mensal);

    return {
      client,
      selected: override ? true : (specialOnly ? false : parseMoney(valor) > 0),
      valor,
      preferredDescricao: override?.descricao?.trim() || undefined,
      status: "idle",
    };
  });
}

function decodeSpecialPayload(encoded: string): SpecialBatchItem[] {
  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    const parsed = JSON.parse(json) as SpecialBatchItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dedupeSpecialItems(items: SpecialBatchItem[]) {
  const byClient = new Map<string, SpecialBatchItem>();
  for (const item of items) {
    if (!item?.clientId) continue;
    const existing = byClient.get(item.clientId);
    const itemTime = new Date(item.createdAt || 0).getTime();
    const existingTime = new Date(existing?.createdAt || 0).getTime();
    if (!existing || itemTime >= existingTime) {
      byClient.set(item.clientId, item);
    }
  }
  return byClient;
}

export default function LoteForm({
  initialClientes,
  empresa,
  initialMes,
  initialEnvironment,
  initialSpecialPayload,
  initialSpecialKey,
  isSpecialMode,
}: {
  initialClientes: Client[];
  empresa: Empresa;
  initialMes: string;
  initialEnvironment?: string;
  initialSpecialPayload?: string | null;
  initialSpecialKey?: string | null;
  isSpecialMode?: boolean;
}) {
  const router = useRouter();
  const [mes, setMes] = useState(initialMes);
  const [environment, setEnvironment] = useState(initialEnvironment || empresa.environment || "production");
  const [rows, setRows] = useState<Row[]>(() => buildRows(initialClientes));
  const [step, setStep] = useState<Step>("selection");
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [page, setPage] = useState(1);
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [specialWarning, setSpecialWarning] = useState<string | null>(null);
  const listTopRef = useRef<HTMLDivElement | null>(null);
  const prevPageRef = useRef(page);
  const [specialOverrides] = useState<Map<string, { valor?: number; descricao?: string }>>(() => {
    if (!isSpecialMode) return new Map();

    let items: SpecialBatchItem[] = [];
    if (initialSpecialPayload) {
      items = decodeSpecialPayload(initialSpecialPayload);
    } else if (initialSpecialKey && typeof window !== "undefined") {
      const raw = sessionStorage.getItem(initialSpecialKey);
      if (raw) {
        try {
          items = JSON.parse(raw) as SpecialBatchItem[];
        } catch {
          items = [];
        }
        sessionStorage.removeItem(initialSpecialKey);
      }
    }

    const deduped = dedupeSpecialItems(items);
    const overrides = new Map<string, { valor?: number; descricao?: string }>();
    for (const [clientId, item] of deduped.entries()) {
      overrides.set(clientId, {
        valor: Number(item.valor || 0),
        descricao: item.descricao || "",
      });
    }
    return overrides;
  });
  const isStrictSpecialSelection = Boolean(isSpecialMode && specialOverrides.size > 0);

  useEffect(() => {
    let active = true;

    async function loadMonth() {
      if (mes === initialMes) {
        setRows(buildRows(initialClientes, specialOverrides, isStrictSpecialSelection));
        if (specialOverrides.size > 0) {
          const availableIds = new Set(initialClientes.map((client) => client.id));
          const missingCount = Array.from(specialOverrides.keys()).filter((id) => !availableIds.has(id)).length;
          setSpecialWarning(
            missingCount > 0
              ? `${missingCount} cliente${missingCount !== 1 ? "s" : ""} do lote especial já não está disponível neste mês/ambiente.`
              : null
          );
        } else {
          setSpecialWarning(null);
        }
        setStep("selection");
        return;
      }

      setIsLoadingMonth(true);
      setFormError(null);
      const clientesData = await getClientsForBatch(mes, environment as "production" | "homologation");
      if (!active) return;
      const availableClients = clientesData.clients as Client[];
      setRows(buildRows(availableClients, specialOverrides, isStrictSpecialSelection));
      if (specialOverrides.size > 0) {
        const availableIds = new Set(availableClients.map((client) => client.id));
        const missingCount = Array.from(specialOverrides.keys()).filter((id) => !availableIds.has(id)).length;
        setSpecialWarning(
          missingCount > 0
            ? `${missingCount} cliente${missingCount !== 1 ? "s" : ""} do lote especial já não está disponível neste mês/ambiente.`
            : null
        );
      } else {
        setSpecialWarning(null);
      }
      setStep("selection");
      setPage(1);
      setIsLoadingMonth(false);
    }

    loadMonth().catch((error) => {
      if (!active) return;
      setFormError(error instanceof Error ? error.message : "Não foi possível carregar os clientes do mês.");
      setIsLoadingMonth(false);
    });

    return () => {
      active = false;
    };
  }, [environment, initialClientes, initialMes, mes, specialOverrides, isStrictSpecialSelection]);

  useEffect(() => {
    const pageChanged = prevPageRef.current !== page;
    prevPageRef.current = page;
    if (!pageChanged || step !== "selection") return;

    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [page, step]);

  const selectedRows = rows.filter((row) => row.selected);
  const selectedCount = selectedRows.length;
  const specialSelectedCount = rows.filter((row) => row.selected && row.preferredDescricao).length;
  const total = selectedRows.reduce((sum, row) => sum + parseMoney(row.valor), 0);
  const successCount = rows.filter((row) => row.status === "success").length;
  const errorCount = rows.filter((row) => row.status === "error").length;

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesQuery = !normalizedQuery || row.client.nome.toLowerCase().includes(normalizedQuery);
      const matchesSelected = !onlySelected || row.selected;
      return matchesQuery && matchesSelected;
    });
  }, [onlySelected, query, rows]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const showPagination = filteredRows.length > PAGE_SIZE;

  const updateRow = (clientId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.client.id === clientId ? { ...row, ...patch } : row)));
  };

  const validateSelected = () => {
    let hasError = false;

    setRows((prev) =>
      prev.map((row) => {
        if (!row.selected) return { ...row, error: undefined };

        const valor = parseMoney(row.valor);
        if (valor <= 0) {
          hasError = true;
          return { ...row, status: "error", error: "Informe um valor maior que zero." };
        }

        if (!hasValidCpfOrCnpj(row.client.cpf_cnpj)) {
          hasError = true;
          return { ...row, status: "error", error: "CPF/CNPJ ausente ou inválido." };
        }

        return { ...row, status: row.status === "success" ? "success" : "idle", error: undefined };
      })
    );

    return !hasError;
  };

  const handleEvaluate = () => {
    setFormError(null);

    if (selectedCount === 0) {
      setFormError("Selecione pelo menos um cliente para avaliar.");
      return;
    }

    if (!validateSelected()) {
      setFormError("Corrija os clientes marcados em vermelho antes de emitir.");
      return;
    }

    setStep("review");
  };

  async function handleEmitir() {
    setFormError(null);

    if (!validateSelected()) {
      setStep("selection");
      setFormError("Corrija os clientes marcados em vermelho antes de emitir.");
      return;
    }

    setIsRunning(true);

    const processEmission = async (row: Row) => {
      const valor = parseMoney(row.valor);
      const service = row.client.batch_service;
      const descricao = row.preferredDescricao || service?.descricao?.trim() || `Serviços mensais - ${mesLabel(mes)}`;

      updateRow(row.client.id, { status: "loading", error: undefined });

      try {
        const saved = await saveClientBatchService({
          clientId: row.client.id,
          descricao,
          valorMensal: valor,
          skipRevalidation: true,
        });

        if (saved?.error) {
          updateRow(row.client.id, { status: "error", error: saved.error });
          return { success: false, error: saved.error };
        }

        const res = await emitirNFSe({
          clientId: row.client.id,
          descricao,
          valor,
          environment: environment as "production" | "homologation",
          mesReferencia: mes,
          emissionOrigin: "batch",
        });

        updateRow(row.client.id, {
          status: res.success ? "success" : "error",
          error: res.success ? undefined : res.error,
        });
        return { success: res.success, error: res.error };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Não foi possível emitir esta nota.";
        updateRow(row.client.id, { status: "error", error: message });
        return { success: false, error: message };
      }
    };

    // Throttle: emite uma nota por vez, aguardando RETRY_DELAY_MS entre cada
    // uma para evitar travamento/limite de taxa da Nuvem Fiscal.
    for (let start = 0; start < selectedRows.length; start += BATCH_SIZE) {
      const chunk = selectedRows.slice(start, start + BATCH_SIZE).filter((row) => row.status !== "success");
      if (chunk.length === 0) continue;

      if (start > 0) {
        await sleep(RETRY_DELAY_MS);
      }

      await Promise.all(chunk.map(processEmission));
    }

    setIsRunning(false);
    router.push(`/notas?mes=${encodeURIComponent(mes)}&ambiente=${encodeURIComponent(environment)}`);
  }

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => row.selected);

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-2 gap-3 p-4">
        <div className="min-w-0">
          <label className="mb-1 block text-xs font-medium text-gray-700">Mês de referência</label>
          <select className="input h-10 px-2 text-sm" value={mes} onChange={(event) => setMes(event.target.value)} disabled={isRunning}>
            {getMeses().map((item) => (
              <option key={item} value={item}>{mesLabel(item)}</option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label className="mb-1 block text-xs font-medium text-gray-700">Ambiente</label>
          <select className="input h-10 px-2 text-sm" value={environment} onChange={(event) => setEnvironment(event.target.value)} disabled={isRunning}>
            <option value="production">Produção</option>
            <option value="homologation">Homologação (testes)</option>
          </select>
        </div>
      </div>

      {formError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{formError}</p>
        </div>
      )}
      {specialWarning && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{specialWarning}</p>
        </div>
      )}
      {isStrictSpecialSelection && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          Lote especial ativo: {specialSelectedCount} cliente{specialSelectedCount !== 1 ? "s" : ""} pré-selecionado{specialSelectedCount !== 1 ? "s" : ""}.
        </div>
      )}

      {step === "selection" ? (
        <>
              <div ref={listTopRef} className="card p-0 overflow-hidden">
                <div className="space-y-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() => {
                      const nextSelected = !allVisibleSelected;
                      setRows((prev) =>
                        prev.map((row) =>
                          visibleRows.some((visible) => visible.client.id === row.client.id)
                            ? { ...row, selected: nextSelected, status: row.status === "success" ? "success" : "idle", error: undefined }
                            : row
                        )
                      );
                    }}
                    disabled={isRunning || isLoadingMonth}
                  />
                  Selecionar visíveis
                </label>

                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={onlySelected} onChange={(event) => setOnlySelected(event.target.checked)} />
                  Somente selecionados
                </label>
              </div>

              <div className="relative min-w-56 flex-1">
                <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                <input
                  className="input pl-9"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Buscar cliente"
                  disabled={isRunning}
                />
              </div>
            </div>

            {isLoadingMonth ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                Carregando clientes...
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {visibleRows.map((row) => {
                  const valueMissing = row.selected && parseMoney(row.valor) <= 0;
                  const docInvalid = row.selected && !hasValidCpfOrCnpj(row.client.cpf_cnpj);

                  return (
                    <div key={row.client.id} className="grid grid-cols-[24px_1fr] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[28px_1fr_180px_160px] sm:items-center">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(event) => updateRow(row.client.id, { selected: event.target.checked, error: undefined, status: row.status === "success" ? "success" : "idle" })}
                        disabled={isRunning || row.status === "success"}
                        className="mt-1 sm:mt-0"
                      />

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{row.client.nome}</p>
                        <p className={`text-xs ${docInvalid ? "text-red-600" : "text-gray-500"}`}>
                          {row.client.cpf_cnpj || "CPF/CNPJ não informado"}
                        </p>
                        {row.error && <p className="mt-1 text-xs text-red-600">{row.error}</p>}
                      </div>

                      <div className="col-span-2 sm:col-span-1">
                        <label className="sr-only">Valor mensal</label>
                        <input
                          className={`input ${valueMissing ? "border-red-400 bg-red-50 text-red-700 focus:ring-red-500" : ""}`}
                          value={row.valor}
                          onChange={(event) => updateRow(row.client.id, { valor: event.target.value, selected: true, error: undefined, status: row.status === "success" ? "success" : "idle" })}
                          placeholder="0,00"
                          disabled={isRunning || row.status === "success"}
                        />
                      </div>

                      <div className="col-span-2 text-sm sm:col-span-1 sm:text-right">
                        {row.status === "success" && <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle size={14} /> Emitida</span>}
                        {row.status === "loading" && <span className="inline-flex items-center gap-1 text-blue-600"><Loader2 size={14} className="animate-spin" /> Emitindo</span>}
                        {row.status === "error" && <span className="inline-flex items-center gap-1 text-red-600"><AlertCircle size={14} /> Erro</span>}
                        {row.status === "idle" && row.selected && <span className="text-gray-400">Selecionado</span>}
                      </div>
                    </div>
                  );
                })}

                {visibleRows.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-gray-500">Nenhum cliente encontrado.</div>
                )}
              </div>
            )}
          </div>

          {showPagination && (
            <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
                <button type="button" className="btn-secondary px-3" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                <ChevronLeft size={16} />
              </button>
              <span>Pagina {currentPage} de {pageCount}</span>
              <button type="button" className="btn-secondary px-3" onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))} disabled={currentPage === pageCount}>
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={handleEvaluate} disabled={isRunning || isLoadingMonth || selectedCount === 0}>
              Continue (avaliar lote)
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card">
              <p className="text-sm text-gray-500">Clientes no lote</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{selectedCount}</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500">Valor total</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500">Emitidas / erros</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{successCount} / {errorCount}</p>
            </div>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700">
              Clientes selecionados
            </div>
            <div className="divide-y divide-gray-100">
              {selectedRows.map((row) => (
                <div key={row.client.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_160px_170px] sm:items-center">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{row.client.nome}</p>
                    <p className="text-xs text-gray-500">{row.client.cpf_cnpj}</p>
                    {row.error && <p className="mt-1 text-xs text-red-600">{row.error}</p>}
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {parseMoney(row.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </p>
                  <p className="text-sm sm:text-right">
                    {row.status === "success" && <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle size={14} /> Emitida</span>}
                    {row.status === "loading" && <span className="inline-flex items-center gap-1 text-blue-600"><Loader2 size={14} className="animate-spin" /> Emitindo</span>}
                    {row.status === "error" && <span className="inline-flex items-center gap-1 text-red-600"><AlertCircle size={14} /> Erro</span>}
                    {row.status === "idle" && <span className="text-gray-400">Pronta</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setStep("selection")} disabled={isRunning}>
              Voltar
            </button>
            <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={handleEmitir} disabled={isRunning || selectedCount === 0}>
              {isRunning && <Loader2 size={16} className="animate-spin" />}
              {isRunning ? "Emitindo..." : "Emitir lote"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
