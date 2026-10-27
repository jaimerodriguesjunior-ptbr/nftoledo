"use client";

import { useState, useEffect, useTransition } from "react";
import { getCompany } from "@/actions/empresa";
import { Building2, CheckCircle } from "lucide-react";


const MUNICIPIOS = [
  { ibge: "4127700", label: "Toledo – PR (IBGE 4127700)" },
  { ibge: "4108809", label: "Guaíra – PR (IBGE 4108809)" },
];

export default function EmpresaPage() {
  const [form, setForm] = useState<Record<string, string>>({
    cnpj: "", razao_social: "", nome_fantasia: "", inscricao_municipal: "",
    inscricao_estadual: "", regime_tributario: "1", codigo_municipio_ibge: "4127700",
    cidade: "", uf: "", cep: "", logradouro: "", numero: "", complemento: "",
    bairro: "", email_contato: "", telefone: "",
    cnae_padrao: "", codigo_servico_padrao: "",
    aliquota_iss_padrao: "3", environment: "production",
  });
  const [success, setSuccess] = useState(false);
  const [hasSavedCompany, setHasSavedCompany] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState("");
  const [certUploading, setCertUploading] = useState(false);
  const [certReading, setCertReading] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [certSuccess, setCertSuccess] = useState<string | null>(null);

  useEffect(() => {
    getCompany().then((data) => {
      if (data) {
        setHasSavedCompany(true);
        setForm((prev) => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, v == null ? "" : String(v)])
          ),
        }));
      }
    });
  }, []);

  const set = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSuccess(false);
  };

  async function persistRegistration() {
    setError(null);
    setSuccess(false);
    setCertError(null);
    if (!hasSavedCompany && !certFile) {
      setError("Selecione o certificado e informe a senha para cadastrar sua empresa na Nuvem Local Fiscal.");
      return;
    }
    if (certFile && !certPassword) {
      setCertError("Informe a senha do certificado.");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("empresa", JSON.stringify({ ...form,
        aliquota_iss_padrao: form.aliquota_iss_padrao.trim() ? Number(form.aliquota_iss_padrao) : null,
      }));
      if (certFile) {
        fd.append("file", certFile);
        fd.append("password", certPassword);
      }
      const response = await fetch("/api/fiscal/cadastro", { method: "POST", body: fd });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Nao foi possivel concluir o cadastro.");
      setHasSavedCompany(true);
      setSuccess(true);
      if (result.certificateSent) {
        setCertSuccess("Certificado recebido e validado pela Nuvem Local Fiscal.");
        setCertFile(null);
        setCertPassword("");
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Nao foi possivel concluir o cadastro.");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(persistRegistration);
  }

  const handleParseCert = async () => {
    if (!certFile || !certPassword) {
      setCertError("Selecione o arquivo .pfx e informe a senha do certificado para ler os dados.");
      return;
    }
    setCertReading(true);
    setCertError(null);
    setCertSuccess(null);
    try {
      const fd = new FormData();
      fd.append("file", certFile);
      fd.append("password", certPassword);

      const res = await fetch("/api/fiscal/certificado/ler", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao ler o certificado");
      }
      
      const data = await res.json();
      
      setForm((prev) => ({
        ...prev,
        cnpj: data.cnpj || prev.cnpj,
        razao_social: data.razaoSocial || prev.razao_social,
      }));
      
      setCertSuccess("Dados lidos do certificado. Salve o cadastro para enviar a empresa e o certificado.");
      setCertError(null);
    } catch (e: unknown) {
      setCertError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setCertReading(false);
    }
  };

  const handleUploadCert = async () => {
    if (!certFile || !form.cnpj || !certPassword) {
      setCertError("Preencha o CNPJ na seção Identificação, selecione o arquivo .pfx e informe a senha.");
      return;
    }
    setCertUploading(true);
    setCertError(null);
    setCertSuccess(null);
    try {
      await persistRegistration();
    } finally {
      setCertUploading(false);
    }
  };

  const ibgeSelecionado = MUNICIPIOS.find((m) => m.ibge === form.codigo_municipio_ibge);
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Building2 size={24} /> Minha Empresa
        </h1>
        <p className="page-subtitle">Dados utilizados na emissão das notas fiscais</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identificação */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">Identificação</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">CNPJ *</label>
              <input className="input" value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} placeholder="00.000.000/0001-00" />
            </div>
            <div>
              <label className="label">Inscrição Municipal *</label>
              <input className="input" value={form.inscricao_municipal} onChange={(e) => set("inscricao_municipal", e.target.value)} placeholder="Somente números" />
            </div>
          </div>
          <div>
            <label className="label">Razão Social *</label>
            <input className="input" value={form.razao_social} onChange={(e) => set("razao_social", e.target.value)} />
          </div>
          <div>
            <label className="label">Nome Fantasia</label>
            <input className="input" value={form.nome_fantasia} onChange={(e) => set("nome_fantasia", e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Inscrição Estadual</label>
              <input className="input" value={form.inscricao_estadual} onChange={(e) => set("inscricao_estadual", e.target.value)} placeholder="Isento ou número" />
            </div>
            <div>
              <label className="label">Regime Tributário</label>
              <select className="input" value={form.regime_tributario} onChange={(e) => set("regime_tributario", e.target.value)}>
                <option value="1">1 – Simples Nacional</option>
                <option value="2">2 – Lucro Presumido</option>
                <option value="3">3 – Lucro Real</option>
              </select>
            </div>
          </div>
        </div>

        {/* Município */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">Município de atuação</h2>
          <div>
            <label className="label">Prefeitura *</label>
            <select className="input" value={form.codigo_municipio_ibge} onChange={(e) => set("codigo_municipio_ibge", e.target.value)}>
              {MUNICIPIOS.map((m) => (
                <option key={m.ibge} value={m.ibge}>{m.label}</option>
              ))}
              <option value="">Outro (informar IBGE manualmente)</option>
            </select>
          </div>
          {!ibgeSelecionado && (
            <div>
              <label className="label">Código IBGE do Município</label>
              <input className="input" value={form.codigo_municipio_ibge} onChange={(e) => set("codigo_municipio_ibge", e.target.value)} placeholder="Ex: 4127700" />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">CEP</label>
              <input className="input" value={form.cep} onChange={(e) => set("cep", e.target.value)} placeholder="85900-000" />
            </div>
            <div>
              <label className="label">UF</label>
              <input className="input" value={form.uf} onChange={(e) => set("uf", e.target.value)} placeholder="PR" maxLength={2} />
            </div>
          </div>
          <div>
            <label className="label">Logradouro</label>
            <input className="input" value={form.logradouro} onChange={(e) => set("logradouro", e.target.value)} placeholder="Rua / Avenida..." />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Número</label>
              <input className="input" value={form.numero} onChange={(e) => set("numero", e.target.value)} />
            </div>
            <div>
              <label className="label">Complemento</label>
              <input className="input" value={form.complemento} onChange={(e) => set("complemento", e.target.value)} />
            </div>
            <div>
              <label className="label">Bairro</label>
              <input className="input" value={form.bairro} onChange={(e) => set("bairro", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Cidade</label>
            <input className="input" value={form.cidade} onChange={(e) => set("cidade", e.target.value)} />
          </div>
        </div>

        {/* Contato */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">Contato</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email_contato} onChange={(e) => set("email_contato", e.target.value)} />
            </div>
            <div>
              <label className="label">Telefone</label>
              <input className="input" value={form.telefone} onChange={(e) => set("telefone", e.target.value)} />
            </div>
          </div>
        </div>

        {/* NFS-e */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-800">NFS-e Nacional — SEFIN</h2>
          <p className="text-sm text-gray-700">As notas são emitidas na SEFIN Nacional pela Nuvem Local Fiscal.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="label">Código de tributação nacional *</label>
              <input className="input" value={form.codigo_servico_padrao} onChange={(e) => set("codigo_servico_padrao", e.target.value)} placeholder="Ex.: 14.01.01" required />
              <p className="text-sm text-gray-700 mt-1">Informe os 6 dígitos conforme o serviço e a orientação do contador.</p>
            </div>
            <div>
              <label className="label">CNAE padrão</label>
              <input className="input" value={form.cnae_padrao} onChange={(e) => set("cnae_padrao", e.target.value)} placeholder="Consulte seu contador" />
            </div>
            <div>
              <label className="label">Alíquota ISS padrão (%)</label>
              <input className="input" type="number" step="0.01" value={form.aliquota_iss_padrao} onChange={(e) => set("aliquota_iss_padrao", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Ambiente padrão</label>
            <select className="input" value={form.environment} onChange={(e) => set("environment", e.target.value)}>
              <option value="production">Produção</option>
              <option value="homologation">Homologação (testes)</option>
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        {success && (
          <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg flex items-center gap-2">
            <CheckCircle size={16} /> Empresa sincronizada com a Nuvem Local Fiscal!
          </p>
        )}

        <button type="submit" disabled={isPending || certUploading || certReading} className="btn-primary">
          {isPending ? "Salvando..." : certFile ? "Salvar empresa e certificado" : "Salvar dados"}
        </button>
      </form>

      {/* Certificado Digital */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-gray-800">Certificado Digital (.pfx)</h2>
        <p className="text-sm text-gray-500">
          O certificado A1 da empresa é necessário para assinar e transmitir a DPS à SEFIN Nacional.
        </p>
        <div>
          <label className="label">Arquivo .pfx</label>
          <input
            type="file"
            accept=".pfx,.p12"
            onChange={(e) => { setCertFile(e.target.files?.[0] || null); setCertSuccess(null); setCertError(null); setSuccess(false); }}
            className="input"
          />
        </div>
        <div>
          <label className="label">Senha do Certificado</label>
          <input
            type="password"
            value={certPassword}
            onChange={(e) => setCertPassword(e.target.value)}
            placeholder="Senha do certificado"
            className="input"
          />
        </div>
        {certError && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{certError}</p>
        )}
        {certSuccess && (
          <p className="text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg flex items-center gap-2">
            <CheckCircle size={16} /> {certSuccess}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleParseCert}
            disabled={isPending || certReading || certUploading || !certFile || !certPassword}
            className="btn-secondary"
          >
            {certReading ? "Lendo..." : "Autopreencher dados"}
          </button>
          <button
            type="button"
            onClick={handleUploadCert}
            disabled={isPending || certReading || certUploading || !certFile || !certPassword}
            className="btn-primary"
          >
            {certUploading ? "Enviando..." : "Salvar empresa e certificado"}
          </button>
        </div>
      </div>
    </div>
  );
}
