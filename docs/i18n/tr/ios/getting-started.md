<!-- AI_PROMPT_SECTION -->
**Cursor, Claude veya ChatGPT mi kullanıyorsunuz?** Entegrasyon istemini kopyalayın ve kurulum kodunu otomatik olarak oluşturmak için AI yardımcınıza yapıştırın.

<!-- /AI_PROMPT_SECTION -->

## Kurulum

### Swift Package Manager

Rejourney paketini **Dosya → Paket Bağımlılıkları Ekle** aracılığıyla Xcode'ye ekleyin ve şunu girin:

```
https://github.com/rejourneyco/rejourney
```

Veya doğrudan `Package.swift`'nize ekleyin:

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
> Rejourney, iOS 15.1 veya üzerini gerektirir.

## Swift Kurulumu

`@main` Uygulama yapınızda Rejourney'yi başlatın ve başlatın.

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

`UIApplicationDelegate` kullanıyorsanız `application(_:didFinishLaunchingWithOptions:)`'de `configure`'yi arayın:

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

Kayıt, `start()` çözümlenir çözülmez başlar. Gerekirse sonucu kontrol edebilirsiniz:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Uzaktan Kayıt Ayarları

Proje Ayarları, yeni bir uygulama derlemesi göndermeden Swift kayıt varsayılanlarını kontrol edebilir. Desteklenen SDK sürümleri, `start()` çağrıldığında bu ayarları okur:

| Ayar | Davranış |
|---|---|
| Örnek oranı | Varsayılan olarak `100%` şeklindedir. Örneklenen oturumlar normal şekilde yakalanır. Örneklenen oturumlar, tekrar yakalama, ağ müdahalesi, yüklemeler veya diğer paket çalışmaları başlamadan önce geri döner. |
| Maksimum gözlemlenebilirlik süresi | Her gözlemlenebilirlik oturumunun maksimum uzunluğunu sınırlar. |
| FPS'yi Kaydetme | Varsayılan olarak `1 FPS` şeklindedir. Proje yöneticileri `1`, `2` veya `3 FPS`'yi seçebilir. Uzaktan yapılandırma kullanılamıyorsa SDK, yerel/varsayılan yakalama davranışına geri döner. |
| Metin girişi gizliliği | Tüm metin girişlerini maskeleme varsayılandır. Yalnızca güvenli mod, parola/güvenli alanları maskelenmiş halde tutar ve hata ayıklama tekrarlarında diğer metin girişlerinin görünmesine olanak tanır. |

## Ekran Takibi

Rejourney, SwiftUI navigasyonuna otomatik olarak bağlanmaz, bu nedenle kullanıcı yeni bir ekrana geçtiğinde `trackScreen`'yi çağırın.

### SwiftUI

`.onAppear` veya navigasyona duyarlı bir değiştirici kullanın:

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

`viewDidAppear` içinden `trackScreen`'yi arayın:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### NavigasyonYolu / NavigasyonYığını

Gezinme yolunu gözlemleyin ve değişiklik halinde izleyin:

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

## Kullanıcı Kimliği

Kontrol panelinde belirli kullanıcıları bulabilmeniz için oturumları kendi kullanıcı kimliklerinizle ilişkilendirin.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Mahremiyet:** Dahili kimlikleri veya UUID'leri kullanın. PII (e-posta, telefon) kullanmanız gerekiyorsa, iletmeden önce karma işlemi yapın.

Kimlik, `UserDefaults` aracılığıyla uygulama başlatılırken korunur; her uygulama açılışında değil, oturum açma başına `identify`'yi yalnızca bir kez aramanız gerekir.

## Özel Etkinlikler

Kontrol panelinde davranışı anlamak, sorunları ayıklamak ve oturum tekrarlarını filtrelemek için anlamlı kullanıcı eylemlerini izleyin.

### Temel Kullanım

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

| Parametre | Tür | Gerekli | Açıklama |
|---|---|---|---|
| `name` | `String` | Evet | Etkinlik adı — tutarlılık için `snake_case` kullanın |
| `properties` | `[String: RejourneyMetadataValue]` | Hayır | Bu etkinliğe eklenen anahtar/değer çiftleri |

`RejourneyMetadataValue`, Swift değişmez değerlerini doğrudan kabul eder; sarmaya gerek yoktur:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Örnekler

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

### Etkinlikler Kontrol Panelinde Nasıl Görünür?

Özel etkinlikler oturum başına depolanır ve iki yerde görünür:

1. **Oturum Tekrarı Zaman Çizelgesi** — Olaylar tekrar zaman çizelgesinde işaretçiler olarak görünür, böylece bir eylemin gerçekleştiği ana atlayabilirsiniz.
2. **Oturum Arşivi Filtreleri** — Oturum listesini şuna göre filtreleyin:
   - **Etkinlik adı** — Belirli bir etkinliği içeren tüm oturumları bulun (ör. `purchase_completed`)
   - **Etkinlik sayısı** — Belirli sayıda özel etkinliğe sahip oturumları bulun

### En İyi Uygulamalar




> [!TIP]
> - Tutarlı adlandırma kullanın (`snake_case`, örneğin `button_tapped`, `Button Tapped` değil)
> - Özellik değerlerini basit tutun (dizeler, sayılar, boolean'lar) — derinlemesine iç içe geçmiş nesnelerden kaçının
> - Hata ayıklama veya analiz için önemli olan eylemlere odaklanın; her şeyi günlüğe kaydetmeyin

## Gizlilik Kontrolleri

Metin girişleri ve kamera görünümleri varsayılan olarak otomatik olarak maskelenir. Proje yöneticileri, desteklenen SDK sürümleri için Proje Ayarları'nda varsayılan metin girişi maskeleme düzeyini değiştirebilir. Güvenli/şifre alanları, kamera görünümleri ve açık maskeler korunmaya devam eder.

Ek hassas görünümleri gizlemek için `mask` ve `unmask` API'lerini kullanın:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

SwiftUI için, temeldeki `UIView`'yi bir `UIViewRepresentable` sarmalayıcı veya `introspect` aracılığıyla alın.

#### Yerel sayfalar

Yerel sayfa yakalama varsayılan olarak etkindir (`captureNativeSheets: true`). Bu, işletim sistemi yakalamaya izin verdiğinde, ödeme yetkilendirme modelleri gibi uygulamaya ait yerel sayfaların ve iletişim kutularının hata ayıklama tekrarlarında görünmesine olanak tanır. Metin girişleri varsayılan olarak maskelendiğinde klavye/metin girişi sistemi sayfaları hariç tutulur. Metin girişi maskeleme yalnızca alanları güvenli hale getirecek şekilde ayarlandığında, klavyeler yalnızca en iyi çabayla yapılır ve iOS bunları korumalı veya uzak sistem yüzeyleri olarak oluşturabileceğinden güvenilir bir şekilde yakalanamaz. İşletim sistemi paylaşım sayfaları da yalnızca en iyi çabadır ve sistem bunları korumalı veya uzak yüzeyler olarak oluşturduğunda güvenilir bir şekilde yakalanamaz.

Görsel yeniden oynatmanın ana uygulama penceresiyle sınırlı kalmasını istiyorsanız yerel sayfa yakalamayı devre dışı bırakın:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Kullanıcı Onayı ve GDPR




> [!IMPORTANT]
> **Siz Veri Kontrolörüsünüz.** Rejourney sizin adınıza Veri İşleyicisi olarak hareket eder. Son kullanıcılarınızın oturum kaydı konusunda bilgilendirilmesini ve verilerini işlemek için geçerli bir yasal dayanağa (ör. rıza veya meşru menfaatler) sahip olmanızı sağlamak sizin sorumluluğunuzdadır.

#### Ne yapman gerekiyor?

1. **Oturum kaydını uygulamanızın gizlilik politikasında açıklayın.** Aşağıdaki gibi dilleri içerir:

   > * "Ürünü iyileştirmemize, kilitlenmeleri ve sorunları izlememize ve üründeki anlaşmazlıkları azaltmamıza yardımcı olmak amacıyla uygulama içi etkinliğinizin anonimleştirilmiş VE anonimleştirilmemiş oturum tekrarlarını kaydetmek için Rejourney kullanıyoruz. Oturum verileri ekran etkileşimlerini, cihaz bilgilerini ve yaklaşık konumu içerebilir. Metin girişleri ve hassas kullanıcı arayüzü öğeleri otomatik olarak maskelenir ve asla yakalanmaz."*

2. **Onayın arkasında kapı kaydı** (AEA kullanıcıları için önerilir):

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

3. **Devre dışı bırakmalara saygı gösterin.** Kullanıcı izni geri çekerse kaydı durdurun ve kimliğini temizleyin:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Yalnızca Gözlem Modu (Görsel Kayıt Yok)

Hataları, çökmeleri, ANRs'yi ve görsel tekrarları kaydeden **olmadan** ağ etkinliğini yakalamak için `observeOnly: true`'yi ayarlayın:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Etkinleştirildiğinde, tüm telemetri toplanır ancak ekran görüntüsü alınmaz; oturumlar Tekrarlar sayfanızda GÖRÜNMEZ ancak tam analiz, hata, ağ ve kilitlenme verileri yakalanmaya devam eder. Kullanıcılar ekran kaydını devre dışı bıraktığında ancak yine de hata görünürlüğü istediğinizde kullanışlıdır.

> **Not:** Bu, kayıtlı bir tercihe veya izin işaretine dayalı olarak kullanıcı başına koşullu olarak ayarlanabilir:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Ağ yakalama

Ağ isteği yakalama (varsayılan olarak `autoTrackNetwork: true`), özel bir `URLProtocol` aracılığıyla `URLSession` trafiğine müdahale eder. Ağ verilerinin toplanmasını istemiyorsanız bunu devre dışı bırakın:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Coğrafi konum

IP'den türetilen coğrafi konum (ülke, bölge, şehir) varsayılan olarak toplanır. Aramayı tamamen bastırmak için devre dışı bırakın:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Yapılandırma Referansı

Tüm seçenekler `configure`'de bir kez ayarlanır ve `start` çağrıldıktan sonra değiştirilemez.

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

| Seçenek | Tür | Varsayılan | Açıklama |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Şirket içinde barındırılan dağıtımlar için geçersiz kılma |
| `userId` | `String?` | `nil` | İsteğe bağlı başlangıç ​​dahili kullanıcı kimliği |
| `enabled` | `Bool` | `true` | Ana kapatma anahtarı — SDK'yi tamamen devre dışı bırakmak için `false` olarak ayarlandı |
| `observeOnly` | `Bool` | `false` | Yalnızca telemetri toplayın, görsel kayıt yok |
| `captureFPS` | `Int?` | `nil` | İsteğe bağlı yerel yakalama FPS geri dönüşü. Uzak Proje Ayarları mümkün olduğunda FPS kaydı önceliklidir |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG yakalama kalitesi (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Oturum verilerini yalnızca Wi-Fi'ye yükle |
| `captureScreen` | `Bool` | `true` | Görsel ekran yakalamayı etkinleştirme/devre dışı bırakma |
| `captureAnalytics` | `Bool` | `true` | Analitik olay toplamayı etkinleştirme/devre dışı bırakma |
| `captureCrashes` | `Bool` | `true` | Kilitlenme raporlamasını etkinleştirme/devre dışı bırakma |
| `captureANR` | `Bool` | `true` | ANR (Uygulama Yanıt Vermiyor) algılamayı etkinleştirme/devre dışı bırakma |
| `trackConsoleLogs` | `Bool` | `true` | Oturuma ilişkin konsol günlüklerini yakalayın |
| `collectGeoLocation` | `Bool` | `true` | IP'den türetilen coğrafi konumu toplayın |
| `autoTrackNetwork` | `Bool` | `true` | Ağ yakalamaya yönelik `URLSession` isteklerini engelleyin |
| `captureNativeSheets` | `Bool` | `true` | iOS yakalamaya izin verdiğinde, uygulamaya ait yerel sayfa/iletişim pencerelerini görsel yeniden oynatmaya dahil edin. İşletim sistemi paylaşım sayfaları ve klavyeler korunuyor olabilir veya uzak yüzeyler olabilir ve güvenilir bir şekilde yakalanamayabilir |
| `debug` | `Bool` | `false` | Ayrıntılı SDK günlüklerini konsola yazdırın |

## Kaydı Durdurma

Geçerli oturumu durdurun ve bekleyen verileri temizleyin:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

Geri çağırma değişkeni, eşzamansız olmayan bağlamlar için kullanılabilir:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## Oturum Kimliği

Kendi günlüklerinizle veya destek araçlarıyla ilişkilendirmek için mevcut oturum kimliğine istediğiniz zaman erişin:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
