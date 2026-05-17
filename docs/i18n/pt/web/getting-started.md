<!-- AI_PROMPT_SECTION -->
**Usando Cursor, Claude ou ChatGPT?** Copie o prompt de integração e cole-o em seu assistente AI para gerar automaticamente o código de configuração.

<!-- /AI_PROMPT_SECTION -->

## Instalação

Adicione o pacote Rejourney ao seu projeto usando npm ou yarn.

```bash
npm install @rejourneyco/browser
```

## Configuração básica

Inicialize e inicie Rejourney no ponto de entrada do seu aplicativo.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` busca a configuração remota do seu projeto e prepara o SDK. `start` inicia a sessão, registra o visitante e (se a reprodução estiver habilitada) inicia o gravador rrweb. Ambos são assíncronos e seguros para ligar sem esperar se você não precisar bloquear nada após a conclusão.




> [!NOTE]
> `autoStart` é `false` por padrão. Você deve chamar `start()` explicitamente, o que permite bloquear a gravação por trás de uma verificação de consentimento. Para iniciar automaticamente após `init`, passe `{ autoStart: true }`.

### Integrações de estrutura

O pacote inclui pontos de entrada dedicados para estruturas populares. Use aquele que corresponde à sua pilha - ou use o API básico acima de qualquer estrutura.

---

#### Reagir

```javascript
import { RejourneyProvider, useRejourney } from '@rejourneyco/browser/react';

// Wrap your app root
function App() {
  return (
    <RejourneyProvider publicKey="pk_live_your_public_key" startOnMount>
      <YourApp />
    </RejourneyProvider>
  );
}

// Access the SDK anywhere inside the tree
function MyComponent() {
  const rejourney = useRejourney();

  function handlePurchase() {
    rejourney.logEvent('purchase_completed', { plan: 'pro' });
  }
}
```

`startOnMount` é padronizado como `false` em `RejourneyProvider`. Passe `startOnMount` (ou `startOnMount={true}`) para iniciar a gravação assim que o componente for montado.

---

#### Próximo.js

```javascript
// app/layout.tsx (or pages/_app.tsx)
import { RejourneyNext } from '@rejourneyco/browser/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <RejourneyNext publicKey="pk_live_your_public_key" />
        {children}
      </body>
    </html>
  );
}
```

`RejourneyNext` é um componente `'use client'` que renderiza `null`. O padrão `startOnMount` é `true`. As alterações de rota são rastreadas automaticamente através do Histórico API.

---

#### Vista

```javascript
// main.ts
import { createApp } from 'vue';
import { createRejourney } from '@rejourneyco/browser/vue';
import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createRejourney({
  publicKey: 'pk_live_your_public_key',
  router, // optional — enables per-route screen tracking via router.afterEach
}));

app.use(router).mount('#app');
```

A instância Rejourney está disponível via `app.config.globalProperties.$rejourney` e via `inject('rejourney')`. O elemento que pode ser composto `useRejourney()` também é exportado por conveniência.

---

#### Nuxt

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

O sufixo `.client.ts` garante que este plugin seja executado apenas no navegador. A instância Rejourney é injetada como `$rejourney` e disponível via `useNuxtApp().$rejourney`.

---

#### Svelte / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` retorna uma função de limpeza que chama `Rejourney.stop()` - o valor de retorno `onMount` de Svelte é usado como retorno de chamada de destruição automaticamente.

---

#### Angular

```javascript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { createRejourneyAppInitializer } from '@rejourneyco/browser/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: () => createRejourneyAppInitializer({ publicKey: 'pk_live_your_public_key' }),
      multi: true,
    },
  ],
};
```

`createRejourneyAppInitializer` retorna uma fábrica que inicializa e inicia Rejourney durante a fase de inicialização do Angular. Você também pode injetar `RejourneyService` para um API baseado em classe.

---

#### Remixar

```javascript
// app/root.tsx
import { RejourneyRemix } from '@rejourneyco/browser/remix';

export default function App() {
  return (
    <html>
      <body>
        <RejourneyRemix publicKey="pk_live_your_public_key" />
        <Outlet />
      </body>
    </html>
  );
}
```

`startOnMount` é padronizado como `true`. As alterações de rota são rastreadas automaticamente.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` não operacional em ambientes SSR — ele verifica `window` antes de executar.

---

## Configurações de gravação remota

As configurações do projeto podem controlar os padrões de gravação da Web sem implantação de código. O SDK lê a configuração remota em cada chamada `start()`. A configuração remota pode ativar ou desativar totalmente a gravação, ajustar a lista de domínios permitidos e definir uma duração máxima de sessão. Se a configuração remota não estiver disponível, `start()` não prosseguirá — isso é intencional para evitar a gravação em estado de projeto desconhecido.

## Rastreamento de rota

Rejourney rastreia automaticamente as alterações de página e rota para que você possa ver o contexto de navegação nos replays. Isso é habilitado por padrão (`autoTrackRoutes: true`) e funciona interceptando chamadas do Histórico API (`pushState`, `replaceState`) e ouvindo eventos `popstate`.

### Nomes de rotas personalizados

Por padrão, o `window.location.pathname` atual é usado como nome de tela. Para fornecer sua própria lógica de nomenclatura, passe uma função `routeName`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Rastreamento manual de tela

Para rastrear telas manualmente (por exemplo, para alterações de guias ou transições de visualização na página), chame `trackScreen` diretamente:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Para desativar o rastreamento automático de rota e confiar apenas em chamadas manuais:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Identificação do usuário

Associe sessões aos seus IDs de usuário internos para filtrar e pesquisar usuários específicos no painel.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Privacidade:** Use IDs internos ou UUIDs. Se você precisar usar PII (e-mail, telefone), faça hash antes de enviar.

## Eventos personalizados

Rastreie ações significativas do usuário para entender padrões de comportamento, depurar problemas e filtrar replays de sessões no painel.

### Uso Básico

```javascript
import { Rejourney } from '@rejourneyco/browser';

// Simple event (name only)
Rejourney.logEvent('signup_completed');

// Event with properties
Rejourney.logEvent('button_clicked', { buttonName: 'signup' });
```

### API

```typescript
Rejourney.logEvent(name: string, properties?: Record<string, unknown>)
```

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `name` | `string` | Sim | Nome do evento — use `snake_case` para consistência |
| `properties` | `object` | Não | Pares de valores-chave anexados a esta ocorrência de evento específica |

### Exemplos

```javascript
// E-commerce
Rejourney.logEvent('purchase_completed', {
  plan: 'pro',
  amount: 29.99,
  currency: 'USD'
});

// Onboarding
Rejourney.logEvent('onboarding_step', {
  step: 3,
  stepName: 'profile_setup',
  skipped: false
});

// Feature usage
Rejourney.logEvent('feature_used', {
  feature: 'dark_mode',
  enabled: true
});

// Errors / edge cases
Rejourney.logEvent('payment_failed', {
  errorCode: 'card_declined',
  retryCount: 2
});
```

### Como os eventos aparecem no painel

Os eventos personalizados são armazenados por sessão e visíveis em dois locais:

1. **Linha do tempo de repetição da sessão** — Os eventos aparecem como marcadores na linha do tempo de repetição para que você possa pular para o momento exato em que uma ação ocorreu.
2. **Filtros de arquivo de sessão** — Filtre a lista de sessões por:
   - **Nome do evento** — Encontre todas as sessões contendo um evento específico (por exemplo, `purchase_completed`)
   - **Propriedade do evento** — Limite ainda mais por chave de propriedade e/ou valor (por exemplo, `plan = pro`)
   - **Contagem de eventos** — Encontre sessões com um número específico de eventos personalizados (por exemplo, mais de 5 eventos)

### Melhores Práticas




> [!TIP]
> - Use nomenclatura consistente (`snake_case`, por exemplo, `button_clicked` e não `Button Clicked`)
> - Mantenha os valores das propriedades simples (strings, números, booleanos) — evite objetos aninhados
> - Concentre-se em ações importantes para depuração ou análise – não registre tudo
> - As propriedades são para contexto por evento. Para atributos de nível de sessão, use **Metadados**

---

## Metadados

Anexe pares de valores-chave no nível da sessão que descrevam o contexto do usuário ou da sessão. Ao contrário dos eventos, os metadados são definidos uma vez por chave e aplicam-se a toda a sessão.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

Os valores de metadados devem ser `string`, `number` ou `boolean`. Objetos e arrays não são aceitos.

### Quando usar metadados versus eventos

| Caso de uso | Use **Metadados** | Use **Eventos** |
|---|---|---|
| Plano de assinatura do usuário | `setMetadata('plan', 'pro')` | |
| O usuário clicou em um botão | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| Variante de teste A/B | `setMetadata('ab_variant', 'v2')` | |
| Compra concluída | | `logEvent('purchase', { amount: 29 })` |
| Função do usuário | `setMetadata('role', 'admin')` | |
| Etapa de integração alcançada | | `logEvent('onboarding_step', { step: 3 })` |

**Regra prática:** Se descrever *quem é o usuário* ou *em que estado ele se encontra*, use metadados. Se descreve *algo que aconteceu*, use eventos.

## Controles de privacidade

Todas as entradas de texto são mascaradas por padrão (`maskAllInputs: true`). Os campos mascarados aparecem como entradas em branco nas repetições e os valores nunca são capturados na origem. Senha, email, telefone e outros tipos de entrada confidenciais são sempre mascarados, independentemente dessa configuração.

### Elementos de bloqueio

Para excluir completamente um elemento DOM dos replays (ele aparece como um espaço reservado sólido), adicione um dos seguintes:

- Classe CSS: `rr-block`
- Atributo de dados: `data-rj-block` ou `data-rejourney-block`
- Seletor CSS personalizado por meio da opção de configuração `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Mascarando texto

Para mascarar o conteúdo de texto de um elemento (o texto é substituído, mas a forma do elemento permanece visível), adicione um dos seguintes:

- Classe CSS: `rr-mask`
- Atributo de dados: `data-rj-mask`, `data-rejourney-mask`, `data-private` ou qualquer `data-testid` contendo `"password"`
- Seletor CSS personalizado por meio da opção de configuração `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Ignorando Elementos

Para capturar a forma de um elemento, mas suprimir todos os eventos de interação (cliques, entradas) nele, adicione:

- Classe CSS: `rr-ignore`
- Atributo de dados: `data-rj-ignore` ou `data-rejourney-ignore`

### Funções de mascaramento personalizadas

Para lógica de mascaramento programático, use `maskInputFn` ou `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Consentimento do usuário e GDPR




> [!IMPORTANT]
> **Você é o Controlador de Dados.** Rejourney atua como Processador de Dados em seu nome. Você é responsável por garantir que seus usuários finais sejam informados sobre a gravação da sessão e que você tenha uma base legal válida para processar seus dados (por exemplo, consentimento ou interesses legítimos).

#### O que você deve fazer

1. **Divulgue a gravação da sessão em sua política de privacidade.** Inclui linguagem como:

   > * "Usamos Rejourney para registrar replays de sessão anonimizados e não anônimos de sua atividade em nosso site para nos ajudar a melhorar o produto e reduzir o atrito. Os dados da sessão podem incluir interações de página, informações do navegador e localização aproximada. Entradas de texto e elementos confidenciais são automaticamente mascarados e nunca capturados."*

2. **Gravação do portão por trás do consentimento** (recomendado para usuários do EEE):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respeite as opções de exclusão.** Se um usuário retirar o consentimento, interrompa a gravação e limpe sua identidade:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Consentimento granular via `setConsent`

Para um controle mais preciso, use `setConsent` para alternar análises e reprodução de forma independente:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

Definir `analytics: false` e `replay: false` juntos interrompe a sessão e limpa todos os dados na fila. Definir `replay: false` sozinho interrompe o gravador rrweb, mas mantém o rastreamento de eventos em execução.

#### Captura de log do console

A captura de log do console está desabilitada por padrão (`trackConsoleLogs: false`). Ative-o somente se precisar, pois os logs do console podem conter PII dependendo de suas práticas de registro:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Geolocalização

A geolocalização derivada de IP (país, região, cidade) é coletada por padrão. Quando `collectGeoLocation` é `false`, o SDK passa um sinalizador que suprime a pesquisa de geolocalização de IP no backend — nenhum dado de localização é armazenado para essa sessão:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Modo somente observação (sem gravação visual)

Para capturar erros, tarefas longas, atividade de rede e análises **sem** gravando replays visuais, defina `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Quando ativado, toda a telemetria é coletada, mas nenhuma gravação rrweb é executada – as sessões não aparecerão na página Replays, mas análises completas, erros e dados de rede ainda serão capturados. Útil quando um usuário desativou a gravação visual, mas você ainda deseja observabilidade.

> **Observação:** Você pode definir isso condicionalmente por usuário, por exemplo, com base em uma preferência de consentimento armazenada:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Detecção de bots

Bots e navegadores automatizados são ignorados por padrão (`ignoreBots: true`). Playwright, Puppeteer, Selenium e outros clientes baseados em webdriver são suprimidos. Para gravar sessões de automação (por exemplo, para ferramentas internas):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Para fornecer um padrão personalizado de detecção de bot:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Captura de solicitação de rede

As solicitações de rede (fetch e XHR) são interceptadas e registradas por padrão (`autoTrackNetwork: true`). Os tamanhos do corpo de solicitação e resposta são **não** capturados por padrão (`networkCaptureSizes: false`). URLs, métodos, códigos de status e durações são sempre capturados.

Para excluir URLs específicos:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

Para filtrar ou editar solicitações antes de serem enviadas:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Referência de configuração

| Opção | Tipo | Padrão | Descrição |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | Chame `start()` automaticamente após a conclusão de `init()` |
| `disableInDev` | `boolean` | `false` | Suprimir gravação em `localhost` e `127.0.0.1` |
| `debug` | `boolean` | `false` | Habilitar registro detalhado de SDK no console do navegador |
| `enabled` | `boolean` | `true` | Master kill switch - definido como `false` para evitar qualquer gravação |
| `observeOnly` | `boolean` | `false` | Capture análises/erros/rede sem reprodução visual |
| `captureReplay` | `boolean` | `true` | Habilitar captura de reprodução visual do rrweb |
| `allowedDomains` | `string[]` | `[]` | Restrinja a gravação a domínios específicos. Vazio significa todos os domínios permitidos. Suporta curingas `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | Duração máxima da sessão em milissegundos (padrão: 30 minutos) |
| `collectGeoLocation` | `boolean` | `true` | Coletar país/região/cidade derivado de IP |
| `captureAttribution` | `boolean` | `true` | Capture parâmetros UTM, referenciador e URL de entrada no início da sessão |
| `ignoreBots` | `boolean` | `true` | Suprimir a gravação de bots e webdrivers detectados |
| `recordAutomation` | `boolean` | `false` | Permitir gravação de sessões de Dramaturgo/Puppeteer/Selenium |
| `autoTrackRoutes` | `boolean` | `true` | Rastreie automaticamente as alterações de rota via Histórico API |
| `routeName` | `(location: Location) => string` | — | Função personalizada para derivar o nome da tela de `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | Interceptar e registrar solicitações de busca/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | URLs a serem excluídos do rastreamento de rede |
| `networkCaptureSizes` | `boolean` | `false` | Incluir tamanhos de corpo de solicitação/resposta em logs de rede |
| `trackConsoleLogs` | `boolean` | `false` | Capturar saída `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | Detectar e registrar tarefas longas (blocos de thread JS > 50ms) |
| `trackResourceErrors` | `boolean` | `true` | Capture cargas de recursos com falha (imagens, scripts, folhas de estilo) |
| `maskAllInputs` | `boolean` | `true` | Mascarar todos os valores de entrada de texto em replays |
| `blockClass` | `string \| RegExp` | `'rr-block'` | Classe CSS para bloquear totalmente a reprodução de um elemento |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | Seletor CSS para bloquear totalmente os elementos da reprodução |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | Classe CSS para ignorar eventos de interação em um elemento |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | Seletor CSS para ignorar eventos de interação |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | Classe CSS para mascarar conteúdo de texto em reprodução |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | Seletor CSS para mascarar conteúdo de texto |
| `maskInputFn` | `(value, element) => string` | — | Função personalizada para transformar valores de entrada antes da captura |
| `maskTextFn` | `(text, element) => string` | — | Função personalizada para transformar conteúdo de texto antes da captura |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Função personalizada para decidir se deseja gravar por carregamento de página |
| `beforeSendEvent` | `(event) => event \| null` | — | Filtre ou modifique eventos antes que eles sejam enfileirados. Retornar `null` para dropar |
| `beforeSendNetwork` | `(request) => request \| null` | — | Filtre ou modifique as entradas da rede antes que elas sejam enfileiradas. Retornar `null` para dropar |
| `onAuthError` | `(error) => void` | — | Chamado quando SDK não consegue autenticar com o back-end |

## Parando a gravação

Chame `stop()` para encerrar a sessão, liberar quaisquer eventos pendentes e limpar todos os ouvintes SDK:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` é seguro para ligar várias vezes. Após parar, ligue novamente para `start()` para iniciar uma nova sessão.

## ID da sessão

Acesse o ID da sessão atual para correlacionar sessões Rejourney com seus próprios logs ou ferramentas de suporte:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Retorna `null` se nenhuma sessão estiver ativa.

## Ajudantes de status

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
