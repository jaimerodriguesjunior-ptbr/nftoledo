# Emissão pela SEFIN Nacional

## Cadastro da empresa e certificado

Na tela Minha Empresa, selecionar o certificado A1, informar a senha e usar
**Salvar empresa e certificado**. O envio passa pela rota autenticada
`POST /api/fiscal/cadastro`; o identificador da organização vem da sessão.

A Nuvem Local recebe dados e A1 em `POST /empresas/cadastro-certificado`.
A integração precisa de `empresa-cadastro` para cadastrar novos CNPJs, além
dos escopos `empresa` e `nfse` usados normalmente. A API valida o arquivo,
senha, prazo e identificação do CNPJ; vincula a nova empresa somente à
integração solicitante. CNPJ existente fora das permissões exige vinculação
administrativa, sem assumir acesso às empresas dos outros programas.

O certificado e a senha são enviados ao serviço, que os armazena em bundle
cifrado. Esses valores não são gravados em `company_settings`, logs ou
respostas do NF Toledo. Ao salvar, o resultado da sincronização fiscal
também precisa ser confirmado antes da mensagem de sucesso.

**Autopreencher dados** apenas lê o arquivo. Sua mensagem não significa que
houve envio à Nuvem Local. Atualizações cadastrais posteriores podem ser
salvas sem reenviar um certificado.

O NF Toledo cadastra empresas na Nuvem Local Fiscal com o provedor
`nfse-nacional`, em produção e homologação. O município identifica o
prestador; não seleciona IPM ou Equiplano.

Antes de cada emissão, inclusive em lote, o sistema consulta a configuração
nacional da empresa na API com o ambiente explícito, sem alterá-la.
Se a API não confirmar `nfse-nacional` no ambiente solicitado, o envio é
bloqueado antes de criar a nota. Não há tentativa por um provedor municipal.

## Cadastro fiscal

- Para configurar uma empresa nova, o campo **Código de tributação nacional** recebe o código de
  tributação nacional completo de seis dígitos, com ou sem pontuação.
  Por exemplo, `14.01.01` é normalizado para `140101`. Confirme o código
  aplicável ao serviço; o exemplo não é um padrão para todas as empresas.
- Na emissão, o código nacional validado na Nuvem Local é a fonte preferida.
  Na ausência dele, o código do cadastro deve ter seis dígitos; códigos
  antigos com quatro ou nove dígitos são recusados para revisão.
- O código IBGE da empresa deve ter sete dígitos. Município ausente não é
  substituído por Guaíra ou Toledo.
- Login e senha municipais não são enviados à API.
- Salvar o cadastro preserva uma configuração nacional existente na API,
  incluindo serviço, NBS, Simples, IM e sequência DPS.

## Diretrizes trazidas do Apoio Contábil

Referências: `G:/projetos/apoio-contabil/src/actions/fiscal.ts` e
`G:/projetos/apoio-contabil/src/lib/nfse-iss.ts`.

- Guaíra envia a inscrição municipal do prestador na DPS quando cadastrada;
  Toledo omite essa tag do payload.
- `dhEmi` usa o instante atual em São Paulo. A competência é independente e
  pode ser informada separadamente, inclusive para notas de meses anteriores.
- O ISS segue opção pelo Simples, regime de apuração, tributação e retenção
  confirmados na API. Não é enviado `vISSQN` nem uma alíquota artificial para
  MEI ou ME/EPP com ISS pelo Simples sem retenção.
- Retenção no Simples exige alíquota efetiva válida; configuração incompleta
  bloqueia o envio antes da criação da nota.
- Autorizações e rejeições imediatas são gravadas com o status retornado.
  O identificador é preservado mesmo em uma rejeição HTTP para permitir consulta.
- DPS preparada em homologação usa a rota de transmissão do mesmo documento.
  A produção não chama essa rota manual.
- O lote mantém uma nota por vez, intervalo de 10 segundos e bloqueio por
  cliente/mês/ambiente. Não há reenvio automático municipal por RPS duplicado.

Adicionalmente, se a API devolver `E0014` com identificador, é feita a consulta
da DPS existente na SEFIN; não é enviada outra DPS para resolver duplicidade.

Certificado A1, habilitação da empresa e demais parâmetros fiscais precisam
estar corretos na Nuvem Local. A política da API controla a transmissão em
cada ambiente. A aplicação não libera produção nem cria uma nota durante
o cadastro.

As URLs da Nuvem Local são obrigatórias em `NUVEMFISCAL_PROD_URL` e
`NUVEMFISCAL_HOM_URL`. Sem uma URL configurada, o fluxo retorna erro.

## Verificação local

`node --test tests/nfse-national.test.mjs`

Os testes exercitam os módulos reais com HTTP e Supabase simulados. Cobrem
Guaíra e Toledo, os dois ambientes, preservação da configuração nacional,
regras de ISS, IM, horário, competência, status, retomada em homologação e
consulta de duplicidade. Nenhuma requisição fiscal real é enviada.
