# Contribuindo para Rejourney

Aceitamos contribuições! Consulte os guias abaixo para começar.

## Estrutura do Projeto

Este é um monorepo gerenciado pelos espaços de trabalho npm.

## Pré-requisitos

1. **Node.js** >= 18.0.0
2. **npm** ou **yarn** (espaços de trabalho funcionam com ambos)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode e CocoaPods
7. **Android**: Android Studio e JDK 17

## Configuração inicial

### 1. Instale dependências

Do **raiz** do monorepo:

```bash
npm install
```

Isto irá:
- Instale todas as dependências do espaço de trabalho
- Construa o pacote SDK automaticamente (executa `npm run build:sdk` por meio do script `postinstall` na raiz `package.json`)
- Vincule todos os pacotes corretamente

### 2. Construa o SDK

Se você precisar reconstruir o SDK após fazer alterações:

```bash
npm run build:sdk
```

Ou para uma construção limpa:

```bash
npm run build:clean
```

## Desenvolvimento de back-end (local Kubernetes)

Rejourney usa `local-k8s/` para desenvolvimento local para que o tempo de execução permaneça próximo à configuração de produção do Kubernetes, mantendo o loop diário rápido.

### 1. Configurar `.env.k8s.local`

Copie o modelo de ambiente local Kubernetes:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Inicie a pilha de desenvolvimento híbrido

```bash
npm run dev
```

Esse fluxo:

- Cria um cluster `k3d` local, se necessário
- Aplica-se `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` e `minio.yaml`
- Sincroniza `.env.k8s.local` com segredos Kubernetes
- Executa o API, o painel e os trabalhadores da origem em sua máquina host

Para uma execução completa de paridade no cluster:

```bash
npm run dev:full
```

Para parar a pilha local:

```bash
npm run dev:down
```

### 3. Configuração de endereço IP (teste de dispositivo físico)

Se você estiver testando em um **dispositivo físico** (iOS ou Android) conectado ao mesmo WiFi, o SDK e o Dashboard precisam saber o endereço IP local do seu computador para se comunicarem.

#### Encontrando seu endereço IP (Mac)

Execute o seguinte comando em seu terminal:

```bash
ipconfig getifaddr en0
```

Ou encontre-o em **Configurações do sistema > WiFi > Detalhes de [Sua rede]**.

#### Atualizar `.env.k8s.local`

As seguintes variáveis ​​ **DEVE** usam seu endereço IP local (por exemplo, `http://192.168.1.5:3000`) em vez de `localhost`:

| Variável | Uso de chave |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Acesso público a MinIO para replays de vídeo |
| `PUBLIC_DASHBOARD_URL` | URL base para a IU do painel |
| `PUBLIC_API_URL` | URL base para API |
| `PUBLIC_INGEST_URL` | URL base para ingestão de eventos SDK |
| `DASHBOARD_ORIGIN` | Origem CORS para o painel |
| `OAUTH_REDIRECT_BASE` | URL base para retornos de chamada OAuth |




> [!IMPORTANT]
> A falha em defini-los corretamente resultará em erros de "Conexão recusada" em dispositivos físicos ou links de imagem/vídeo quebrados no painel.

`npm run dev` atualiza esses valores voltados para LAN automaticamente por meio de `scripts/local-k8s/update-ips.sh` e também grava os arquivos env do aplicativo de exemplo usados ​​pelos aplicativos Expo.

#### Exemplo de configuração (`.env.k8s.local`)

Supondo que o endereço IP do seu computador seja `192.168.1.100`:

```env
# Object storage (host access to local-k8s MinIO)
S3_ENDPOINT=http://127.0.0.1:9000
S3_PUBLIC_ENDPOINT=http://192.168.1.100:9000

# Public URLs
PUBLIC_DASHBOARD_URL=http://192.168.1.100:8080
PUBLIC_API_URL=http://192.168.1.100:3000
PUBLIC_INGEST_URL=http://192.168.1.100:3000
DASHBOARD_ORIGIN=http://192.168.1.100:8080
OAUTH_REDIRECT_BASE=http://192.168.1.100:3000
```

### 4. Arquivos locais Kubernetes

Os manifestos locais Kubernetes espelham intencionalmente o layout de produção `k8s/`:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Executando aplicativos de exemplo

### Placa de referência React Native (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Ou no diretório de exemplo:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Laboratórios de café fermentado (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Nu

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Como funciona

### Configuração do espaço de trabalho

O monorepo usa espaços de trabalho npm para pacotes principais, mas os aplicativos de exemplo são independentes:

1. **Raiz `package.json`** inclui apenas `packages/*`, `backend` e `dashboard/web-ui` em áreas de trabalho
2. **Aplicativos de exemplo são independentes** - eles têm seu próprio `node_modules` para evitar conflitos de dependência
3. **Aplicativos de exemplo** faz referência a SDK usando `"rejourney": "file:../../packages/react-native"`
4. **Configurações metropolitanas** estão configurados para monitorar e resolver o pacote SDK corretamente

**Por que os exemplos não estão nos espaços de trabalho:**
- Aplicativos de exemplo usam versões Expo/React Native diferentes
- Evita conflitos de desduplicação de dependência npm
- Cada exemplo pode ter sua própria árvore de dependências completa

### Configuração metropolitana

Cada aplicativo de exemplo possui um `metro.config.js` que:

1. **Relógios** o diretório de origem SDK (`packages/react-native`) para alterações
2. **Resolve** o pacote `rejourney` para o local correto
3. **Blocos** duplica pacotes `react-native` e `react` da raiz do espaço de trabalho

### Codegen (TurboMódulos)

O codegen do React Native é executado automaticamente ao criar o aplicativo se:

1. O `package.json` do SDK tem `codegenConfig` definido ✅
2. O arquivo de especificação (`NativeRejourney.ts`) segue a convenção de nomenclatura ✅
3. O aplicativo inclui o pacote SDK ✅

Codegen é executado automaticamente durante:
- `npm run ios` (compilações iOS)
- `npm run android` (compilações Android)

## Estrutura do Projeto

```
rejourney/
├── packages/
│   └── react-native/          # SDK package
│       ├── src/                # TypeScript source
│       ├── android/           # Android native code
│       ├── ios/               # iOS native code
│       └── package.json       # Package config with codegenConfig
├── examples/
│   ├── react-native-boilerplate/  # Expo example
│   ├── brew-coffee-labs/          # Expo example
│   └── react-native-bare/         # Bare RN example
└── package.json               # Root workspace config
```

## CI/CD e implantação

Rejourney usa GitHub Actions para automatizar testes, construção e implantação em todo o monorepo.

Para obter uma análise detalhada de nossos conjuntos de testes, testes de integração nativa e lógica de implantação automatizada, consulte a [CI/CD e documentação de testes](/docs/architecture/ci-cd).

---

Explore a [Comparação de arquitetura](/docs/architecture/distributed-vs-single-node) para obter detalhes sobre nuvem (K8s) versus auto-hospedado (Docker).

## Melhores práticas

1. **Sempre construa o SDK** antes do teste: `npm run build:sdk`
2. **Usar protocolo de arquivo** (`file:../../packages/react-native`) em package.json para espaços de trabalho npm
3. **Limpar cache do Metro** ao ter problemas: `npm start -- --reset-cache`
4. **Reconstrua aplicativos nativos** após alterações no código nativo SDK
5. **Teste em iOS e Android** antes de confirmar
