# Rejourney'ye katkıda bulunmak

Katkılarınızı bekliyoruz! Başlamak için lütfen aşağıdaki kılavuzlara bakın.

## Proje Yapısı

Bu, npm çalışma alanları tarafından yönetilen bir monorepodur.

## Önkoşullar

1. **Node.js** >= 18.0.0
2. **npm** veya **yarn** (çalışma alanları her ikisiyle de çalışır)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode ve CocoaPods
7. **Android**: Android Studio ve JDK 17

## İlk Kurulum

### 1. Bağımlılıkları Kurun

Monorepo'nun **kök**'sinden:

```bash
npm install
```

Bu:
- Tüm çalışma alanı bağımlılıklarını yükleyin
- SDK paketini otomatik olarak oluşturun (`npm run build:sdk`'yi `package.json` kökündeki `postinstall` komut dosyası aracılığıyla çalıştırır)
- Tüm paketleri doğru şekilde bağlayın

### 2. SDK'yi oluşturun

Değişiklik yaptıktan sonra SDK'yi yeniden oluşturmanız gerekirse:

```bash
npm run build:sdk
```

Veya temiz bir yapı için:

```bash
npm run build:clean
```

## Arka Uç Geliştirme (Yerel Kubernetes)

Rejourney, yerel geliştirme için `local-k8s/`'yi kullanır, böylece çalışma zamanı günlük döngüyü hızlı tutarken Kubernetes üretim kurulumuna yakın kalır.

### 1. `.env.k8s.local`'yi yapılandırın

Yerel Kubernetes ortam şablonunu kopyalayın:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. Hibrit Geliştirici Yığınını Başlatın

```bash
npm run dev
```

Bu akış:

- Gerekirse yerel bir `k3d` kümesi oluşturur
- `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml` ve `minio.yaml` için geçerlidir
- `.env.k8s.local`'yi Kubernetes gizli dizileriyle senkronize eder
- API'yi, kontrol panelini ve çalışanları ana makinenizdeki kaynaktan çalıştırır

Tam küme içi eşlik çalışması için:

```bash
npm run dev:full
```

Yerel yığını durdurmak için:

```bash
npm run dev:down
```

### 3. IP Adresi Yapılandırması (Fiziksel Cihaz Testi)

Aynı WiFi'ye bağlı bir **fiziksel cihaz** (iOS veya Android) üzerinde test yapıyorsanız SDK ve Dashboard'un iletişim kurmak için bilgisayarınızın yerel IP adresini bilmesi gerekir.

#### IP Adresinizi bulma (Mac)

Terminalinizde aşağıdaki komutu çalıştırın:

```bash
ipconfig getifaddr en0
```

Veya **Sistem Ayarları > WiFi > [Ağınız] Ayrıntıları**'de bulun.

#### `.env.k8s.local`'yi güncelleyin

Aşağıdaki **MUTLAK** değişkenleri, `localhost` yerine yerel IP adresinizi (ör. `http://192.168.1.5:3000`) kullanır:

| Değişken | Anahtar Kullanımı |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | Video tekrarları için MinIO'ye genel erişim |
| `PUBLIC_DASHBOARD_URL` | Kontrol paneli kullanıcı arayüzü için temel URL |
| `PUBLIC_API_URL` | API için Temel URL |
| `PUBLIC_INGEST_URL` | SDK olay alımı için temel URL |
| `DASHBOARD_ORIGIN` | Kontrol paneli için CORS kaynağı |
| `OAUTH_REDIRECT_BASE` | OAuth geri aramaları için temel URL |




> [!IMPORTANT]
> Bunların doğru şekilde ayarlanmaması, fiziksel cihazlarda "Bağlantı Reddedildi" hatalarına veya kontrol panelinde bozuk resim/video bağlantılarına neden olur.

`npm run dev`, LAN'a yönelik bu değerleri `scripts/local-k8s/update-ips.sh` aracılığıyla otomatik olarak günceller ve ayrıca Expo uygulamaları tarafından kullanılan örnek uygulama env dosyalarını da yazar.

#### Örnek Yapılandırma (`.env.k8s.local`)

Bilgisayarınızın IP adresinin `192.168.1.100` olduğunu varsayarsak:

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

### 4. Yerel Kubernetes Dosyaları

Yerel Kubernetes bildirimleri, üretim `k8s/` düzenini kasıtlı olarak yansıtır:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## Örnek Uygulamaları Çalıştırma

### React Native Kazan Plakası (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

Veya örnek dizinden:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### Brew Kahve Laboratuvarları (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native Çıplak

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## Nasıl Çalışır?

### Çalışma Alanı Kurulumu

Monorepo, çekirdek paketler için npm çalışma alanlarını kullanır, ancak örnek uygulamalar bağımsızdır:

1. **Kök `package.json`**, çalışma alanlarında yalnızca `packages/*`, `backend` ve `dashboard/web-ui`'yi içerir
2. **Örnek uygulamalar bağımsızdır** - bağımlılık çatışmalarını önlemek için kendi `node_modules`'leri vardır
3. **Örnek uygulamalar**, `"rejourney": "file:../../packages/react-native"` kullanarak SDK'ye referans verir
4. **Metro yapılandırmaları**, SDK paketini doğru şekilde izleyecek ve çözümleyecek şekilde yapılandırılmıştır

**Örnekler neden çalışma alanlarında yok:**
- Örnek uygulamalar farklı Expo/React Native sürümlerini kullanıyor
- npm bağımlılık veri tekilleştirme çakışmalarını önler
- Her örneğin kendi tam bağımlılık ağacı olabilir

### Metro Yapılandırması

Her örnek uygulamanın bir `metro.config.js`'si vardır:

1. **Saatler** Değişiklikler için SDK kaynak dizini (`packages/react-native`)
2. **Çözer** `rejourney` paketini doğru konuma yerleştirin
3. **Bloklar**, `react-native` ve `react` paketlerini çalışma alanı kökünden kopyaladı

### Codegen (TurboModüller)

React Native'nin codegen'i aşağıdaki durumlarda uygulamayı oluştururken otomatik olarak çalışır:

1. SDK'nin `package.json`'si `codegenConfig` tanımlıdır ✅
2. Spesifikasyon dosyası (`NativeRejourney.ts`) adlandırma kuralını takip eder ✅
3. Uygulama SDK paketini içerir ✅

Codegen şu durumlarda otomatik olarak çalışır:
- `npm run ios` (iOS yapıları)
- `npm run android` (Android yapıları)

## Proje Yapısı

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

## CI/CD ve Dağıtım

Rejourney, tüm monorepo genelinde testi, oluşturmayı ve dağıtımı otomatikleştirmek için GitHub Actions'yi kullanır.

Test paketlerimizin, yerel entegrasyon testlerimizin ve otomatik dağıtım mantığımızın ayrıntılı bir dökümü için lütfen [CI/CD ve Test Belgeleri](/docs/architecture/ci-cd) belgesine bakın.

---

Bulut (K8s) ile Kendi Kendine Barındırılan (Docker) arasındaki ayrıntılar için [Mimari Karşılaştırmasını](/docs/architecture/distributed-vs-single-node) inceleyin.

## En İyi Uygulamalar

1. **Her zaman SDK'yi oluşturun** test etmeden önce: `npm run build:sdk`
2. npm çalışma alanları için package.json dosyasındaki **Dosya protokolünü kullan** (`file:../../packages/react-native`)
3. **Metro önbelleğini temizle** sorunlarla karşılaştığınızda: `npm start -- --reset-cache`
4. SDK yerel kod değişikliklerinden sonra **Yerel uygulamaları yeniden oluşturun**
5. Taahhüt etmeden önce **Hem iOS hem de Android üzerinde test yapın**
