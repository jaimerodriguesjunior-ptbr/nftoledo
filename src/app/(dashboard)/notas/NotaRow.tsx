"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { cancelarNFSe, consultarNFSe } from "@/actions/fiscal";
import { AlertCircle, Ban, ExternalLink, FileDown, RefreshCw, X } from "lucide-react";

const STATUS: Record<string, { label: string; className: string }> = {
  authorized: { label: "Autorizada", className: "bg-green-100 text-green-700" },
  processing: { label: "Processando", className: "bg-yellow-100 text-yellow-700" },
  error: { label: "Erro", className: "bg-red-100 text-red-700" },
  draft: { label: "Rascunho", className: "bg-gray-100 text-gray-600" },
  cancelled: { label: "Cancelada", className: "bg-gray-100 text-gray-500" },
};

type Nota = {
  id: string;
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

function ActionButtons({
  cancelar,
  consultar,
  errorMsg,
  isPending,
  pdfUrl,
  setShowError,
  status,
  xmlUrl,
}: {
  cancelar: () => void;
  consultar: () => void;
  errorMsg?: string | null;
  isPending: boolean;
  pdfUrl?: string | null;
  setShowError: (show: boolean) => void;
  status: string;
  xmlUrl?: string | null;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        onClick={consultar}
        disabled={isPending}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
        title="Consultar status"
        type="button"
      >
        <RefreshCw size={15} className={isPending ? "animate-spin" : ""} />
      </button>
      {status === "error" && errorMsg && (
        <button
          onClick={() => setShowError(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-700"
          title="Ver erro"
          type="button"
        >
          <AlertCircle size={15} />
        </button>
      )}
      {status === "authorized" && (
        <button
          onClick={cancelar}
          disabled={isPending}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
          title="Cancelar nota"
          type="button"
        >
          <Ban size={15} />
        </button>
      )}
      {pdfUrl && (
        <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-green-50 hover:text-green-600" title="PDF">
          <FileDown size={15} />
        </a>
      )}
      {xmlUrl && (
        <a href={xmlUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600" title="XML">
          <ExternalLink size={15} />
        </a>
      )}
    </div>
  );
}

export default function NotaRow({
  nota,
  variant,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  nota: Nota;
  variant: "mobile" | "desktop";
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [status, setStatus] = useState(nota.status || "draft");
  const [numero, setNumero] = useState(nota.numero);
  const [pdfUrl, setPdfUrl] = useState(nota.pdf_url);
  const [xmlUrl, setXmlUrl] = useState(nota.xml_url);
  const [errorMsg, setErrorMsg] = useState(nota.error_message);
  const [showError, setShowError] = useState(false);
  const [isPending, startTransition] = useTransition();

  const st = STATUS[status] || { label: status, className: "bg-gray-100 text-gray-600" };
  const dataEmissao = nota.data_emissao || nota.created_at;
  const dataFmt = dataEmissao ? new Date(dataEmissao).toLocaleDateString("pt-BR") : "-";
  const valorFmt = (nota.valor_total || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const cliente = nota.clients?.nome || "Cliente nao encontrado";
  const descricao = nota.descricao_servico || "-";

  function consultar() {
    startTransition(async () => {
      const res = await consultarNFSe(nota.id);
      if (res.success && res.data) {
        setStatus(res.status || status);
        setNumero(res.data.numero || numero);
        setPdfUrl(res.data.pdf_url || res.data.link_url || pdfUrl);
        setXmlUrl(res.data.xml_url || xmlUrl);
        setErrorMsg(res.errorMessage || res.data.motivo_status || errorMsg);
      } else if (!res.success) {
        setStatus("error");
        setErrorMsg(res.error || "Erro ao consultar status da nota.");
      }
    });
  }

  const consultarStable = useCallback(() => {
    consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nota.id]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === "processing") {
      interval = setInterval(() => {
        consultarStable();
      }, 10000);
    }
    return () => clearInterval(interval);
  }, [consultarStable, status]);

  function cancelar() {
    const confirmed = window.confirm("Tem certeza que deseja cancelar esta nota?");
    if (!confirmed) return;

    const motivo = window.prompt("Informe o motivo do cancelamento:", "Cancelamento solicitado pelo emitente.");
    if (motivo === null) return;

    startTransition(async () => {
      const res = await cancelarNFSe(nota.id, motivo);
      if (res.success) {
        setStatus(res.status || "cancelled");
        setErrorMsg(null);
      } else {
        setErrorMsg(res.error || "Erro ao cancelar a nota.");
        setShowError(true);
      }
    });
  }

  return (
    <>
      {variant === "mobile" && (
        <div className="border-b border-gray-100 p-4 last:border-0">
          {selectable && (
            <label className="mb-2 inline-flex items-center gap-2 text-xs font-medium text-gray-700">
              <input type="checkbox" checked={selected} onChange={onToggleSelect} />
              Selecionar para lote especial
            </label>
          )}
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{cliente}</p>
              <p className="mt-0.5 text-xs text-gray-500">{dataFmt}{numero ? ` - NF ${numero}` : ""}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.className}`}>
              {st.label}
            </span>
          </div>

          <p className="line-clamp-2 text-sm text-gray-600">{descricao}</p>
          {status === "error" && errorMsg && (
            <p className="mt-2 line-clamp-2 text-xs text-red-600">{errorMsg}</p>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-base font-semibold text-gray-900">{valorFmt}</p>
            <ActionButtons
              cancelar={cancelar}
              consultar={consultar}
              errorMsg={errorMsg}
              isPending={isPending}
              pdfUrl={pdfUrl}
              setShowError={setShowError}
              status={status}
              xmlUrl={xmlUrl}
            />
          </div>

          {showError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-white p-4 text-sm text-red-800">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle size={16} />
                  Erro da nota
                </div>
                <button onClick={() => setShowError(false)} className="rounded p-1 text-red-400 hover:text-red-700" title="Fechar" type="button">
                  <X size={16} />
                </button>
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-red-50 p-3 text-xs leading-relaxed">
                {errorMsg}
              </pre>
            </div>
          )}
        </div>
      )}

      {variant === "desktop" && (
        <>
          <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
            <td className="px-2 py-3">
              {selectable ? <input type="checkbox" checked={selected} onChange={onToggleSelect} /> : null}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-gray-500">{dataFmt}</td>
            <td className="max-w-[160px] truncate px-4 py-3 font-medium text-gray-900">{cliente}</td>
            <td className="max-w-[220px] truncate px-4 py-3 text-gray-600" title={descricao}>{descricao}</td>
            <td className="whitespace-nowrap px-4 py-3 text-gray-900">{valorFmt}</td>
            <td className="px-4 py-3 text-gray-500">{numero || "-"}</td>
            <td className="px-4 py-3">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.className}`}>{st.label}</span>
              {status === "error" && errorMsg && (
                <p className="mt-0.5 max-w-[180px] truncate text-xs text-red-500" title={errorMsg}>{errorMsg}</p>
              )}
            </td>
            <td className="px-4 py-3">
              <ActionButtons
                cancelar={cancelar}
                consultar={consultar}
                errorMsg={errorMsg}
                isPending={isPending}
                pdfUrl={pdfUrl}
                setShowError={setShowError}
                status={status}
                xmlUrl={xmlUrl}
              />
            </td>
          </tr>

          {showError && (
            <tr className="bg-red-50/60">
              <td colSpan={8} className="px-4 py-4">
                <div className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-800">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertCircle size={16} />
                      Erro da nota
                    </div>
                    <button onClick={() => setShowError(false)} className="rounded p-1 text-red-400 hover:text-red-700" title="Fechar" type="button">
                      <X size={16} />
                    </button>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-red-50 p-3 text-xs leading-relaxed">
                    {errorMsg}
                  </pre>
                </div>
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}
