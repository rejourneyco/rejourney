# Solução de problemas auto-hospedados

Use esta página se você seguiu [Rejourney auto-hospedado](/docs/selfhosted) e algo falha ou se comporta de maneira estranha. Os comandos são executados a partir do **raiz do repositório** (onde reside `docker-compose.selfhosted.yml`).

---

## Verificações rápidas

### Status do serviço

```bash
./scripts/selfhosted/deploy.sh status
```

### Registros API

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Carregar logs de retransmissão

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Registros de trabalho

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. A instalação ou atualização falha antes ou durante a inicialização

### Sintomas

- `bootstrap` sai diferente de zero
- os serviços de aplicativos nunca se tornam saudáveis
- `status` mostra API ou trabalhadores aguardando inicialização
- instalar ou atualizar saídas com `Database authentication failed before bootstrap.`

### Cheques

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Causas comuns:

- ruim `DATABASE_URL`
- incompatibilidade de credenciais (por exemplo, de uma implantação anterior com falha)
- faltando `STORAGE_ENCRYPTION_KEY`
- credenciais S3 inválidas
- URL de endpoint externo S3 quebrado
- em **ARM64**, suporte de imagem ausente (defina `DOCKER_DEFAULT_PLATFORM=linux/amd64` ou use `./scripts/selfhosted/deploy.sh`, que o define quando não definido)

Recuperação:

1. Se você ainda possui o `.env.selfhosted` original, restaure-o e execute:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Se você não precisar de dados antigos, limpe e reinstale:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Mensagens de esquema/migração:** Em uma instalação normal, o banco de dados começa vazio e o bootstrap configura tudo. Se você **restaurou Postgres de um backup** estiver em um novo servidor, mas os metadados de migração estiverem faltando, ou você apontar a pilha para **banco de dados errado**, o bootstrap poderá sair com um erro sobre um banco de dados inconsistente em vez de substituir seus dados. A menos que você esteja fazendo uma recuperação avançada, corrija `DATABASE_URL` e restaure um backup consistente ou inicie a partir de um volume limpo. Para recuperação deliberada apenas de migração, algumas configurações usam `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` em `.env.selfhosted` (consulte a documentação do mantenedor ou suporte antes de usar isto).

### Consertar

1. Se você tiver o `.env.selfhosted` original, restaure-o e execute novamente:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Se você não tiver o `.env.selfhosted` original, limpe e reinstale:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` executa novamente o esquema, a semente e a sincronização do terminal de armazenamento. `reset` remove contêineres auto-hospedados e volumes de dados para que uma nova instalação possa gerar novas credenciais com segurança.

---

## 2. As sessões são contadas, mas o Replay permanece vazio

### O que isso geralmente significa agora

Com a arquitetura atual, isso geralmente é uma de duas coisas:

- `ingest-upload` não pôde armazenar os bytes do artefato
- `ingest-worker` não pôde processar um artefato carregado

O dispositivo não faz mais upload diretamente para MinIO/S3, portanto, a acessibilidade do bucket pelo telefone não é mais o principal suspeito.

### Cheques

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Procurar:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Causas comuns

- credenciais S3 erradas em `.env.selfhosted`
- bucket S3 externo ausente
- endpoint externo S3 inacessível da rede Docker
- upload de retransmissão não íntegro
- trabalhador preso tentando novamente artefatos com falha

### Consertar

- verificar valores `S3_*`
- se você alterou a configuração de armazenamento, execute novamente:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. O painel é carregado, mas as chamadas de autenticação ou API falham

### Cheques

- host do painel DNS aponta para o servidor
- Host API DNS aponta para o servidor
- hospedeiro de ingestão DNS aponta para o servidor
- as portas `80` e `443` estão abertas
- Let’s Encrypt emitiu certificados

Inspecionar:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS ou problemas de certificado

Traefik gerencia certificados automaticamente.

### Cheques

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Certifique-se de que ambos os nomes sejam resolvidos para o servidor que executa a pilha.

Se DNS estava errado durante a primeira instalação, corrija DNS e execute novamente:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. S3 externo funciona em CLI, mas Rejourney não pode fazer upload

Lembre-se de que o caminho de upload é do lado do servidor.

O caminho de rede importante é:

- Contêiner `ingest-upload` -> seu terminal S3

Teste a partir do servidor revisando os logs de retransmissão e confirmando o endpoint/bucket/chaves em `.env.selfhosted`.

Se você os alterou, execute novamente:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Instalação MinIO integrada, mas os artefatos ainda falham

### Cheques

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

O one-shot `minio-setup` deve criar o bucket nomeado por `S3_BUCKET`.

Se você alterou o nome do bucket após a primeira instalação, execute:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. As páginas de faturamento mostram faturamento desativado

Isso é esperado, a menos que as chaves Stripe sejam configuradas.

A pilha não desativa mais o faturamento porque é “auto-hospedada”. Ele desativa o faturamento porque Stripe não está configurado.

Se você não configurar chaves Stripe:

- a interface de faturamento permanece no estado auto-hospedado/ilimitado
- Check-out e webhooks Stripe permanecem desativados

---

## 8. O endpoint de armazenamento em Postgres está errado após alterar `.env.selfhosted`

Correr:

```bash
./scripts/selfhosted/deploy.sh update
```

O caminho de atualização executa novamente o bootstrap e sincroniza novamente a linha `storage_endpoints` ativa.

---

## 9. Necessidade de interromper serviços sem perder dados

Usar:

```bash
./scripts/selfhosted/deploy.sh stop
```

Isso interrompe apenas contêineres. Não remove volumes.

---

## 10. Precisa de registros mais profundos para um serviço

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
