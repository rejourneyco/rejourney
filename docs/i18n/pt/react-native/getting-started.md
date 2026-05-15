<!-- AI_PROMPT_SECTION -->
**Usando Cursor, Claude ou ChatGPT?** Copie o prompt de integração e cole-o em seu assistente AI para gerar automaticamente o código de configuração.

<!-- /AI_PROMPT_SECTION -->

## Instalação

Adicione o pacote Rejourney ao seu projeto usando npm ou yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney requer código nativo e não é compatível com Expo Go. Use compilações de desenvolvimento:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## Configuração de 3 linhas

Inicialize e inicie Rejourney na parte superior do seu aplicativo (por exemplo, em App.tsx ou index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Não requer empacotamento do provedor. A gravação começa imediatamente.

## Configurações de gravação remota

As configurações do projeto podem controlar os padrões de gravação React Native sem enviar uma nova versão do aplicativo. As versões SDK suportadas leem a configuração FPS de gravação remota no início da sessão; o padrão é 1 FPS e os administradores do projeto podem escolher 1, 2 ou 3 FPS. Se a configuração remota não estiver disponível, o SDK volta ao comportamento de captura local/padrão.

## Rastreamento de tela

Rejourney rastreia automaticamente as alterações na tela para que você possa ver onde os usuários estão no seu aplicativo durante os replays. Escolha a configuração que corresponde à sua biblioteca de navegação:

### Expo Router (Automático)

Se você usar **Expo Router**, o rastreamento de tela funciona imediatamente. Nenhum código adicional é necessário.




> [!TIP]
> **Usando nomes de tela personalizados?** Se você usa Expo Router, mas deseja fornecer seus próprios nomes de tela manualmente, consulte a seção [Nomes de tela personalizados](#custom-screen-names) abaixo.

---

### React Navigation

Se você usar **React Navigation** (`@react-navigation/native`), use o gancho `useNavigationTracking` em sua raiz `NavigationContainer`:

```javascript
import { Rejourney } from '@rejourneyco/react-native';
import { NavigationContainer } from '@react-navigation/native';

function App() {
  const navigationTracking = Rejourney.useNavigationTracking();

  return (
    <NavigationContainer {...navigationTracking}>
      {/* Your screens */}
    </NavigationContainer>
  );
}
```

---

### Nomes de tela personalizados

Se você quiser especificar nomes de tela manualmente (por exemplo, para consistência analítica ou se não usar as bibliotecas acima), use o método `trackScreen`.

#### Para usuários Expo Router:
Para usar nomes personalizados com Expo Router, você deve primeiro desabilitar o rastreamento automático em sua configuração:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Chamada de rastreamento manual:
Chame `trackScreen` sempre que ocorrer uma mudança de tela:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Identificação do usuário

Associe sessões aos seus IDs de usuário internos para filtrar e pesquisar usuários específicos no painel.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Privacidade:** Use IDs internos ou UUIDs. Se você precisar usar PII (e-mail, telefone), faça hash antes de enviar.

## Eventos personalizados

Rastreie ações significativas do usuário para entender padrões de comportamento, depurar problemas e filtrar replays de sessão no painel.

### Uso Básico

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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

### Melhores práticas




> [!TIP]
> - Use nomenclatura consistente (`snake_case`, por exemplo, `button_clicked` e não `Button Clicked`)
> - Mantenha os valores das propriedades simples (strings, números, booleanos) — evite objetos aninhados
> - Concentre-se em ações importantes para depuração ou análise – não registre tudo
> - As propriedades são para contexto por evento. Para atributos de nível de sessão, use **Metadados**

---

## Metadados

Anexe pares de valores-chave no nível da sessão que descrevam o contexto do usuário ou da sessão. Ao contrário dos eventos, os metadados são definidos uma vez por chave e aplicam-se a toda a sessão.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Set a single property
Rejourney.setMetadata('plan', 'premium');

// Set multiple properties at once
Rejourney.setMetadata({
  role: 'admin',
  segment: 'enterprise',
  ab_variant: 'checkout_v2'
});
```

### Quando usar metadados versus eventos

| Caso de uso | Use **Metadados** | Use **Eventos** |
|---|---|---|
| Plano de assinatura do usuário |  `setMetadata('plan', 'pro')` | |
| O usuário clicou em um botão | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| Variante de teste A/B |  `setMetadata('ab_variant', 'v2')` | |
| Compra concluída | |  `logEvent('purchase', { amount: 29 })` |
| Função do usuário |  `setMetadata('role', 'admin')` | |
| Etapa de integração alcançada | |  `logEvent('onboarding_step', { step: 3 })` |

**Regra prática:** Se descrever *quem é o usuário* ou *em que estado ele se encontra*, use metadados. Se descreve *algo que aconteceu*, use eventos.

## Controles de privacidade

As entradas de texto e as visualizações da câmera são automaticamente mascaradas por padrão. Os administradores do projeto podem alterar o nível de mascaramento de entrada de texto padrão nas Configurações do projeto para versões SDK suportadas; versões mais antigas do SDK ignoram essa configuração remota e mantêm seu comportamento de mascaramento existente. Campos seguros/senha, visualizações de câmeras e máscaras explícitas permanecem protegidos.

Para ocultar manualmente UI confidencial adicional, envolva componentes no componente `Mask`:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

O conteúdo mascarado aparece como um retângulo sólido nas repetições e nunca é capturado na fonte.

### Consentimento do usuário e GDPR




> [!IMPORTANT]
> **Você é o Controlador de Dados.** Rejourney atua como Processador de Dados em seu nome. Você é responsável por garantir que seus usuários finais sejam informados sobre a gravação da sessão e que você tenha uma base legal válida para processar seus dados (por exemplo, consentimento ou interesses legítimos).

#### O que você deve fazer

1. **Divulgue a gravação da sessão na política de privacidade do seu aplicativo.** Inclui linguagem como:

   > * "Usamos Rejourney para registrar replays de sessão anonimizados E não anônimos de sua atividade no aplicativo para nos ajudar a melhorar o produto, rastrear falhas e problemas e reduzir o atrito do produto. Os dados da sessão podem incluir interações na tela, informações do dispositivo e localização aproximada. Entradas de texto e elementos confidenciais da interface do usuário são automaticamente mascarados e nunca capturados."*

2. **Gravação do portão por trás do consentimento** (recomendado para usuários do EEE):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Respeite as opções de exclusão.** Se um usuário retirar o consentimento, interrompa a gravação e limpe seus dados:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Captura de log do console

A captura de log do console é ativada por padrão (`trackConsoleLogs: true`). Os logs do console podem conter PII dependendo das práticas de registro do seu aplicativo. Desative-o se dados confidenciais aparecerem nos registros:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Geolocalização

A geolocalização derivada de IP (país, região, cidade) é coletada por padrão. Quando `collectGeoLocation` é `false`, o SDK passa um sinalizador para a camada nativa que suprime a pesquisa de geolocalização de IP no back-end – nenhum dado de localização é armazenado para essa sessão. Desative-o se não precisar de dados de localização ou quiser minimizar a coleta de dados para usuários do EEE:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Planilhas nativas

A captura de planilha nativa é habilitada por padrão (`captureNativeSheets: true`) para versões SDK suportadas. Isso permite que planilhas e caixas de diálogo nativas de propriedade do aplicativo, como modais de autorização de pagamento, apareçam em replays de depuração quando o sistema operacional permitir a captura. As folhas do sistema de teclado/entrada de texto são excluídas quando as entradas de texto são mascaradas por padrão. Quando o mascaramento de entrada de texto é definido apenas para campos seguros, os teclados são apenas de melhor esforço e não podem ser capturados de forma confiável, especialmente quando o sistema operacional os renderiza como superfícies protegidas ou remotas. As planilhas de compartilhamento do sistema operacional também são apenas de melhor esforço e não podem ser capturadas de forma confiável quando o sistema as renderiza como superfícies protegidas ou remotas.

Desative a captura de planilha nativa se quiser que a reprodução visual fique limitada à janela principal do aplicativo:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Modo somente observação (sem gravação visual)

Para capturar erros, falhas, ANRs e atividade de rede **sem** gravando replays visuais, defina `observeOnly: true`:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Quando ativado, toda a telemetria é coletada, mas nenhuma captura de tela é feita. As sessões NÃO aparecerão na sua página de replays, mas haverá dados completos de análise/erro/rede/travamento. Sem repetição. Isso é útil quando os usuários optaram por não gravar a tela, mas você ainda deseja visibilidade de erros.

> **Observação:** Isso pode ser definido condicionalmente por usuário, por exemplo, com base em uma preferência armazenada ou sinalizador de consentimento:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
