<!-- AI_PROMPT_SECTION -->
**Cursor, Claude veya ChatGPT mi kullanıyorsunuz?** Entegrasyon istemini kopyalayın ve kurulum kodunu otomatik olarak oluşturmak için AI yardımcınıza yapıştırın.

<!-- /AI_PROMPT_SECTION -->

## Kurulum

Rejourney paketini npm veya yarn kullanarak projenize ekleyin.

```bash
npm install @rejourneyco/browser
```

## Temel Kurulum

Uygulamanızın giriş noktasında Rejourney'yi başlatın ve başlatın.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init`, projenizin uzak yapılandırmasını getirir ve SDK'yi hazırlar. `start` oturumu başlatır, ziyaretçiyi kaydeder ve (tekrar oynatma etkinse) rrweb kaydediciyi başlatır. Tamamlandığında herhangi bir şeyi kapatmanız gerekmiyorsa, her ikisi de zaman uyumsuzdur ve beklemeden çağrı yapmak güvenlidir.




> [!NOTE]
> `autoStart`, varsayılan olarak `false`'dir. `start()`'yi açık bir şekilde aramalısınız; bu, kayıt işlemini bir izin kontrolünün ardından gerçekleştirmenize olanak tanır. `init`'den sonra otomatik olarak başlamak için `{ autoStart: true }`'yi iletin.

### Çerçeve Entegrasyonları

Paket, popüler çerçeveler için özel giriş noktaları sunar. Yığınınıza uygun olanı kullanın veya herhangi bir çerçeveden yukarıdaki vanilya API'yi kullanın.

---

#### Tepki ver

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

`startOnMount`, `RejourneyProvider`'de varsayılan olarak `false`'ye ayarlanır. Bileşen monte edilir edilmez kayda başlamak için `startOnMount`'yi (veya `startOnMount={true}`) iletin.

---

#### Next.js

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

`RejourneyNext`, `null`'yi oluşturan bir `'use client'` bileşenidir. `startOnMount` varsayılan olarak `true` şeklindedir. Rota değişiklikleri Geçmiş API aracılığıyla otomatik olarak izlenir.

---

#### Vue

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

Rejourney örneği, `app.config.globalProperties.$rejourney` ve `inject('rejourney')` aracılığıyla edinilebilir. `useRejourney()` şekillendirilebilir de kolaylık sağlamak amacıyla ihraç edilmektedir.

---

#### Sonraki

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

`.client.ts` son eki, bu eklentinin yalnızca tarayıcıda çalışmasını sağlar. Rejourney örneği, `$rejourney` olarak enjekte edilir ve `useNuxtApp().$rejourney` aracılığıyla edinilebilir.

---

#### İnce / İnce Kit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount`, `Rejourney.stop()`'yi çağıran bir temizleme işlevi döndürür — Svelte'nin `onMount` dönüş değeri, otomatik olarak yok etme geri çağrısı olarak kullanılır.

---

#### Açısal

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

`createRejourneyAppInitializer`, Angular'ın önyükleme aşamasında Rejourney'yi başlatan ve başlatan bir fabrika döndürür. Ayrıca sınıf tabanlı bir API için `RejourneyService`'yi de enjekte edebilirsiniz.

---

#### Remiks

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

`startOnMount` varsayılan olarak `true` şeklindedir. Rota değişiklikleri otomatik olarak takip edilir.

---

#### Astro

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

SSR ortamlarında `startRejourneyForAstro` işlem yapılmaz — çalıştırmadan önce `window`'yi kontrol eder.

---

## Uzaktan Kayıt Ayarları

Proje Ayarları, kod dağıtımı olmadan web kaydı varsayılanlarını kontrol edebilir. SDK, her `start()` çağrısında uzak yapılandırmayı okur. Uzak yapılandırma, kaydı tamamen etkinleştirebilir veya devre dışı bırakabilir, izin verilen alanlar listesini ayarlayabilir ve maksimum oturum süresini ayarlayabilir. Uzak yapılandırma kullanılamıyorsa `start()` devam etmeyecektir; bunun amacı, bilinmeyen proje durumu altında kaydı önlemektir.

## Rota Takibi

Rejourney, sayfa ve rota değişikliklerini otomatik olarak takip eder, böylece tekrarlarda navigasyon bağlamını görebilirsiniz. Bu, varsayılan olarak etkindir (`autoTrackRoutes: true`) ve Geçmiş API çağrılarını (`pushState`, `replaceState`) yakalayarak ve `popstate` olaylarını dinleyerek çalışır.

### Özel Rota Adları

Varsayılan olarak geçerli `window.location.pathname` ekran adı olarak kullanılır. Kendi adlandırma mantığınızı sağlamak için bir `routeName` işlevini iletin:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### Manuel Ekran Takibi

Ekranları manuel olarak izlemek için (örneğin sekme değişiklikleri veya sayfa içi görünüm geçişleri için) doğrudan `trackScreen`'yi arayın:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

Otomatik rota izlemeyi devre dışı bırakmak ve yalnızca manuel aramalara güvenmek için:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## Kullanıcı Kimliği

Kontrol panelinde belirli kullanıcıları filtrelemek ve aramak için oturumları dahili kullanıcı kimliklerinizle ilişkilendirin.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **Mahremiyet:** Dahili kimlikleri veya UUID'leri kullanın. PII (e-posta, telefon) kullanmanız gerekiyorsa, göndermeden önce karma işlemi yapın.

## Özel Etkinlikler

Kontrol panelinde davranış kalıplarını anlamak, sorunları ayıklamak ve oturum tekrarlarını filtrelemek için anlamlı kullanıcı eylemlerini izleyin.

### Temel Kullanım

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

| Parametre | Tür | Gerekli | Açıklama |
|---|---|---|---|
| `name` | `string` | Evet | Etkinlik adı — tutarlılık için `snake_case` kullanın |
| `properties` | `object` | Hayır | Bu spesifik olay oluşumuna eklenen anahtar/değer çiftleri |

### Örnekler

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

### Etkinlikler Kontrol Panelinde Nasıl Görünür?

Özel etkinlikler oturum başına depolanır ve iki yerde görünür:

1. **Oturum Tekrarı Zaman Çizelgesi** — Olaylar tekrar zaman çizelgesinde işaretçiler olarak görünür, böylece bir eylemin gerçekleştiği ana atlayabilirsiniz.
2. **Oturum Arşivi Filtreleri** — Oturum listesini şuna göre filtreleyin:
   - **Etkinlik adı** — Belirli bir etkinliği içeren tüm oturumları bulun (ör. `purchase_completed`)
   - **Etkinlik özelliği** — Özellik anahtarına ve/veya değerine göre daha da daraltın (ör. `plan = pro`)
   - **Etkinlik sayısı** — Belirli sayıda özel etkinlik (ör. 5'ten fazla etkinlik) içeren oturumları bulun

### En İyi Uygulamalar




> [!TIP]
> - Tutarlı adlandırma kullanın (`snake_case`, örneğin `button_clicked`, `Button Clicked` değil)
> - Özellik değerlerini basit tutun (dizeler, sayılar, boolean'lar) — iç içe geçmiş nesnelerden kaçının
> - Hata ayıklama veya analiz için önemli olan eylemlere odaklanın; her şeyi günlüğe kaydetmeyin
> - Özellikler olay başına bağlam içindir. Oturum düzeyindeki özellikler için bunun yerine **Meta veriler** kullanın

---

## Meta veriler

Kullanıcıyı veya oturum bağlamını tanımlayan oturum düzeyindeki anahtar/değer çiftlerini ekleyin. Olayların aksine, meta veriler anahtar başına bir kez ayarlanır ve oturumun tamamına uygulanır.

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

Meta veri değerleri `string`, `number` veya `boolean` olmalıdır. Nesneler ve diziler kabul edilmez.

### Meta Veriler ve Etkinlikler Ne Zaman Kullanılmalı?

| Kullanım Örneği | **Meta veriler** | **Olaylar** |
|---|---|---|
| Kullanıcının abonelik planı | `setMetadata('plan', 'pro')` | |
| Kullanıcı bir düğmeye tıkladı | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B testi çeşidi | `setMetadata('ab_variant', 'v2')` | |
| Satın alma tamamlandı | | `logEvent('purchase', { amount: 29 })` |
| Kullanıcının rolü | `setMetadata('role', 'admin')` | |
| İlk katılım adımına ulaşıldı | | `logEvent('onboarding_step', { step: 3 })` |

**Temel kural:** *Kullanıcının kim olduğunu* veya *hangi durumda olduğunu* açıklıyorsa meta verileri kullanın. *Olan bir şeyi* anlatıyorsa olayları kullanın.

## Gizlilik Kontrolleri

Tüm metin girişleri varsayılan olarak maskelenir (`maskAllInputs: true`). Maskelenmiş alanlar tekrarlarda boş girişler olarak görünür ve değerler hiçbir zaman kaynakta yakalanmaz. Şifre, e-posta, telefon ve diğer hassas giriş türleri, bu ayardan bağımsız olarak her zaman maskelenir.

### Engelleme Öğeleri

Bir DOM öğesini tekrar oynatmalardan tamamen hariç tutmak için (sağlam bir yer tutucu olarak görünür), aşağıdakilerden birini ekleyin:

- CSS sınıfı: `rr-block`
- Veri özelliği: `data-rj-block` veya `data-rejourney-block`
- `blockSelector` yapılandırma seçeneği aracılığıyla özel CSS seçici

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### Maskeleme Metni

Bir öğenin metin içeriğini maskelemek için (metin değiştirilir ancak öğenin şekli görünür kalır), aşağıdakilerden birini ekleyin:

- CSS sınıfı: `rr-mask`
- Veri özelliği: `data-rj-mask`, `data-rejourney-mask`, `data-private` veya `"password"` içeren herhangi bir `data-testid`
- `maskTextSelector` yapılandırma seçeneği aracılığıyla özel CSS seçici

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### Öğeleri Yoksaymak

Bir öğenin şeklini yakalamak ancak üzerindeki tüm etkileşim olaylarını (tıklamalar, girişler) bastırmak için şunu ekleyin:

- CSS sınıfı: `rr-ignore`
- Veri özelliği: `data-rj-ignore` veya `data-rejourney-ignore`

### Özel Maskeleme İşlevleri

Programatik maskeleme mantığı için `maskInputFn` veya `maskTextFn` kullanın:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### Kullanıcı Onayı ve GDPR




> [!IMPORTANT]
> **Siz Veri Denetleyicisisiniz.** Rejourney sizin adınıza Veri İşleyicisi olarak hareket eder. Son kullanıcılarınızın oturum kaydı konusunda bilgilendirilmesini ve verilerini işlemek için geçerli bir yasal dayanağa (ör. rıza veya meşru menfaatler) sahip olmanızı sağlamak sizin sorumluluğunuzdadır.

#### Ne yapman gerekiyor?

1. **Oturum kaydını gizlilik politikanızda açıklayın.** Aşağıdaki gibi bir dil ekleyin:

   > * "Ürünü iyileştirmemize ve anlaşmazlıkları azaltmamıza yardımcı olmak amacıyla web sitemizdeki etkinliğinizin anonimleştirilmiş ve anonimleştirilmemiş oturum tekrarlarını kaydetmek için Rejourney kullanıyoruz. Oturum verileri sayfa etkileşimlerini, tarayıcı bilgilerini ve yaklaşık konumu içerebilir. Metin girişleri ve hassas öğeler otomatik olarak maskelenir ve asla yakalanmaz."*

2. **Onayın arkasında kapı kaydı** (AEA kullanıcıları için önerilir):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Devre dışı bırakmalara saygı gösterin.** Kullanıcı izni geri çekerse kaydı durdurun ve kimliğini temizleyin:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### `setConsent` aracılığıyla ayrıntılı izin

Daha hassas kontrol için analizler ve tekrar oynatma arasında bağımsız olarak geçiş yapmak üzere `setConsent`'yi kullanın:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

`analytics: false` ve `replay: false`'nin birlikte ayarlanması oturumu durdurur ve sıraya alınmış tüm verileri temizler. `replay: false`'nin tek başına ayarlanması rrweb kaydediciyi durdurur ancak olay izlemenin çalışmaya devam etmesini sağlar.

#### Konsol günlüğü yakalama

Konsol günlüğü yakalama varsayılan olarak devre dışıdır (`trackConsoleLogs: false`). Konsol günlükleri, günlük kaydı uygulamalarınıza bağlı olarak PII içerebileceğinden, yalnızca ihtiyacınız varsa etkinleştirin:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### Coğrafi konum

IP'den türetilen coğrafi konum (ülke, bölge, şehir) varsayılan olarak toplanır. `collectGeoLocation`, `false` olduğunda, SDK, arka uçta IP coğrafi konum aramasını bastıran bir işaret iletir; bu oturum için hiçbir konum verisi saklanmaz:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Yalnızca Gözlem Modu (Görsel Kayıt Yok)

Hataları, uzun görevleri, ağ etkinliğini ve görsel tekrarları kaydeden analitiği **olmadan** yakalamak için `observeOnly: true`'yi ayarlayın:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Etkinleştirildiğinde, tüm telemetri toplanır ancak rrweb kaydı çalıştırılmaz; oturumlar Tekrarlar sayfanızda görünmez ancak tam analiz, hata ve ağ verileri yakalanmaya devam eder. Kullanıcı görsel kaydı devre dışı bıraktığında ancak yine de gözlemlenebilirlik istediğinizde kullanışlıdır.

> **Not:** Bunu kullanıcı başına koşullu olarak, örneğin kayıtlı izin tercihine dayalı olarak ayarlayabilirsiniz:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### Bot Tespiti

Botlar ve otomatik tarayıcılar varsayılan olarak yok sayılır (`ignoreBots: true`). Oyun Yazarı, Puppeteer, Selenium ve diğer web sürücüsü tabanlı istemciler bastırılır. Otomasyon oturumlarını kaydetmek için (örneğin dahili araçlar için):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

Özel bir bot algılama modeli sağlamak için:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### Ağ İsteği Yakalama

Ağ istekleri (getirme ve XHR) varsayılan olarak durdurulur ve günlüğe kaydedilir (`autoTrackNetwork: true`). İstek ve yanıt gövdesi boyutları, varsayılan olarak yakalanan **Olumsuz**'dir (`networkCaptureSizes: false`). URL'ler, yöntemler, durum kodları ve süreler her zaman yakalanır.

Belirli URL'leri hariç tutmak için:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

İstekleri gönderilmeden önce filtrelemek veya düzenlemek için:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## Yapılandırma Referansı

| Seçenek | Tür | Varsayılan | Açıklama |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | `init()` tamamlandıktan sonra `start()`'yi otomatik olarak arayın |
| `disableInDev` | `boolean` | `false` | `localhost` ve `127.0.0.1`'de kaydı bastırın |
| `debug` | `boolean` | `false` | Tarayıcı konsolunda ayrıntılı SDK günlük kaydını etkinleştirin |
| `enabled` | `boolean` | `true` | Ana kapatma anahtarı — herhangi bir kaydı önlemek için `false` olarak ayarlanmıştır |
| `observeOnly` | `boolean` | `false` | Analizleri/hataları/ağı görsel tekrar olmadan yakalayın |
| `captureReplay` | `boolean` | `true` | Rrweb görsel tekrar yakalamayı etkinleştirin |
| `allowedDomains` | `string[]` | `[]` | Kaydı belirli alanlarla sınırlandırın. Boş, tüm alan adlarına izin verildiği anlamına gelir. `*.example.com` joker karakterlerini destekler |
| `maxSessionDuration` | `number` | `1800000` | Milisaniye cinsinden maksimum oturum uzunluğu (varsayılan: 30 dakika) |
| `collectGeoLocation` | `boolean` | `true` | IP'den türetilmiş ülke/bölge/şehir toplayın |
| `captureAttribution` | `boolean` | `true` | Oturum başlangıcında UTM parametrelerini, yönlendireni ve giriş URL'sini yakalayın |
| `ignoreBots` | `boolean` | `true` | Algılanan botlar ve web sürücüleri için kaydı bastırın |
| `recordAutomation` | `boolean` | `false` | Oyun Yazarı/Kuklacı/Selenium oturumlarının kaydedilmesine izin ver |
| `autoTrackRoutes` | `boolean` | `true` | Geçmiş API aracılığıyla rota değişikliklerini otomatik olarak izleyin |
| `routeName` | `(location: Location) => string` | — | Ekran adını `window.location`'den türetmeye yönelik özel işlev |
| `autoTrackNetwork` | `boolean` | `true` | Getirme/XHR isteklerini yakalayın ve günlüğe kaydedin |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | Ağ izlemenin dışında tutulacak URL'ler |
| `networkCaptureSizes` | `boolean` | `false` | Ağ günlüklerine istek/yanıt gövde boyutlarını dahil edin |
| `trackConsoleLogs` | `boolean` | `false` | `console.log/warn/error` çıktısını yakala |
| `trackLongTasks` | `boolean` | `true` | Uzun görevleri tespit edin ve günlüğe kaydedin (JS iş parçacığı blokları > 50 ms) |
| `trackResourceErrors` | `boolean` | `true` | Başarısız kaynak yüklemelerini yakalayın (resimler, komut dosyaları, stil sayfaları) |
| `maskAllInputs` | `boolean` | `true` | Tekrarlarda tüm metin girişi değerlerini maskele |
| `blockClass` | `string \| RegExp` | `'rr-block'` | Bir öğenin tekrar oynatılmasını tamamen engellemek için CSS sınıfı |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | Öğelerin tekrar oynatılmasını tamamen engellemek için CSS seçici |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | Bir öğedeki etkileşim olaylarını yok saymak için CSS sınıfı |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | Etkileşim olaylarını yok saymak için CSS seçici |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | Tekrar oynatmada metin içeriğini maskelemek için CSS sınıfı |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | Metin içeriğini maskelemek için CSS seçici |
| `maskInputFn` | `(value, element) => string` | — | Yakalamadan önce giriş değerlerini dönüştürmek için özel işlev |
| `maskTextFn` | `(text, element) => string` | — | Yakalamadan önce metin içeriğini dönüştürmek için özel işlev |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | Sayfa yükleme başına kayıt yapılıp yapılmayacağına karar veren özel işlev |
| `beforeSendEvent` | `(event) => event \| null` | — | Olayları kuyruğa alınmadan önce filtreleyin veya değiştirin. Bırakmak için `null`'yi döndür |
| `beforeSendNetwork` | `(request) => request \| null` | — | Ağ girişlerini kuyruğa alınmadan önce filtreleyin veya değiştirin. Bırakmak için `null`'yi döndür |
| `onAuthError` | `(error) => void` | — | SDK arka uçta kimlik doğrulaması yapamadığında çağrılır |

## Kaydı Durdurma

Oturumu sonlandırmak, bekleyen etkinlikleri temizlemek ve tüm SDK dinleyicilerini temizlemek için `stop()`'yi arayın:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()`'yi birden çok kez aramak güvenlidir. Durdurduktan sonra yeni bir oturum başlatmak için `start()`'yi tekrar arayın.

## Oturum Kimliği

Rejourney oturumlarını kendi günlükleriniz veya destek araçlarınızla ilişkilendirmek için mevcut oturum kimliğine erişin:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

Hiçbir oturum etkin değilse `null` değerini döndürür.

## Durum Yardımcıları

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
