<!-- AI_PROMPT_SECTION -->
**Cursor, Claude veya ChatGPT mi kullanıyorsunuz?** Entegrasyon istemini kopyalayın ve kurulum kodunu otomatik olarak oluşturmak için AI yardımcınıza yapıştırın.

<!-- /AI_PROMPT_SECTION -->

## Kurulum

Rejourney paketini npm veya yarn kullanarak projenize ekleyin.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney yerel kod gerektirir ve Expo Go ile uyumlu değildir. Geliştirme yapılarını kullanın:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3 Hat Kurulumu

Rejourney'yi uygulamanızın üst kısmında (örneğin, App.tsx veya index.js'de) başlatın ve başlatın.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

Sağlayıcı sarma gerektirmez. Kayıt hemen başlar.

## Uzaktan Kayıt Ayarları

Proje Ayarları, yeni bir uygulama derlemesi göndermeden React Native kayıt varsayılanlarını kontrol edebilir. Desteklenen SDK sürümleri, oturum başlangıcında uzaktan kayıt FPS ayarını okur; varsayılan değer 1 FPS'dir ve proje yöneticileri 1, 2 veya 3 FPS'yi seçebilir. Uzak yapılandırma kullanılamıyorsa SDK yerel/varsayılan yakalama davranışına geri döner.

## Ekran Takibi

Rejourney ekran değişikliklerini otomatik olarak takip eder, böylece tekrar oynatmalar sırasında kullanıcıların uygulamanızda nerede olduklarını görebilirsiniz. Gezinme kitaplığınızla eşleşen kurulumu seçin:

### Expo Router (Otomatik)

**Expo Router** kullanıyorsanız ekran izleme kutudan çıktığı gibi çalışır. Ek kod gerekmez.




> [!TIP]
> **Özel ekran adlarını mı kullanıyorsunuz?** Expo Router kullanıyorsanız ancak kendi ekran adlarınızı manuel olarak sağlamak istiyorsanız, aşağıdaki [Özel Ekran Adları](#custom-screen-names) bölümüne bakın.

---

### React Navigation

**React Navigation** (`@react-navigation/native`) kullanıyorsanız, `NavigationContainer` kökünüzde `useNavigationTracking` kancasını kullanın:

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

### Özel Ekran Adları

Ekran adlarını manuel olarak belirlemek istiyorsanız (örneğin, analiz tutarlılığı için veya yukarıdaki kitaplıkları kullanmıyorsanız), `trackScreen` yöntemini kullanın.

#### Expo Router kullanıcıları için:
Expo Router ile özel adlar kullanmak için öncelikle yapılandırmanızda otomatik izlemeyi devre dışı bırakmalısınız:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### Manuel izleme çağrısı:
Bir ekran değişikliği meydana geldiğinde `trackScreen`'yi arayın:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## Kullanıcı Kimliği

Kontrol panelinde belirli kullanıcıları filtrelemek ve aramak için oturumları dahili kullanıcı kimliklerinizle ilişkilendirin.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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

### Meta Veriler ve Etkinlikler Ne Zaman Kullanılmalı?

| Kullanım Örneği | **Meta veriler** | **Olaylar** |
|---|---|---|
| Kullanıcının abonelik planı |  `setMetadata('plan', 'pro')` | |
| Kullanıcı bir düğmeye tıkladı | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B testi çeşidi |  `setMetadata('ab_variant', 'v2')` | |
| Satın alma tamamlandı | |  `logEvent('purchase', { amount: 29 })` |
| Kullanıcının rolü |  `setMetadata('role', 'admin')` | |
| İlk katılım adımına ulaşıldı | |  `logEvent('onboarding_step', { step: 3 })` |

**Temel kural:** *Kullanıcının kim olduğunu* veya *hangi durumda olduğunu* açıklıyorsa meta verileri kullanın. *Olan bir şeyi* anlatıyorsa olayları kullanın.

## Gizlilik Kontrolleri

Metin girişleri ve kamera görünümleri varsayılan olarak otomatik olarak maskelenir. Proje yöneticileri, desteklenen SDK sürümleri için Proje Ayarları'nda varsayılan metin girişi maskeleme düzeyini değiştirebilir; eski SDK sürümleri bu uzaktan ayarı yok sayar ve mevcut maskeleme davranışlarını korur. Güvenli/şifre alanları, kamera görünümleri ve açık maskeler korunmaya devam eder.

Ek hassas kullanıcı arayüzünü manuel olarak gizlemek için bileşenleri `Mask` bileşenine sarın:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

Maskelenen içerik, tekrarlarda düz bir dikdörtgen olarak görünür ve hiçbir zaman kaynakta yakalanmaz.

### Kullanıcı Onayı ve GDPR




> [!IMPORTANT]
> **Siz Veri Kontrolörüsünüz.** Rejourney sizin adınıza Veri İşleyicisi olarak hareket eder. Son kullanıcılarınızın oturum kaydı konusunda bilgilendirilmesini ve verilerini işlemek için geçerli bir yasal dayanağa (ör. rıza veya meşru menfaatler) sahip olmanızı sağlamak sizin sorumluluğunuzdadır.

#### Ne yapman gerekiyor?

1. **Oturum kaydını uygulamanızın gizlilik politikasında açıklayın.** Aşağıdaki gibi dilleri içerir:

   > * "Ürünü iyileştirmemize, kilitlenmeleri ve sorunları izlememize ve üründeki anlaşmazlıkları azaltmamıza yardımcı olmak amacıyla uygulama içi etkinliğinizin anonimleştirilmiş VE anonimleştirilmemiş oturum tekrarlarını kaydetmek için Rejourney kullanıyoruz. Oturum verileri ekran etkileşimlerini, cihaz bilgilerini ve yaklaşık konumu içerebilir. Metin girişleri ve hassas kullanıcı arayüzü öğeleri otomatik olarak maskelenir ve asla yakalanmaz."*

2. **Onayın arkasında kapı kaydı** (AEA kullanıcıları için önerilir):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **Devre dışı bırakmalara saygı gösterin.** Kullanıcı izni geri çekerse kaydı durdurun ve verilerini temizleyin:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### Konsol günlüğü yakalama

Konsol günlüğü yakalama varsayılan olarak etkindir (`trackConsoleLogs: true`). Konsol günlükleri, uygulamanızın günlük kaydı uygulamalarına bağlı olarak PII içerebilir. Günlüklerde hassas veriler görünebilirse bunu devre dışı bırakın:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### Coğrafi konum

IP'den türetilen coğrafi konum (ülke, bölge, şehir) varsayılan olarak toplanır. `collectGeoLocation`, `false` olduğunda, SDK, yerel katmana arka uçta IP coğrafi konum aramasını bastıran bir işaret iletir; bu oturum için hiçbir konum verisi saklanmaz. Konum verilerine ihtiyacınız yoksa veya AEA kullanıcıları için veri toplanmasını en aza indirmek istiyorsanız bunu devre dışı bırakın:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### Yerel sayfalar

Desteklenen SDK sürümleri için yerel sayfa yakalama varsayılan olarak etkindir (`captureNativeSheets: true`). Bu, işletim sistemi yakalamaya izin verdiğinde, ödeme yetkilendirme modelleri gibi uygulamaya ait yerel sayfaların ve iletişim kutularının hata ayıklama tekrarlarında görünmesine olanak tanır. Metin girişleri varsayılan olarak maskelendiğinde klavye/metin girişi sistemi sayfaları hariç tutulur. Metin girişi maskeleme yalnızca alanları güvenli hale getirecek şekilde ayarlandığında, klavyeler yalnızca en iyi çabadır ve özellikle işletim sistemi bunları korumalı veya uzak yüzeyler olarak oluşturduğunda güvenilir bir şekilde yakalanamaz. İşletim sistemi paylaşım sayfaları da yalnızca en iyi çabadır ve sistem bunları korumalı veya uzak yüzeyler olarak oluşturduğunda güvenilir bir şekilde yakalanamaz.

Görsel yeniden oynatmanın ana uygulama penceresiyle sınırlı kalmasını istiyorsanız yerel sayfa yakalamayı devre dışı bırakın:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### Yalnızca Gözlem Modu (Görsel Kayıt Yok)

Hataları, çökmeleri, ANRs'yi ve görsel tekrarları kaydeden **olmadan** ağ etkinliğini yakalamak için `observeOnly: true`'yi ayarlayın:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

Etkinleştirildiğinde, tüm telemetri toplanır ancak ekran görüntüsü alınmaz; oturumlar Tekrarlar Sayfanızda GÖRÜNMEYECEK ancak tam analiz/hata/ağ/kilitlenme verileri olacaktır. Tekrar yok. Bu, kullanıcılar ekran kaydını devre dışı bıraktığında ancak yine de hata görünürlüğü istediğinizde kullanışlıdır.

> **Not:** Bu, kullanıcı başına koşullu olarak, örneğin kayıtlı bir tercihe veya izin işaretine göre ayarlanabilir:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
