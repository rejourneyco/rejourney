# Nuvem distribuída vs de nó único

Rejourney oferece suporte a dois formatos oficiais de implantação auto-hospedada:

- **Nó único Docker Compose** para um servidor ou VPS
- **Distribuído K3s** para clusters de produção e escalonamento horizontal

Ambos agora usam o mesmo modelo de back-end principal:

- endpoints de armazenamento são apoiados por banco de dados
- uploads de ingestão passam pela retransmissão de upload de propriedade do back-end
- trabalhadores processam artefatos verificados
- a visibilidade do replay é orientada por artefatos

---

## Comparação de recursos

| Recurso | Nuvem Distribuída | Nuvem de nó único |
|---------|--------------------|-------------------|
| Plataforma | K3s | Docker Compose |
| Escala | Multinó | Nó único |
| Pontos de entrada públicos | Entrada Traefik | Recipiente Traefik |
| Caminho de upload | API + serviço de upload e ingestão | API + serviço de upload e ingestão |
| Fonte de armazenamento da verdade | Tabela `storage_endpoints` | Tabela `storage_endpoints` |
| Armazenamento de objetos padrão | S3 externo | MinIO integrado |
| Suporte externo S3 | Sim | Sim |
| Criptografia secreta | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Fluxo de atualização | k8s implantação + trabalhos | `deploy.sh update` |

---

## Modelo de armazenamento compartilhado

Em ambos os modelos de implantação, a configuração de armazenamento em tempo de execução vem de Postgres, não de um substituto de ambiente.

Isso significa:

- o terminal de armazenamento de objeto ativo é armazenado em `storage_endpoints`
- chaves de acesso secretas são criptografadas em `key_ref`
- o tempo de execução lê a linha do banco de dados
- Os scripts de bootstrap/instalação são responsáveis ​​por sincronizar a entrada `.env` na linha do banco de dados

Isso torna o Docker auto-hospedado muito mais próximo do prod e do local-k8s do que o antigo modelo substituto.

---

## Quando escolher Docker Compose de nó único

Escolha Docker Compose quando:

- você está implantando em um host VPS ou bare-metal
- você quer o caminho de instalação mais rápido
- você deseja MinIO integrado por padrão
- você não precisa de escalonamento de vários nós ou operações Kubernetes

Pontos de entrada oficiais:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Quando escolher K3s distribuído

Escolha K3s quando:

- você precisa de vários nós
- você deseja operações nativas Kubernetes e manipulação de segredos
- você deseja dimensionar API, fazer upload e serviços de trabalho de forma independente
- você deseja implantações contínuas e isolamento de infra-estrutura mais forte

O caminho K3s reside em `k8s/` e `scripts/k8s/`.

---

## Diferença Operacional

A principal diferença não é mais o modelo de dados. É a forma operacional:

- Compose: uma máquina, uma rede Docker, um script de operador
- K3s: vários pods, namespaces, entrada de cluster, trabalhos e segredos Kubernetes

---

## Orientação Prática

Comece com Compose de nó único se desejar auto-hospedar rapidamente.

Mude para K3s quando precisar:

- mais rendimento
- implantações contínuas de cluster
- escala horizontal
- separação de infraestrutura mais resiliente

---

## Documentos de arquitetura interna

Para obter os mais recentes recursos visuais de engenharia interna e detalhes mais detalhados do operador:

- `dev_docs/ingest-session-recording-lifecycle.md` (diagrama do ciclo de vida da sessão)
- `dev_docs/storage-and-endpoints.md` (diagrama de topologia multi-bucket)
- `dev_docs/allthingscloud.md` (diagrama de configuração da nuvem k3s)

Para uma página de arquitetura somente gráfica, abra [`/docs/architecture/diagrams`](/docs/architecture/diagrams).
