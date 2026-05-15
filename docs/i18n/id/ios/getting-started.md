<!-- AI_PROMPT_SECTION -->
**Menggunakan Cursor, Claude, atau ChatGPT?** Salin perintah integrasi dan tempelkan ke asisten AI Anda untuk membuat kode pengaturan secara otomatis.

<!-- /AI_PROMPT_SECTION -->

## Instalasi

### Swift Package Manager

Tambahkan paket Rejourney di Xcode melalui **File → Tambahkan Ketergantungan Paket** dan masukkan:

```
https://github.com/rejourneyco/rejourney
```

Atau tambahkan langsung ke `Package.swift` Anda:

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
> Rejourney memerlukan iOS 15.1 atau lebih baru.

## Pengaturan Swift

Inisialisasi dan mulai Rejourney di struct Aplikasi `@main` Anda.

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

Jika Anda menggunakan `UIApplicationDelegate`, panggil `configure` di `application(_:didFinishLaunchingWithOptions:)`:

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

Perekaman dimulai segera setelah `start()` terselesaikan. Anda dapat memeriksa hasilnya jika diperlukan:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## Pengaturan Perekaman Jarak Jauh

Pengaturan Proyek dapat mengontrol default perekaman Swift tanpa mengirimkan build aplikasi baru. Versi SDK yang didukung membaca pengaturan ini ketika `start()` dipanggil:

| Pengaturan | Perilaku |
|---|---|
| Tingkat sampel | Defaultnya adalah `100%`. Sesi pengambilan sampel diambil secara normal. Sesi pengambilan sampel kembali sebelum pengambilan pemutaran ulang, intersepsi jaringan, pengunggahan, atau pekerjaan paket lainnya dimulai. |
| Durasi observasi maksimum | Membatasi durasi maksimum setiap sesi observasi. |
| Merekam FPS | Defaultnya adalah `1 FPS`. Admin proyek dapat memilih `1`, `2`, atau `3 FPS`. Jika konfigurasi jarak jauh tidak tersedia, SDK kembali ke perilaku pengambilan lokal/default. |
| Privasi masukan teks | Defaultnya adalah menutupi semua input teks. Mode hanya aman menjaga kata sandi/bidang aman tetap tertutup dan memungkinkan input teks lainnya muncul dalam pemutaran ulang debug. |

## Pelacakan Layar

Rejourney tidak terhubung ke navigasi SwiftUI secara otomatis, jadi panggil `trackScreen` setiap kali pengguna menavigasi ke layar baru.

### SwiftUI

Gunakan `.onAppear` atau pengubah yang sadar navigasi:

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

Hubungi `trackScreen` di dalam `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### Jalur Navigasi / Tumpukan Navigasi

Amati jalur navigasi dan lacak perubahan:

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

## Identifikasi Pengguna

Kaitkan sesi dengan ID pengguna Anda sendiri sehingga Anda dapat menemukan pengguna tertentu di dasbor.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **Pribadi:** Gunakan ID internal atau UUID. Jika Anda harus menggunakan PII (email, telepon), hash sebelum meneruskannya.

Identitas dipertahankan di seluruh peluncuran aplikasi melalui `UserDefaults` — Anda hanya perlu memanggil `identify` sekali setiap login, tidak pada setiap aplikasi yang dibuka.

## Acara Khusus

Lacak tindakan pengguna yang berarti untuk memahami perilaku, men-debug masalah, dan memfilter pemutaran ulang sesi di dasbor.

### Penggunaan Dasar

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

| Parameter | Ketik | Diperlukan | Deskripsi |
|---|---|---|---|
| `name` | `String` | Ya | Nama acara — gunakan `snake_case` untuk konsistensi |
| `properties` | `[String: RejourneyMetadataValue]` | Tidak | Pasangan kunci-nilai yang dilampirkan pada acara ini |

`RejourneyMetadataValue` menerima literal Swift secara langsung — tidak perlu pembungkusan:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### Contoh

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

### Bagaimana Acara Muncul di Dasbor

Peristiwa khusus disimpan per sesi dan terlihat di dua tempat:

1. **Garis Waktu Pemutaran Ulang Sesi** — Peristiwa muncul sebagai penanda pada garis waktu pemutaran ulang sehingga Anda dapat melompat ke momen yang tepat ketika suatu tindakan terjadi.
2. **Filter Arsip Sesi** — Filter daftar sesi berdasarkan:
   - **Nama acara** — Temukan semua sesi yang berisi peristiwa tertentu (mis. `purchase_completed`)
   - **Jumlah acara** — Temukan sesi dengan sejumlah peristiwa khusus tertentu

### Praktik Terbaik




> [!TIP]
> - Gunakan penamaan yang konsisten (`snake_case`, misalnya `button_tapped` bukan `Button Tapped`)
> - Jaga agar nilai properti tetap sederhana (string, angka, boolean) — hindari objek yang bertumpuk dalam
> - Fokus pada tindakan yang penting untuk proses debug atau analisis — jangan mencatat semuanya

## Kontrol Privasi

Input teks dan tampilan kamera secara otomatis ditutupi secara default. Admin proyek dapat mengubah tingkat penyembunyian input teks default di Pengaturan Proyek untuk versi SDK yang didukung. Bidang aman/kata sandi, tampilan kamera, dan topeng eksplisit tetap terlindungi.

Untuk menyembunyikan tampilan sensitif tambahan, gunakan API `mask` dan `unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

Untuk SwiftUI, dapatkan `UIView` yang mendasarinya melalui wrapper `UIViewRepresentable` atau `introspect`.

#### Lembaran asli

Pengambilan lembar asli diaktifkan secara default (`captureNativeSheets: true`). Hal ini memungkinkan sheet dan dialog asli milik aplikasi, seperti modal otorisasi pembayaran, muncul dalam pemutaran ulang debug ketika OS mengizinkan pengambilan. Lembar sistem keyboard/input teks dikecualikan ketika input teks disamarkan secara default. Ketika penyembunyian input teks diatur ke bidang aman saja, keyboard hanya merupakan upaya terbaik dan tidak dapat ditangkap dengan andal karena iOS dapat menjadikannya sebagai permukaan sistem yang dilindungi atau jarak jauh. Lembar berbagi OS juga hanya merupakan upaya terbaik dan tidak dapat ditangkap dengan andal ketika sistem menjadikannya sebagai permukaan yang terlindungi atau jauh.

Nonaktifkan pengambilan sheet asli jika Anda ingin pemutaran ulang visual tetap terbatas pada jendela aplikasi utama:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### Persetujuan Pengguna & GDPR




> [!IMPORTANT]
> **Anda adalah Pengontrol Data.** Rejourney bertindak sebagai Pemroses Data atas nama Anda. Anda bertanggung jawab untuk memastikan pengguna akhir Anda mendapat informasi tentang perekaman sesi dan bahwa Anda memiliki dasar hukum yang valid untuk memproses data mereka (misalnya persetujuan atau kepentingan yang sah).

#### Apa yang harus Anda lakukan

1. **Ungkapkan rekaman sesi dalam kebijakan privasi aplikasi Anda.** Sertakan bahasa seperti:

   > * "Kami menggunakan Rejourney untuk merekam tayangan ulang sesi anonim DAN non-anonim dari aktivitas dalam aplikasi Anda untuk membantu kami meningkatkan produk, melacak kerusakan dan masalah, serta mengurangi gesekan produk. Data sesi dapat mencakup interaksi layar, informasi perangkat, dan perkiraan lokasi. Input teks dan elemen UI sensitif secara otomatis ditutupi dan tidak pernah direkam."*

2. **Rekaman gerbang di belakang persetujuan** (direkomendasikan untuk pengguna EEA):

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

3. **Hormati pilihan untuk tidak ikut serta.** Jika pengguna membatalkan persetujuannya, berhenti merekam dan hapus identitasnya:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### Mode Hanya Amati (Tanpa Rekaman Visual)

Untuk menangkap kesalahan, kerusakan, ANRs, dan aktivitas jaringan **tanpa** merekam tayangan ulang visual, atur `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

Saat diaktifkan, semua telemetri dikumpulkan tetapi tidak ada tangkapan layar yang diambil — sesi TIDAK akan muncul di halaman Pemutaran Ulang Anda, namun analisis lengkap, kesalahan, jaringan, dan data kerusakan masih direkam. Berguna ketika pengguna memilih tidak ikut perekaman layar namun Anda masih menginginkan visibilitas kesalahan.

> **Catatan:** Ini dapat diatur secara kondisional per pengguna berdasarkan preferensi yang disimpan atau tanda izin:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### Penangkapan jaringan

Pengambilan permintaan jaringan (`autoTrackNetwork: true` secara default) memotong lalu lintas `URLSession` melalui `URLProtocol` khusus. Nonaktifkan jika Anda tidak ingin data jaringan dikumpulkan:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### Geolokasi

Geolokasi turunan IP (negara, wilayah, kota) dikumpulkan secara default. Nonaktifkan untuk menyembunyikan pencarian sepenuhnya:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## Referensi Konfigurasi

Semua opsi disetel satu kali di `configure` dan tidak dapat diubah setelah `start` dipanggil.

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

| Pilihan | Ketik | Bawaan | Deskripsi |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | Ganti penerapan yang dihosting sendiri |
| `userId` | `String?` | `nil` | ID pengguna internal awal opsional |
| `enabled` | `Bool` | `true` | Sakelar pemutus utama — disetel ke `false` untuk menonaktifkan SDK seluruhnya |
| `observeOnly` | `Bool` | `false` | Kumpulkan telemetri saja, tidak ada rekaman visual |
| `captureFPS` | `Int?` | `nil` | Penggantian FPS pengambilan lokal opsional. Perekaman FPS Pengaturan Proyek Jarak Jauh diutamakan bila tersedia |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | Kualitas pengambilan JPEG (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Hanya unggah data sesi di Wi-Fi |
| `captureScreen` | `Bool` | `true` | Mengaktifkan/menonaktifkan tangkapan layar visual |
| `captureAnalytics` | `Bool` | `true` | Aktifkan/nonaktifkan pengumpulan peristiwa analitik |
| `captureCrashes` | `Bool` | `true` | Aktifkan/nonaktifkan pelaporan kerusakan |
| `captureANR` | `Bool` | `true` | Aktifkan/nonaktifkan deteksi ANR (Aplikasi Tidak Merespons) |
| `trackConsoleLogs` | `Bool` | `true` | Ambil log konsol untuk sesi |
| `collectGeoLocation` | `Bool` | `true` | Kumpulkan geolokasi turunan IP |
| `autoTrackNetwork` | `Bool` | `true` | Cegat permintaan `URLSession` untuk penangkapan jaringan |
| `captureNativeSheets` | `Bool` | `true` | Sertakan jendela lembar/dialog asli milik aplikasi dalam pemutaran ulang visual ketika iOS mengizinkan pengambilan. Lembar berbagi OS dan keyboard mungkin dilindungi atau permukaannya jauh dan tidak dapat ditangkap dengan andal |
| `debug` | `Bool` | `false` | Cetak log SDK verbose ke konsol |

## Menghentikan Perekaman

Hentikan sesi saat ini dan hapus data yang tertunda:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

Varian callback tersedia untuk konteks non-asinkron:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## ID Sesi

Akses ID sesi saat ini kapan saja untuk dihubungkan dengan log Anda sendiri atau alat dukungan:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
