<!-- AI_PROMPT_SECTION -->
**Vous utilisez Cursor, Claude ou ChatGPT ?** Copiez l'invite d'intégration et collez-la dans votre assistant AI pour générer automatiquement le code de configuration.

<!-- /AI_PROMPT_SECTION -->

## Installation

### Swift Package Manager

Ajoutez le package Rejourney dans Xcode via **Fichier → Ajouter des dépendances de package** et saisissez :

```
https://github.com/rejourneyco/rejourney
```

Ou ajoutez-le directement à votre `Package.swift` :

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
> Rejourney nécessite iOS 15.1 ou version ultérieure.

## Configuration Swift

Initialisez et démarrez Rejourney dans la structure de votre application `@main`.

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

Si vous utilisez `UIApplicationDelegate`, appelez `configure` dans `application(_:didFinishLaunchingWithOptions:)` :

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

L'enregistrement commence dès que `start()` est résolu. Vous pouvez vérifier le résultat si nécessaire :

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Paramètres d'enregistrement à distance

Les paramètres du projet peuvent contrôler les paramètres d’enregistrement par défaut du Swift sans envoyer de nouvelle version d’application. Les versions SDK prises en charge lisent ces paramètres lorsque `start()` est appelé :

| Paramètre | Comportement |
|---|---|
| Taux d'échantillonnage | La valeur par défaut est `100%`. Les sessions échantillonnées capturent normalement. Les sessions échantillonnées reviennent avant le début de la capture de relecture, de l'interception réseau, des téléchargements ou de tout autre travail sur le package. |
| Durée maximale d'observabilité | Limite la durée maximale de chaque session d'observabilité. |
| Enregistrement de FPS | La valeur par défaut est `1 FPS`. Les administrateurs de projet peuvent choisir `1`, `2` ou `3 FPS`. Si la configuration à distance n'est pas disponible, le SDK revient au comportement de capture local/par défaut. |
| Confidentialité de la saisie de texte | Par défaut, toutes les entrées de texte sont masquées. Le mode sécurisé uniquement maintient les champs de mot de passe/sécurisés masqués et permet à d'autres entrées de texte d'apparaître dans les rediffusions de débogage. |

## Suivi d'écran

Rejourney ne se connecte pas automatiquement à la navigation SwiftUI, appelez donc `trackScreen` chaque fois que l'utilisateur accède à un nouvel écran.

### SwiftUI

Utilisez `.onAppear` ou un modificateur compatible avec la navigation :

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

### KitUI

Appelez `trackScreen` dans `viewDidAppear` :

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### Chemin de navigation / Pile de navigation

Observez le chemin de navigation et suivez les changements :

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

## Identification de l'utilisateur

Associez des sessions à vos propres identifiants utilisateur afin de pouvoir trouver des utilisateurs spécifiques dans le tableau de bord.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Confidentialité:** Use internal IDs or UUIDs. Si vous devez utiliser PII (e-mail, téléphone), hachez-le avant de le transmettre.

L'identité est conservée lors des lancements d'applications via `UserDefaults` : il vous suffit d'appeler `identify` une fois par connexion, et non à chaque ouverture d'application.

## Événements personnalisés

Suivez les actions significatives des utilisateurs pour comprendre le comportement, déboguer les problèmes et filtrer les rediffusions de session dans le tableau de bord.

### Utilisation de base

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

| Paramètre | Tapez | Obligatoire | Descriptif |
|---|---|---|---|
| `name` | `String` | Oui | Nom de l'événement — utilisez `snake_case` pour plus de cohérence |
| `properties` | `[String: RejourneyMetadataValue]` | Non | Paires clé-valeur attachées à cet événement |

`RejourneyMetadataValue` accepte directement les littéraux Swift — aucun emballage n'est nécessaire :

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Exemples

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

### Comment les événements apparaissent dans le tableau de bord

Les événements personnalisés sont stockés par session et visibles à deux endroits :

1. **Chronologie de la rediffusion de la session** — Les événements apparaissent sous forme de marqueurs sur la chronologie de relecture afin que vous puissiez accéder au moment exact où une action s'est produite.
2. **Filtres d'archives de session** — Filtrez la liste des sessions par :
   - **Nom de l'événement** — Rechercher toutes les sessions contenant un événement spécifique (par exemple `purchase_completed`)
   - **Nombre d'événements** — Rechercher des sessions avec un nombre spécifique d'événements personnalisés

### Meilleures pratiques




> [!TIP]
> - Utilisez un nom cohérent (`snake_case`, par exemple `button_tapped` et non `Button Tapped`)
> - Gardez les valeurs de propriété simples (chaînes, nombres, booléens) – évitez les objets profondément imbriqués
> - Concentrez-vous sur les actions importantes pour le débogage ou l'analyse – n'enregistrez pas tout

## Contrôles de confidentialité

Les saisies de texte et les vues de la caméra sont automatiquement masquées par défaut. Les administrateurs de projet peuvent modifier le niveau de masquage de saisie de texte par défaut dans les paramètres du projet pour les versions SDK prises en charge. Les champs sécurisés/mot de passe, les vues de caméra et les masques explicites restent protégés.

Pour masquer des vues sensibles supplémentaires, utilisez les API `mask` et `unmask` :

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Pour SwiftUI, obtenez le `UIView` sous-jacent via un wrapper `UIViewRepresentable` ou `introspect`.

#### Feuilles natives

La capture de feuille native est activée par défaut (`captureNativeSheets: true`). Cela permet aux feuilles et boîtes de dialogue natives appartenant à l'application, telles que les modalités d'autorisation de paiement, d'apparaître dans les rediffusions de débogage lorsque le système d'exploitation autorise la capture. Les feuilles du système de clavier/saisie de texte sont exclues lorsque les saisies de texte sont masquées par défaut. Lorsque le masquage de saisie de texte est défini sur des champs sécurisés uniquement, les claviers ne font que faire de leur mieux et ne peuvent pas être capturés de manière fiable, car iOS peut les afficher comme des surfaces système protégées ou distantes. Les feuilles de partage du système d'exploitation sont également fournies au mieux et ne peuvent pas être capturées de manière fiable lorsque le système les restitue sous forme de surfaces protégées ou distantes.

Désactivez la capture de feuille native si vous souhaitez que la relecture visuelle reste limitée à la fenêtre principale de l'application :

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Consentement de l'utilisateur et GDPR




> [!IMPORTANT]
> **Vous êtes le responsable du traitement des données.** Rejourney agit en tant que sous-traitant des données en votre nom. Vous êtes responsable de vous assurer que vos utilisateurs finaux sont informés de l'enregistrement de la session et que vous disposez d'une base juridique valide pour traiter leurs données (par exemple, consentement ou intérêts légitimes).

#### Ce que tu dois faire

1. **Divulguez l'enregistrement de la session dans la politique de confidentialité de votre application.** Inclut un langage tel que :

   > * "Nous utilisons Rejourney pour enregistrer des rediffusions de session anonymisées ET non anonymisées de votre activité dans l'application afin de nous aider à améliorer le produit, à suivre les pannes et les problèmes et à réduire les frictions du produit. Les données de session peuvent inclure des interactions à l'écran, des informations sur l'appareil et une localisation approximative. Les saisies de texte et les éléments sensibles de l'interface utilisateur sont automatiquement masqués et jamais capturés. "*

2. **Enregistrement de porte après consentement** (recommandé pour les utilisateurs de l'EEE) :

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

3. **Respectez les désinscriptions.** Si un utilisateur retire son consentement, arrêtez l'enregistrement et effacez son identité :

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Mode d'observation uniquement (pas d'enregistrement visuel)

Pour capturer les erreurs, les plantages, ANRs et l'activité réseau **sans** enregistrant des rediffusions visuelles, définissez `observeOnly: true` :

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Lorsqu'elle est activée, toute la télémétrie est collectée mais aucune capture d'écran n'est prise — les sessions n'apparaîtront PAS dans votre page Replays mais les données complètes d'analyse, d'erreur, de réseau et de crash sont toujours capturées. Utile lorsque les utilisateurs ont désactivé l'enregistrement d'écran mais que vous souhaitez toujours une visibilité sur les erreurs.

> **Note:** Cela peut être défini de manière conditionnelle par utilisateur en fonction d'une préférence stockée ou d'un indicateur de consentement :
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Capture réseau

La capture des requêtes réseau (`autoTrackNetwork: true` par défaut) intercepte le trafic `URLSession` via un `URLProtocol` personnalisé. Désactivez-le si vous ne souhaitez pas que les données réseau soient collectées :

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Géolocalisation

La géolocalisation dérivée de l'IP (pays, région, ville) est collectée par défaut. Désactivez-le pour supprimer complètement la recherche :

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Référence de configuration

Toutes les options sont définies une fois dans `configure` et ne peuvent pas être modifiées après l'appel de `start`.

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

| Options | Tapez | Par défaut | Descriptif |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Remplacement pour les déploiements auto-hébergés |
| `userId` | `String?` | `nil` | ID utilisateur interne initial facultatif |
| `enabled` | `Bool` | `true` | Coupe-circuit principal — réglé sur `false` pour désactiver entièrement le SDK |
| `observeOnly` | `Bool` | `false` | Collectez uniquement la télémétrie, pas d'enregistrement visuel |
| `captureFPS` | `Int?` | `nil` | Sauvegarde FPS de capture locale en option. L'enregistrement des paramètres du projet à distance FPS est prioritaire lorsqu'il est disponible |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | Qualité de capture JPEG (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Téléchargez uniquement les données de session sur Wi-Fi |
| `captureScreen` | `Bool` | `true` | Activer/désactiver la capture d'écran visuelle |
| `captureAnalytics` | `Bool` | `true` | Activer/désactiver la collecte d'événements d'analyse |
| `captureCrashes` | `Bool` | `true` | Activer/désactiver le rapport d'erreur |
| `captureANR` | `Bool` | `true` | Activer/désactiver la détection ANR (application ne répondant pas) |
| `trackConsoleLogs` | `Bool` | `true` | Capturer les journaux de la console pour la session |
| `collectGeoLocation` | `Bool` | `true` | Collecter la géolocalisation dérivée de l'IP |
| `autoTrackNetwork` | `Bool` | `true` | Intercepter les requêtes `URLSession` pour la capture réseau |
| `captureNativeSheets` | `Bool` | `true` | Incluez des fenêtres de feuille/boîte de dialogue natives appartenant à l'application dans la relecture visuelle lorsque iOS permet la capture. Les feuilles de partage du système d'exploitation et les claviers peuvent être des surfaces protégées ou distantes et ne peuvent pas être capturés de manière fiable |
| `debug` | `Bool` | `false` | Imprimer les journaux détaillés SDK sur la console |

## Arrêter l'enregistrement

Arrêtez la session en cours et videz les données en attente :

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

La variante de rappel est disponible pour les contextes non asynchrones :

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## ID de session

Accédez à l'ID de session actuel à tout moment pour établir une corrélation avec vos propres journaux ou outils d'assistance :

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
