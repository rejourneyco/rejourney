<!-- AI_PROMPT_SECTION -->
**¿Utiliza Cursor, Claude o ChatGPT?** Copie el mensaje de integración y péguelo en su asistente AI para generar automáticamente el código de configuración.

<!-- /AI_PROMPT_SECTION -->

## Instalación

### Swift Package Manager

Agregue el paquete Rejourney en Xcode a través de **Archivo → Agregar dependencias del paquete** e ingrese:

```
https://github.com/rejourneyco/rejourney
```

O agréguelo directamente a su `Package.swift`:

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
> Rejourney requiere iOS 15.1 o posterior.

## Configuración de Swift

Inicialice e inicie Rejourney en la estructura de su aplicación `@main`.

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

Si usa `UIApplicationDelegate`, llame a `configure` en `application(_:didFinishLaunchingWithOptions:)`:

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

La grabación comienza tan pronto como se resuelve `start()`. Puede comprobar el resultado si es necesario:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Configuración de grabación remota

La configuración del proyecto puede controlar los valores predeterminados de grabación de Swift sin enviar una nueva versión de la aplicación. Las versiones compatibles de SDK leen estas configuraciones cuando se llama a `start()`:

| Configuración | Comportamiento |
|---|---|
| Frecuencia de muestreo | El valor predeterminado es `100%`. Las sesiones muestreadas se capturan normalmente. Las sesiones de muestra regresan antes de que comience la captura de reproducción, la interceptación de la red, las cargas u otros trabajos del paquete. |
| Duración máxima de observabilidad | Limita la duración máxima de cada sesión de observabilidad. |
| Grabación de FPS | El valor predeterminado es `1 FPS`. Los administradores de proyectos pueden elegir `1`, `2` o `3 FPS`. Si la configuración remota no está disponible, SDK vuelve al comportamiento de captura local/predeterminado. |
| Privacidad de entrada de texto | El valor predeterminado es enmascarar todas las entradas de texto. El modo solo seguro mantiene enmascarados los campos seguros y de contraseña y permite que aparezcan otras entradas de texto en las repeticiones de depuración. |

## Seguimiento de pantalla

Rejourney no se conecta automáticamente a la navegación SwiftUI, por lo tanto, llame a `trackScreen` cada vez que el usuario navegue a una nueva pantalla.

### SwiftUI

Utilice `.onAppear` o un modificador compatible con la navegación:

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

### UIKit

Llame a `trackScreen` dentro de `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### Ruta de navegación/pila de navegación

Observe la ruta de navegación y realice un seguimiento de los cambios:

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

## Identificación de usuario

Asocie sesiones con sus propios ID de usuario para que pueda encontrar usuarios específicos en el panel.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Privacidad:** Utilice ID internos o UUID. Si debe utilizar PII (correo electrónico, teléfono), haga un hash antes de pasarlo.

La identidad se conserva en todos los inicios de aplicaciones a través de `UserDefaults`; solo necesita llamar a `identify` una vez por inicio de sesión, no en cada aplicación abierta.

## Eventos personalizados

Realice un seguimiento de las acciones significativas del usuario para comprender el comportamiento, depurar problemas y filtrar las repeticiones de sesiones en el panel.

### Uso básico

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

| Parámetro | Tipo | Requerido | Descripción |
|---|---|---|---|
| `name` | `String` | Sí | Nombre del evento: utilice `snake_case` para mantener la coherencia |
| `properties` | `[String: RejourneyMetadataValue]` | No | Pares clave-valor adjuntos a este evento |

`RejourneyMetadataValue` acepta literales Swift directamente, no es necesario ajustarlos:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Ejemplos

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

### Cómo aparecen los eventos en el panel

Los eventos personalizados se almacenan por sesión y son visibles en dos lugares:

1. **Cronograma de repetición de la sesión**: los eventos aparecen como marcadores en la línea de tiempo de repetición para que puedas saltar al momento exacto en que ocurrió una acción.
2. **Filtros de archivo de sesión**: filtrar la lista de sesiones por:
   - **Nombre del evento**: busca todas las sesiones que contienen un evento específico (por ejemplo, `purchase_completed`)
   - **Recuento de eventos**: busque sesiones con una cantidad específica de eventos personalizados

### Mejores prácticas




> [!TIP]
> - Utilice nombres coherentes (`snake_case`, por ejemplo, `button_tapped`, no `Button Tapped`).
> - Mantenga los valores de propiedad simples (cadenas, números, valores booleanos): evite objetos profundamente anidados
> - Céntrese en acciones importantes para la depuración o el análisis; no registre todo

## Controles de privacidad

Las entradas de texto y las vistas de la cámara se enmascaran automáticamente de forma predeterminada. Los administradores del proyecto pueden cambiar el nivel de enmascaramiento de entrada de texto predeterminado en Configuración del proyecto para las versiones SDK compatibles. Los campos seguros/contraseña, las vistas de cámara y las máscaras explícitas permanecen protegidos.

Para ocultar vistas confidenciales adicionales, utilice las API `mask` y `unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Para SwiftUI, obtenga el `UIView` subyacente a través de un contenedor `UIViewRepresentable` o `introspect`.

#### Hojas nativas

La captura de hojas nativas está habilitada de forma predeterminada (`captureNativeSheets: true`). Esto permite que las hojas y cuadros de diálogo nativos propiedad de la aplicación, como los modales de autorización de pago, aparezcan en las repeticiones de depuración cuando el sistema operativo permite la captura. Las hojas del sistema de entrada de texto/teclado se excluyen cuando las entradas de texto están enmascaradas de forma predeterminada. Cuando el enmascaramiento de entrada de texto se configura solo para proteger campos, los teclados son solo de mejor esfuerzo y no se pueden capturar de manera confiable porque iOS puede representarlos como superficies de sistema remotas o protegidas. Las hojas compartidas del sistema operativo también son de mejor esfuerzo y no se pueden capturar de manera confiable cuando el sistema las presenta como superficies protegidas o remotas.

Desactive la captura de hojas nativas si desea que la reproducción visual permanezca limitada a la ventana principal de la aplicación:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Consentimiento del usuario y GDPR




> [!IMPORTANT]
> **Usted es el responsable del tratamiento de datos.** Rejourney actúa como Procesador de datos en su nombre. Usted es responsable de garantizar que sus usuarios finales estén informados sobre la grabación de sesiones y de que tiene una base legal válida para procesar sus datos (por ejemplo, consentimiento o intereses legítimos).

#### que debes hacer

1. **Divulgue la grabación de la sesión en la política de privacidad de su aplicación.** Incluye lenguaje como:

   > * "Usamos Rejourney para grabar repeticiones de sesiones anónimas y no anónimas de su actividad en la aplicación para ayudarnos a mejorar el producto, rastrear fallas y problemas y reducir la fricción del producto. Los datos de la sesión pueden incluir interacciones de pantalla, información del dispositivo y ubicación aproximada. Las entradas de texto y los elementos sensibles de la interfaz de usuario se enmascaran automáticamente y nunca se capturan".*

2. **Grabación de puerta detrás del consentimiento** (recomendado para usuarios del EEE):

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

3. **Respete las exclusiones.** Si un usuario retira su consentimiento, deje de grabar y borre su identidad:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Modo de sólo observación (sin grabación visual)

Para capturar errores, fallas, ANRs y actividad de red **sin** grabando repeticiones visuales, configure `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Cuando está habilitado, se recopila toda la telemetría, pero no se toman capturas de pantalla; las sesiones NO aparecerán en su página de Repeticiones, pero aún se capturan datos completos de análisis, errores, red y fallas. Útil cuando los usuarios han optado por no participar en la grabación de pantalla pero aún desean visibilidad del error.

> **Nota:** Esto se puede configurar condicionalmente por usuario según una preferencia almacenada o un indicador de consentimiento:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Captura de red

La captura de solicitudes de red (`autoTrackNetwork: true` de forma predeterminada) intercepta el tráfico `URLSession` a través de un `URLProtocol` personalizado. Desactívelo si no desea que se recopilen datos de red:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolocalización

La geolocalización derivada de IP (país, región, ciudad) se recopila de forma predeterminada. Deshabilítelo para suprimir la búsqueda por completo:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Referencia de configuración

Todas las opciones se configuran una vez en `configure` y no se pueden cambiar después de llamar a `start`.

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

| Opción | Tipo | Predeterminado | Descripción |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Anulación para implementaciones autohospedadas |
| `userId` | `String?` | `nil` | ID de usuario interno inicial opcional |
| `enabled` | `Bool` | `true` | Interruptor de apagado maestro: configúrelo en `false` para desactivar el SDK por completo |
| `observeOnly` | `Bool` | `false` | Recopila solo telemetría, sin grabación visual |
| `captureFPS` | `Int?` | `nil` | Reserva de FPS de captura local opcional. La grabación de FPS en configuración remota del proyecto tiene prioridad cuando esté disponible |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | Calidad de captura JPEG (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Cargue datos de sesión solo en Wi-Fi |
| `captureScreen` | `Bool` | `true` | Activar/desactivar la captura de pantalla visual |
| `captureAnalytics` | `Bool` | `true` | Activar/desactivar la recopilación de eventos de análisis |
| `captureCrashes` | `Bool` | `true` | Activar/desactivar informes de fallos |
| `captureANR` | `Bool` | `true` | Activar/desactivar la detección ANR (la aplicación no responde) |
| `trackConsoleLogs` | `Bool` | `true` | Capturar registros de consola para la sesión |
| `collectGeoLocation` | `Bool` | `true` | Recopilar geolocalización derivada de IP |
| `autoTrackNetwork` | `Bool` | `true` | Interceptar solicitudes `URLSession` para captura de red |
| `captureNativeSheets` | `Bool` | `true` | Incluya ventanas de diálogo/hojas nativas propiedad de la aplicación en la reproducción visual cuando iOS permita la captura. Las hojas y teclados compartidos del sistema operativo pueden estar protegidos o son superficies remotas y no se pueden capturar de manera confiable |
| `debug` | `Bool` | `false` | Imprima registros detallados SDK en la consola |

## Detener la grabación

Detenga la sesión actual y elimine los datos pendientes:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

La variante de devolución de llamada está disponible para contextos no asíncronos:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## ID de sesión

Acceda al ID de la sesión actual en cualquier momento para correlacionarlo con sus propios registros o herramientas de soporte:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
