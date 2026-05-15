<!-- AI_PROMPT_SECTION -->
**Используете Cursor, Claude или ChatGPT?** Скопируйте запрос на интеграцию и вставьте его в помощник AI, чтобы автоматически сгенерировать код установки.

<!-- /AI_PROMPT_SECTION -->

## Установка

### Swift Package Manager

Добавьте пакет Rejourney в Xcode через **Файл → Добавить зависимости пакета.** и введите:

```
https://github.com/rejourneyco/rejourney
```

Или добавьте его прямо в свой `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.2.0")
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
> Для Rejourney требуется iOS 15.1 или более поздней версии.

## Swift Настройка

Инициализируйте и запустите Rejourney в структуре приложения `@main`.

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

Если вы используете `UIApplicationDelegate`, вызовите `configure` в `application(_:didFinishLaunchingWithOptions:)`:

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

Запись начнется, как только разрешится `start()`. При необходимости вы можете проверить результат:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Настройки удаленной записи

В настройках проекта можно управлять настройками записи Swift без отправки новой сборки приложения. Поддерживаемые версии SDK считывают эти настройки при вызове `start()`:

| Настройка | Поведение |
|---|---|
| Частота дискретизации | По умолчанию `100%`. Сеансы выборки захватываются нормально. Выборочные сеансы возвращаются до начала захвата повторов, сетевого перехвата, загрузки или другой работы с пакетом. |
| Максимальная продолжительность наблюдения | Ограничивает максимальную продолжительность каждого сеанса наблюдения. |
| Запись FPS | По умолчанию `1 FPS`. Администраторы проекта могут выбрать `1`, `2` или `3 FPS`. Если удаленная конфигурация недоступна, SDK возвращается к локальному/по умолчанию режиму захвата. |
| Конфиденциальность ввода текста | По умолчанию маскируются все текстовые вводы. В режиме «Только защита» поля пароля/безопасности остаются замаскированными, а другие вводимые текстовые данные отображаются в повторах отладки. |

## Отслеживание экрана

Rejourney не подключается к навигации SwiftUI автоматически, поэтому вызывайте `trackScreen` каждый раз, когда пользователь переходит на новый экран.

### SwiftUI

Используйте `.onAppear` или модификатор с поддержкой навигации:

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

### УИКит

Вызовите `trackScreen` внутри `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### Путь навигации/Стек навигации

Наблюдайте за путем навигации и отслеживайте изменения:

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

## Идентификация пользователя

Свяжите сеансы со своими идентификаторами пользователей, чтобы вы могли найти конкретных пользователей на панели мониторинга.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Конфиденциальность:** Используйте внутренние идентификаторы или UUID. Если вам необходимо использовать PII (электронная почта, телефон), хешируйте его перед передачей.

Идентификация сохраняется при запуске приложения через `UserDefaults` — вам нужно вызывать `identify` только один раз при входе в систему, а не при каждом открытии приложения.

## Пользовательские события

Отслеживайте значимые действия пользователя, чтобы понимать поведение, устранять проблемы и фильтровать повторы сеансов на панели мониторинга.

### Основное использование

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

| Параметр | Тип | Требуется | Описание |
|---|---|---|---|
| `name` | `String` | Да | Имя события — для согласованности используйте `snake_case` |
| `properties` | `[String: RejourneyMetadataValue]` | Нет | Пары ключ-значение, прикрепленные к этому событию |

`RejourneyMetadataValue` принимает литералы Swift напрямую — перенос не требуется:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Примеры

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

### Как события появляются на панели мониторинга

Пользовательские события сохраняются для каждого сеанса и видны в двух местах:

1. **Хронология воспроизведения сеанса** — события отображаются в виде маркеров на временной шкале воспроизведения, поэтому вы можете перейти к точному моменту, когда произошло действие.
2. **Фильтры архива сеансов** — Фильтровать список сеансов по:
   - **Название события** — Найти все сеансы, содержащие определенное событие (например, `purchase_completed`).
   - **Количество событий** — найти сеансы с определенным количеством пользовательских событий.

### Лучшие практики




> [!TIP]
> - Используйте согласованное именование (`snake_case`, например `button_tapped`, а не `Button Tapped`).
> - Сохраняйте значения свойств простыми (строки, числа, логические значения) — избегайте глубоко вложенных объектов.
> - Сосредоточьтесь на действиях, которые важны для отладки или аналитики — не записывайте все.

## Контроль конфиденциальности

По умолчанию ввод текста и вид с камеры автоматически маскируются. Администраторы проекта могут изменить уровень маскировки ввода текста по умолчанию в настройках проекта для поддерживаемых версий SDK. Поля защиты/пароля, изображения с камеры и явные маски остаются защищенными.

Чтобы скрыть дополнительные конфиденциальные представления, используйте API `mask` и `unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Для SwiftUI получите базовый `UIView` через оболочку `UIViewRepresentable` или `introspect`.

#### Родные листы

Собственный захват листа включен по умолчанию (`captureNativeSheets: true`). Это позволяет собственным листам и диалоговым окнам, принадлежащим приложению, таким как модальные окна авторизации платежей, появляться в повторах отладки, когда ОС разрешает захват. Листы системы клавиатуры/ввода текста исключаются, если ввод текста маскируется по умолчанию. Если маскирование ввода текста установлено только для защищенных полей, клавиатуры работают только с максимальной эффективностью и не могут быть надежно захвачены, поскольку iOS может отображать их как защищенные или удаленные системные поверхности. Таблицы общего доступа к ОС также предназначены только для максимальных усилий и не могут быть надежно зафиксированы, когда система отображает их как защищенные или удаленные поверхности.

Отключите встроенный захват листа, если вы хотите, чтобы визуальное воспроизведение ограничивалось главным окном приложения:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Согласие пользователя и GDPR




> [!IMPORTANT]
> **Вы являетесь Контроллером данных.** Rejourney выступает в качестве обработчика данных от вашего имени. Вы несете ответственность за то, чтобы ваши конечные пользователи были проинформированы о записи сеанса и что у вас есть действительная правовая основа для обработки их данных (например, согласие или законные интересы).

#### Что ты должен сделать

1. **Раскройте запись сеанса в политике конфиденциальности вашего приложения.** Включите такие языки, как:

   > * «Мы используем Rejourney для записи анонимных и неанонимных повторов сеансов вашей активности в приложении, чтобы помочь нам улучшить продукт, отслеживать сбои и проблемы, а также уменьшить трение продукта. Данные сеанса могут включать взаимодействия с экраном, информацию об устройстве и приблизительное местоположение. Текстовые вводы и конфиденциальные элементы пользовательского интерфейса автоматически маскируются и никогда не фиксируются». *

2. **Запись ворот после согласия** (рекомендуется для пользователей ЕЭЗ):

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

3. **Уважайте возможность отказа.** Если пользователь отзовет согласие, прекратите запись и очистите свою личность:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Режим только наблюдения (без визуальной записи)

Чтобы фиксировать ошибки, сбои, ANRs и сетевую активность **без**, записывая визуальные повторы, установите `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Если эта функция включена, вся телеметрия собирается, но снимки экрана не делаются — сеансы НЕ будут отображаться на вашей странице повторов, но все равно будет собрана полная аналитика, данные об ошибках, сети и сбоях. Полезно, когда пользователи отключили запись экрана, но вам все равно нужна видимость ошибок.

> **Примечание:** Это можно установить условно для каждого пользователя на основе сохраненных предпочтений или флага согласия:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Захват сети

Перехват сетевых запросов (по умолчанию `autoTrackNetwork: true`) перехватывает трафик `URLSession` через специальный `URLProtocol`. Отключите его, если вы не хотите, чтобы сетевые данные собирались:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Геолокация

Геолокация на основе IP (страна, регион, город) собирается по умолчанию. Отключите его, чтобы полностью запретить поиск:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Справочник по конфигурации

Все параметры устанавливаются один раз в `configure` и не могут быть изменены после вызова `start`.

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

| Вариант | Тип | По умолчанию | Описание |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Переопределить для локальных развертываний |
| `userId` | `String?` | `nil` | Необязательный начальный внутренний идентификатор пользователя |
| `enabled` | `Bool` | `true` | Главный аварийный выключатель — установите значение `false`, чтобы полностью отключить SDK |
| `observeOnly` | `Bool` | `false` | Собирайте только телеметрию, без визуальной записи |
| `captureFPS` | `Int?` | `nil` | Дополнительный резервный локальный захват FPS. Настройки удаленного проекта, запись FPS имеет приоритет, если она доступна |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | Качество захвата JPEG (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Загружать данные сеанса только через Wi-Fi |
| `captureScreen` | `Bool` | `true` | Включить/выключить визуальный захват экрана |
| `captureAnalytics` | `Bool` | `true` | Включить/отключить сбор событий аналитики |
| `captureCrashes` | `Bool` | `true` | Включить/отключить отчеты о сбоях |
| `captureANR` | `Bool` | `true` | Включить/отключить обнаружение ANR (приложение не отвечает) |
| `trackConsoleLogs` | `Bool` | `true` | Захват журналов консоли для сеанса |
| `collectGeoLocation` | `Bool` | `true` | Сбор геолокации на основе IP |
| `autoTrackNetwork` | `Bool` | `true` | Перехват запросов `URLSession` для захвата сети |
| `captureNativeSheets` | `Bool` | `true` | Включите собственные листы/диалоговые окна, принадлежащие приложению, в визуальное воспроизведение, если iOS разрешает захват. Общие листы и клавиатуры ОС могут быть защищены или удалены от поверхностей и не могут быть надежно захвачены |
| `debug` | `Bool` | `false` | Вывести подробные журналы SDK на консоль |

## Остановка записи

Остановите текущий сеанс и очистите ожидающие данные:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

Вариант обратного вызова доступен для неасинхронных контекстов:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## Идентификатор сеанса

Получите доступ к текущему идентификатору сеанса в любое время, чтобы сопоставить его с вашими собственными журналами или инструментами поддержки:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
