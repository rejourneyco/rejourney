<!-- AI_PROMPT_SECTION -->
**Usando Cursor, Claude ou ChatGPT?** Copie o prompt de integração e cole-o em seu assistente AI para gerar automaticamente o código de configuração.

<!-- /AI_PROMPT_SECTION -->

## Instalação

### Swift Package Manager

Adicione o pacote Rejourney em Xcode via **Arquivo → Adicionar dependências de pacote** e digite:

```
https://github.com/rejourneyco/rejourney
```

Ou adicione-o diretamente ao seu `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.3.0")
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "Rejourney", package: "rejourney")
        ]
    )
]
```

> [!NOTE]
> Rejourney requer iOS 15.1 ou posterior.

## Configuração Swift

Inicialize e inicie Rejourney em sua estrutura de aplicativo `@main`.

```swift
import SwiftUI
import Rejourney

@main
struct MyApp: App {

    @MainActor
    init() {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

Se você usar `UIApplicationDelegate`, chame `configure` em `application(_:didFinishLaunchingWithOptions:)`:

```swift
import UIKit
import Rejourney

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    @MainActor
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
        return true
    }
}
```

A gravação começa assim que `start()` é resolvido. Você pode verificar o resultado, se necessário:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Configurações de gravação remota

As configurações do projeto podem controlar os padrões de gravação Swift sem enviar uma nova versão do aplicativo. Versões SDK suportadas leem estas configurações quando `start()` é chamado:

| Configuração | Comportamento |
|---|---|
| Taxa de amostragem | O padrão é `100%`. As sessões amostradas são capturadas normalmente. As sessões amostradas retornam antes do início da captura de reprodução, interceptação de rede, uploads ou outro trabalho de pacote. |
| Duração máxima de observabilidade | Limita a duração máxima de cada sessão de observabilidade. |
| Gravando FPS | O padrão é `1 FPS`. Os administradores do projeto podem escolher `1`, `2` ou `3 FPS`. Se a configuração remota não estiver disponível, o SDK volta ao comportamento de captura local/padrão. |
| Privacidade de entrada de texto | O padrão é mascarar todas as entradas de texto. O modo somente seguro mantém campos de senha/seguros mascarados e permite que outras entradas de texto apareçam em replays de depuração. |

## Rastreamento de tela

Rejourney não se conecta automaticamente à navegação SwiftUI, portanto, chame `trackScreen` sempre que o usuário navegar para uma nova tela.

### SwiftUI

Use `.onAppear` ou um modificador com reconhecimento de navegação:

```swift
struct CountriesListView: View {
    var body: some View {
        List { /* ... */ }
            .onAppear {
                Rejourney.trackScreen("Countries List")
            }
    }
}
```

### UI Kit

Chame `trackScreen` dentro de `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### NavigationPath / NavigationStack

Observe o caminho de navegação e acompanhe as alterações:

```swift
@State private var path = NavigationPath()

NavigationStack(path: $path) {
    ContentView()
}
.onChange(of: path) { _ in
    // derive screen name from path and call trackScreen
    Rejourney.trackScreen(currentScreenName(from: path))
}
```

## Identificação do usuário

Associe sessões aos seus próprios IDs de usuário para encontrar usuários específicos no painel.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Privacidade:** Use IDs internos ou UUIDs. Se você precisar usar PII (e-mail, telefone), faça um hash antes de passá-lo.

A identidade é mantida durante as inicializações de aplicativos via `UserDefaults` — você só precisa ligar para `identify` uma vez por login, não em todos os aplicativos abertos.

## Eventos personalizados

Rastreie ações significativas do usuário para entender o comportamento, depurar problemas e filtrar replays de sessões no painel.

### Uso Básico

```swift
import Rejourney

// Simple event (name only)
Rejourney.logEvent("signup_completed")

// Event with properties
Rejourney.logEvent("button_tapped", properties: ["buttonName": "get_started"])
```

### API

```swift
Rejourney.logEvent(_ name: String, properties: [String: RejourneyMetadataValue] = [:])
```

| Parâmetro | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `name` | `String` | Sim | Nome do evento — use `snake_case` para consistência |
| `properties` | `[String: RejourneyMetadataValue]` | Não | Pares de valores-chave anexados a este evento |

`RejourneyMetadataValue` aceita literais Swift diretamente - sem necessidade de empacotamento:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Exemplos

```swift
// E-commerce
Rejourney.logEvent("purchase_completed", properties: [
    "plan": "pro",
    "amount": 29.99,
    "currency": "USD"
])

// Onboarding
Rejourney.logEvent("onboarding_step", properties: [
    "step": 3,
    "stepName": "profile_setup",
    "skipped": false
])

// Feature usage
Rejourney.logEvent("feature_used", properties: [
    "feature": "dark_mode",
    "enabled": true
])

// Errors / edge cases
Rejourney.logEvent("payment_failed", properties: [
    "errorCode": "card_declined",
    "retryCount": 2
])
```

### Como os eventos aparecem no painel

Os eventos personalizados são armazenados por sessão e visíveis em dois locais:

1. **Linha do tempo de repetição da sessão** — Os eventos aparecem como marcadores na linha do tempo de repetição para que você possa pular para o momento exato em que uma ação ocorreu.
2. **Filtros de arquivo de sessão** — Filtre a lista de sessões por:
   - **Nome do evento** — Encontre todas as sessões contendo um evento específico (por exemplo, `purchase_completed`)
   - **Contagem de eventos** — Encontre sessões com um número específico de eventos personalizados

### Melhores práticas




> [!TIP]
> - Use nomenclatura consistente (`snake_case`, por exemplo, `button_tapped` e não `Button Tapped`)
> - Mantenha os valores das propriedades simples (strings, números, booleanos) — evite objetos profundamente aninhados
> - Concentre-se em ações importantes para depuração ou análise – não registre tudo

## Controles de privacidade

As entradas de texto e as visualizações da câmera são automaticamente mascaradas por padrão. Os administradores do projeto podem alterar o nível de mascaramento de entrada de texto padrão nas configurações do projeto para versões SDK suportadas. Campos seguros/senha, visualizações de câmeras e máscaras explícitas permanecem protegidos.

Para ocultar visualizações confidenciais adicionais, use as APIs `mask` e `unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Para SwiftUI, obtenha o `UIView` subjacente por meio de um wrapper `UIViewRepresentable` ou `introspect`.

#### Planilhas nativas

A captura de planilha nativa é habilitada por padrão (`captureNativeSheets: true`). Isso permite que planilhas e caixas de diálogo nativas de propriedade do aplicativo, como modais de autorização de pagamento, apareçam em replays de depuração quando o sistema operacional permitir a captura. As folhas do sistema de teclado/entrada de texto são excluídas quando as entradas de texto são mascaradas por padrão. Quando o mascaramento de entrada de texto é definido apenas para campos seguros, os teclados são apenas de melhor esforço e não podem ser capturados de forma confiável porque iOS pode renderizá-los como superfícies de sistema remotas ou protegidas. As planilhas de compartilhamento do sistema operacional também são apenas de melhor esforço e não podem ser capturadas de forma confiável quando o sistema as renderiza como superfícies protegidas ou remotas.

Desative a captura de planilha nativa se quiser que a reprodução visual fique limitada à janela principal do aplicativo:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Consentimento do usuário e GDPR




> [!IMPORTANT]
> **Você é o Controlador de Dados.** Rejourney atua como Processador de Dados em seu nome. Você é responsável por garantir que seus usuários finais sejam informados sobre a gravação da sessão e que você tenha uma base legal válida para processar seus dados (por exemplo, consentimento ou interesses legítimos).

#### O que você deve fazer

1. **Divulgue a gravação da sessão na política de privacidade do seu aplicativo.** Inclui linguagem como:

   > * "Usamos Rejourney para registrar replays de sessão anonimizados E não anônimos de sua atividade no aplicativo para nos ajudar a melhorar o produto, rastrear falhas e problemas e reduzir o atrito do produto. Os dados da sessão podem incluir interações na tela, informações do dispositivo e localização aproximada. Entradas de texto e elementos confidenciais da interface do usuário são automaticamente mascarados e nunca capturados."*

2. **Gravação do portão por trás do consentimento** (recomendado para usuários do EEE):

   ```swift
   // Configure early — before consent is known
   Rejourney.configure(publicKey: "rj_your_public_key")

   // Call start() only after the user accepts your privacy policy
   func onUserConsented() {
       Task { @MainActor in
           await Rejourney.start()
       }
   }
   ```

3. **Respeite as opções de exclusão.** Se um usuário retirar o consentimento, interrompa a gravação e limpe sua identidade:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Modo somente observação (sem gravação visual)

Para capturar erros, falhas, ANRs e atividade de rede **sem** gravando replays visuais, defina `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Quando ativado, toda a telemetria é coletada, mas nenhuma captura de tela é feita. As sessões NÃO aparecerão na página Replays, mas dados completos de análises, erros, rede e falhas ainda serão capturados. Útil quando os usuários optaram por não gravar a tela, mas você ainda deseja visibilidade de erros.

> **Observação:** Isso pode ser definido condicionalmente por usuário com base em uma preferência armazenada ou sinalizador de consentimento:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Captura de rede

A captura de solicitação de rede (`autoTrackNetwork: true` por padrão) intercepta o tráfego `URLSession` por meio de um `URLProtocol` personalizado. Desative-o se não quiser que os dados da rede sejam coletados:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolocalização

A geolocalização derivada de IP (país, região, cidade) é coletada por padrão. Desative-o para suprimir totalmente a pesquisa:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Referência de configuração

Todas as opções são definidas uma vez em `configure` e não podem ser alteradas após `start` ser chamado.

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(
        apiURL:             URL(string: "https://api.rejourney.co")!,
        userId:             nil,
        enabled:            true,
        observeOnly:        false,
        captureFPS:         nil,
        captureQuality:     .medium,
        wifiOnly:           false,
        captureScreen:      true,
        captureAnalytics:   true,
        captureCrashes:     true,
        captureANR:         true,
        trackConsoleLogs:   true,
        collectGeoLocation: true,
        autoTrackNetwork:   true,
        captureNativeSheets: true,
        debug:              false
    )
)
```

| Opção | Tipo | Padrão | Descrição |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Substituição para implantações auto-hospedadas |
| `userId` | `String?` | `nil` | ID de usuário interno inicial opcional |
| `enabled` | `Bool` | `true` | Master kill switch - definido como `false` para desativar totalmente o SDK |
| `observeOnly` | `Bool` | `false` | Colete apenas telemetria, sem gravação visual |
| `captureFPS` | `Int?` | `nil` | Fallback FPS de captura local opcional. A gravação remota de FPS nas configurações do projeto tem precedência quando disponível |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | Qualidade de captura JPEG (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Carregar dados da sessão apenas em Wi-Fi |
| `captureScreen` | `Bool` | `true` | Ativar/desativar captura visual de tela |
| `captureAnalytics` | `Bool` | `true` | Ativar/desativar coleta de eventos analíticos |
| `captureCrashes` | `Bool` | `true` | Ativar/desativar relatórios de falhas |
| `captureANR` | `Bool` | `true` | Ativar/desativar detecção ANR (aplicativo não responde) |
| `trackConsoleLogs` | `Bool` | `true` | Capturar logs do console para a sessão |
| `collectGeoLocation` | `Bool` | `true` | Colete geolocalização derivada de IP |
| `autoTrackNetwork` | `Bool` | `true` | Interceptar solicitações `URLSession` para captura de rede |
| `captureNativeSheets` | `Bool` | `true` | Inclui janelas de planilha/diálogo nativas de propriedade do aplicativo na reprodução visual quando iOS permitir a captura. Folhas de compartilhamento de sistema operacional e teclados podem ser superfícies protegidas ou remotas e não podem ser capturadas de forma confiável |
| `debug` | `Bool` | `false` | Imprimir logs SDK detalhados no console |

## Parando a gravação

Pare a sessão atual e libere os dados pendentes:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

A variante de retorno de chamada está disponível para contextos não assíncronos:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## ID da sessão

Acesse o ID da sessão atual a qualquer momento para correlacionar com seus próprios logs ou ferramentas de suporte:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
