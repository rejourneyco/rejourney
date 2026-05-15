# Auto-hospedagem Rejourney

Este guia é para **qualquer um** executando Rejourney em seu próprio servidor (normalmente um único VPS ou máquina dedicada) usando a pilha **Docker Compose** oficial. Você não precisa de acesso à infraestrutura interna do Rejourney ou Kubernetes.

Após a configuração você obtém:

- Um **painel da web** em seu domínio (HTTPS via Let’s Encrypt)
- Um **API** em um subdomínio (para painel e celular SDK)
- Um **retransmissão de ingestão (upload)** em outro subdomínio (os uploads de sessões passam pelo seu servidor, não diretamente dos telefones para o armazenamento de objetos)
- **PostgreSQL**, **Redis** e **integrado MinIO** ou **seu próprio armazenamento S3-compatible**
- Plano de fundo **trabalhadores** que processa sessões, retenção e alertas (mesmas funções da implantação em nuvem de Rejourney)

Todos os comandos abaixo presumem que você está no **raiz do repositório** após a clonagem (a pasta que contém `docker-compose.selfhosted.yml`).

---

## O que você precisa de antemão

### Servidor

- **SO:** Ubuntu 22.04+, Debian 12+ ou outro Linux que execute Docker bem
- **Docker:** 24 ​​ou mais recente, com o **Plug-in Docker Compose** (`docker compose version` deve funcionar)
- **Recursos (recomendados):** 4 vCPU, 8 GB de RAM, 40 GB de disco (mais se você mantiver muitas gravações)
- **Rede:** Portas **80** e **443** abertas para a Internet (necessárias para o desafio Let’s Encrypt HTTP e HTTPS)

### Domínio e DNS

Você precisa do **um domínio base** que você controla (por exemplo, `example.com`). Antes de executar o instalador, crie registros DNS **UM** (ou **AAAA**) apontando **todos** desses nomes de host no IP público do seu servidor:

| Nome do host | Finalidade |
|----------|---------|
| `example.com` | Painel |
| `www.example.com` | Redireciona para o painel |
| `api.example.com` | API (e WebSocket quando utilizado) |
| `ingest.example.com` | Retransmissão de upload (SDK usa isso automaticamente quando API é configurado) |

Substitua `example.com` pelo seu domínio real. A propagação pode levar de alguns minutos a horas; Os certificados TLS não serão emitidos até que DNS seja resolvido corretamente.

### Let’s Encrypt

Será solicitado um **endereço de email** durante a instalação. É usado para avisos de expiração de certificados de Let’s Encrypt.

### Ferramentas em sua máquina

- `git` para clonar o repositório
- `openssl` (usado pelo script de instalação para gerar segredos)
- Um shell (bash está bem)

---

## Instalação pela primeira vez

### 1. Clone o repositório

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Permaneça no branch padrão (ou em uma tag de lançamento se o projeto documentar uma para auto-hospedagem).

### 2. Execute o instalador

```bash
./scripts/selfhosted/deploy.sh install
```

O roteiro irá:

1. Peça seu **domínio base** (por exemplo, `example.com` - não `https://`, sem caminho).
2. Peça seu **E-mail Let’s Encrypt**.
3. Solicite **armazenar**: armazenamento **MinIO** integrado (recomendado) ou **externo S3-compatible** (você inserirá endpoint, bucket, região e chaves).
4. Crie **`.env.selfhosted`** na raiz do repositório com senhas e segredos gerados. **Restringir permissões** são aplicados (`chmod 600`).
5. **Puxar** publicou imagens de contêiner (API, web, trabalhadores, bancos de dados, Traefik, etc.).
6. **Construir** a imagem **inicialização / migração** **do seu clone** (ela contém os scripts de configuração do banco de dados; ela não é baixada do registro do contêiner).
7. Inicie os bancos de dados, Redis, Traefik e (se escolhido) MinIO.
8. Valide a conectividade do banco de dados usando o `DATABASE_URL` configurado antes da execução do bootstrap.
9. Execute um contêiner **inicialização** único: esquema de banco de dados, valor inicial opcional e configuração de armazenamento no banco de dados.
10. Inicie o API, faça upload do relé, do painel e dos trabalhadores.

A primeira instalação pode levar vários minutos (extração de imagens e inicialização).

### 3. Proteja `.env.selfhosted`

Este arquivo contém **todos os segredos** para sua implantação (banco de dados, Redis, JWT, criptografia de armazenamento, credenciais MinIO, se usadas, etc.). **Faça backup** para um local seguro (gerenciador de senhas, backup criptografado). Se você perdê-lo, poderá perder a capacidade de descriptografar credenciais armazenadas ou de reconstruir a mesma implantação.

Não o comprometa com o git (deve ser ignorado por `.gitignore`).

---

## Após a instalação

### URLs

O instalador imprime os URLs. Em geral:

- **Painel:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **Ingerir:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` redireciona para o painel.

### Verifique a pilha

```bash
./scripts/selfhosted/deploy.sh status
```

Você deverá ver os contêineres em execução; `api` e `ingest-upload` devem se tornar **saudável** após um curto período de tempo.

### Primeiro login e gravação de teste

1. Abra o painel em um navegador.
2. Crie uma conta e um projeto.
3. Configure o Rejourney SDK do seu aplicativo com o seu **URL API** (consulte [Configuração SDK](#configuring-your-mobile-app) abaixo).
4. Grave uma sessão curta e confirme se ela aparece no Replay.

Se as sessões nunca aparecerem no Replay, consulte [Solução de problemas](/docs/selfhosted/troubleshooting) (carregar retransmissão e ingerir logs de trabalho).

---

## Operações do dia a dia

Tudo isso é executado a partir da raiz do repositório.

| Ação | Comando |
|--------|---------|
| Estado do serviço | `./scripts/selfhosted/deploy.sh status` |
| Acompanhe todos os registros | `./scripts/selfhosted/deploy.sh logs` |
| Logs para um serviço | `./scripts/selfhosted/deploy.sh logs api` (substitua `api` por `web`, `ingest-upload`, `ingest-worker`, etc.) |
| Imagens **Atualizar** e reexecutar bootstrap | `./scripts/selfhosted/deploy.sh update` |
| Pare tudo **sem** excluindo dados | `./scripts/selfhosted/deploy.sh stop` |
| **Reiniciar** contêineres e volumes (destrutivos) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** extrai imagens mais recentes (quando aplicável), reconstrói a imagem de bootstrap do seu clone atual, reinicia a pilha e executa o bootstrap novamente para que o esquema do banco de dados e as configurações de armazenamento permaneçam alinhados com seu `.env.selfhosted`. Ele limpa **não** Postgres ou volumes de armazenamento de objetos.

Antes da inicialização, `install` e `update` validam a conectividade do banco de dados com as credenciais configuradas. Se as credenciais não corresponderem aos dados Postgres persistentes, a implantação será interrompida antecipadamente com orientação de recuperação, em vez de falhar posteriormente na inicialização.

**`stop`** para apenas contêineres; Docker **volumes** (dados Postgres, dados MinIO, etc.) permanecem até que você os remova explicitamente.

**`reset`** remove os contêineres auto-hospedados e os volumes Docker (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) após um prompt de confirmação. Ele também destrói contêineres de perfil MinIO mesmo quando `.env.selfhosted` está faltando, portanto, dados MinIO obsoletos não bloqueiam a próxima instalação. Use isso apenas quando desejar uma instalação totalmente nova.

---

## Armazenamento: MinIO vs S3 externo

### MinIO integrado (padrão)

- Mais fácil para um único servidor: o armazenamento de objetos executa **dentro de Docker** e não é exposto à Internet pública por padrão.
- Os bytes de sessão são gravados pelo serviço **upload de ingestão**; os dispositivos não precisam acessar MinIO diretamente.
- A criação do bucket é feita durante a instalação.

### Armazenamento externo S3-compatible

Use AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi ou qualquer S3-compatible API. Durante a instalação, você fornece o URL do endpoint, o bucket, a região e as chaves de acesso.

Exemplos de estilos de URL de endpoint (os documentos do seu provedor são oficiais):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

Se você adicionar um **URL público separado** para downloads, defina `S3_PUBLIC_ENDPOINT` em `.env.selfhosted` e execute `./scripts/selfhosted/deploy.sh update`.

---

## Configuração importante (`.env.selfhosted`)

O instalador gera este arquivo. Variáveis ​​típicas incluem:

- **Domínios e URLs públicos:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Banco de dados:** `DATABASE_URL` (aponta para o serviço `postgres` dentro de Compose)
- **Redis:** `REDIS_URL`
- **Armazenar:** `STORAGE_BACKEND`, `S3_*` e opcionalmente `MINIO_*`
- **Segurança:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

Integrações opcionais (deixe em branco se não forem utilizadas): Stripe, SMTP, GitHub OAuth, Turnstile, etc.

**Alterando valores relacionados ao armazenamento ou ao domínio:** edite `.env.selfhosted` e execute:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Como funciona a configuração do banco de dados (primeira inicialização versus atualizações posteriores)

Você normalmente precisa executar o SQL manualmente. O contêiner **inicialização** cuida disso.

- **Novo banco de dados vazio:** a pilha aplica o esquema atual do código e, em seguida, registra quais versões de migração já estão satisfeitas para que atualizações futuras apliquem apenas migrações **novo**.
- **Banco de dados existente (já inicializado):** somente migrações **pendente** são aplicadas. Seus dados não são reconstruídos do zero em cada `update`.
- Se o banco de dados **já tem mesas**, mas a tabela de histórico de migração for **ausente ou vazio** (por exemplo, uma restauração parcial), inicialize **pára com um erro** para evitar danos acidentais. As opções de recuperação avançada estão documentadas em [Solução de problemas](/docs/selfhosted/troubleshooting).

---

## Servidores Apple Silicon e ARM

Em máquinas **ARM64** (muitos Macs, algumas instâncias de nuvem), o script de implantação define `DOCKER_DEFAULT_PLATFORM=linux/amd64` para pulls de imagem quando você mesmo não o configurou, portanto, imagens pré-construídas que publicam apenas `amd64` ainda são executadas. Se precisar de um comportamento diferente, configure `DOCKER_DEFAULT_PLATFORM` em seu ambiente antes de executar o script.

A imagem **inicialização** é sempre **construído em sua máquina** do repositório clonado, portanto sempre corresponde ao seu checkout.

---

## O que é executado em Docker (visão geral)

- Certificados **Traefik:** HTTPS e roteamento para o painel, API, e nomes de host de ingestão.
- **Postgres/Redis:** Dados e filas de aplicativos.
- **MinIO:** Armazenamento de objetos interno opcional.
- **API:** Principal HTTP API.
- **upload de ingestão:** Serviço dedicado para tráfego de retransmissão de upload.
- **rede:** UI estática do painel.
- **Trabalhadores:** Filas de ingestão de processos, artefatos de reprodução, ciclo de vida da sessão, trabalho de estilo de retenção agendado e alertas.

Há um trabalhador em lote de faturamento separado **não** nesta pilha; a integração de faturamento é orientada por Stripe e API quando você configura chaves.

---

## Configurando seu aplicativo móvel

Aponte o SDK para o host **seu** API (deve corresponder a `API_DOMAIN` / `PUBLIC_API_URL`).

### Exemplo React Native

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Use seu URL API real. URLs de upload são derivados para `ingest.<your-domain>` automaticamente quando o servidor é configurado corretamente.

---

## Cópias de segurança

No mínimo, faça backup de **PostgreSQL**, **`.env.selfhosted`** e (se você usar MinIO integrado) **dados de armazenamento de objetos**.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Detalhes: [Backup e recuperação](/docs/selfhosted/backup-recovery).

---

## Solução de problemas e suporte

- [Solução de problemas](/docs/selfhosted/troubleshooting) — falhas de inicialização, TLS, repetição vazia, problemas externos de S3.
- [Backup e recuperação](/docs/selfhosted/backup-recovery) — ordem de restauração e MinIO.

Para bugs ou melhorias nesses documentos, use o rastreador de problemas público do projeto em GitHub.

---

## Documentação relacionada

- [Nuvem distribuída versus nuvem de nó único](/docs/distributed-vs-single-node/distributed-vs-single-node) — como isso se compara a um layout de nuvem multisserviços (conceitual).
