# Kendi kendini barındıran Rejourney

Bu kılavuz, resmi **Docker Compose** yığınını kullanarak Rejourney'yi kendi sunucusunda (genellikle tek bir VPS veya özel makine) çalıştıran **herhangi biri** içindir. Rejourney'nin dahili altyapısına veya Kubernetes'ye erişmeniz gerekmez.

Kurulumdan sonra şunları elde edersiniz:

- Etki alanınızda bir **web kontrol paneli** (Let’s Encrypt aracılığıyla HTTPS)
- Bir alt alan adında bir **API** (kontrol paneli ve mobil SDK için)
- Başka bir alt alan adında bir **alma (yükleme) geçişi** (oturum yüklemeleri doğrudan telefonlardan nesne depolama alanına değil, sunucunuz üzerinden yapılır)
- **PostgreSQL**, **Redis** ve **yerleşik MinIO** veya **kendi S3-compatible depolama alanınız**
- Oturumları, saklamayı ve uyarıları işleyen arka plan **işçiler** (Rejourney'nin bulut dağıtımındaki rollerle aynı)

Aşağıdaki tüm komutlar, klonlamadan sonra **depo kökü**'de (`docker-compose.selfhosted.yml`'yi içeren klasör) olduğunuzu varsayar.

---

## Önceden ihtiyacınız olan şey

### Sunucu

- **İşletim Sistemi:** Ubuntu 22.04+, Debian 12+ veya Docker'yi iyi çalıştıran başka bir Linux
- **Docker:** 24 ​​veya daha yenisi, **Docker Compose eklentisi** ile (`docker compose version` çalışmalıdır)
- **Kaynaklar (önerilen):** 4 vCPU, 8 GB RAM, 40 GB disk (çok sayıda kayıt tutarsanız daha fazla)
- **Ağ:** Bağlantı Noktaları **80** ve **443** internete açık (Let’s Encrypt HTTP mücadelesi ve HTTPS için gereklidir)

### Etki Alanı ve DNS

Kontrol ettiğiniz **bir temel alan adı**'ye ihtiyacınız var (örneğin `example.com`). Yükleyiciyi çalıştırmadan önce, bu ana bilgisayar adlarının **Tümü**'sini sunucunuzun genel IP'sine işaret eden DNS **A** (veya **AAAAA**) kayıtları oluşturun:

| Ana makine adı | Amaç |
|----------|---------|
| `example.com` | Kontrol Paneli |
| `www.example.com` | Kontrol paneline yönlendirir |
| `api.example.com` | API (ve kullanıldığı yerlerde WebSocket) |
| `ingest.example.com` | Yükleme geçişi (SDK, API yapılandırıldıktan sonra bunu otomatik olarak kullanır) |

`example.com`'yi gerçek alan adınızla değiştirin. Yayılma birkaç dakikadan saatlere kadar sürebilir; TLS sertifikaları, DNS doğru şekilde çözülene kadar verilmeyecektir.

### Let’s Encrypt

Kurulum sırasında sizden **e-posta adresi** istenecektir. Let’s Encrypt'den gelen sertifika sona erme bildirimleri için kullanılır.

### Makinenizdeki araçlar

- Depoyu klonlamak için `git`
- `openssl` (yükleme komut dosyası tarafından sırlar oluşturmak için kullanılır)
- Bir kabuk (bash iyidir)

---

## İlk kurulum

### 1. Depoyu klonlayın

```bash
git clone https://github.com/rejourneyco/rejourney.git
cd rejourney
```

Varsayılan dalda (veya proje kendi kendine barındırma için bir tane belgeliyorsa yayın etiketinde) kalın.

### 2. Yükleyiciyi çalıştırın

```bash
./scripts/selfhosted/deploy.sh install
```

Senaryo şunları yapacaktır:

1. **temel etki alanı** numaranızı isteyin (ör. `example.com` — `https://` değil, yol yok).
2. **Let’s Encrypt e-posta**'nizi isteyin.
3. **depolamak**'yi isteyin: yerleşik **MinIO** (önerilir) veya **harici S3-compatible** depolama (uç nokta, paket, bölge ve anahtarları gireceksiniz).
4. Oluşturulan şifreler ve sırlarla repo kökünde **`.env.selfhosted`** oluşturun. **İzinleri kısıtla** uygulanır (`chmod 600`).
5. **Çekmek**, konteyner görsellerini (API, web, çalışanlar, veritabanları, Traefik, vb.) yayınladı.
6. **İnşa etmek** **önyükleme / geçiş** görüntüsü **senin klonundan** (veritabanı kurulum komut dosyalarını içerir; kapsayıcı kayıt defterinden indirilmez).
7. Redis, Traefik ve (eğer seçilmişse) MinIO veritabanlarını başlatın.
8. Önyükleme çalıştırılmadan önce yapılandırılmış `DATABASE_URL`'yi kullanarak veritabanı bağlantısını doğrulayın.
9. Tek seferlik bir **önyükleme** kapsayıcısını çalıştırın: veritabanı şeması, isteğe bağlı ilk tohum ve veritabanında depolama yapılandırması.
10. API'yi başlatın, geçişi, kontrol panelini ve çalışanları yükleyin.

İlk kurulum birkaç dakika sürebilir (görüntü çekme ve önyükleme).

### 3. `.env.selfhosted`'yi koruyun

Bu dosya, dağıtımınız için **tüm sırlar**'yi içerir (veritabanı, Redis, JWT, depolama şifrelemesi, kullanılıyorsa MinIO kimlik bilgileri vb.). **Yedekle**'yi güvenli bir yere (şifre yöneticisi, şifreli yedekleme) aktarın. Kaybederseniz, depolanan kimlik bilgilerinin şifresini çözme veya aynı dağıtımı yeniden oluşturma yeteneğinizi kaybedebilirsiniz.

Bunu git'e taahhüt etmeyin (`.gitignore` tarafından göz ardı edilmelidir).

---

## Kurulumdan sonra

### URL'ler

Yükleyici URL'leri yazdırır. Genel olarak:

- **Kontrol paneli:** `https://<your-base-domain>`
- **API:** `https://api.<your-base-domain>`
- **İçme:** `https://ingest.<your-base-domain>`

`www.<your-base-domain>` kontrol paneline yönlendirir.

### Yığını doğrula

```bash
./scripts/selfhosted/deploy.sh status
```

Kapların çalıştığını görmelisiniz; `api` ve `ingest-upload`, kısa bir süre sonra **sağlıklı** haline gelmelidir.

### İlk giriş ve test kaydı

1. Kontrol panelini bir tarayıcıda açın.
2. Bir hesap ve proje oluşturun.
3. Uygulamanızın Rejourney SDK'sini **API URL'si**'nizle yapılandırın (aşağıdaki [SDK yapılandırmasına](#configuring-your-mobile-app) bakın).
4. Kısa bir oturum kaydedin ve Tekrar Oynatma'da göründüğünü onaylayın.

Oturumlar Tekrar Oynatma'da hiç görünmüyorsa, bkz. [Sorun Giderme](/docs/selfhosted/troubleshooting) (aktarmayı yükleyin ve çalışan günlüklerini alın).

---

## Günlük operasyonlar

Bunların hepsi repo kökünden çalıştırılır.

| Eylem | Komut |
|--------|---------|
| Hizmet durumu | `./scripts/selfhosted/deploy.sh status` |
| Tüm günlükleri takip edin | `./scripts/selfhosted/deploy.sh logs` |
| Bir hizmet için günlükler | `./scripts/selfhosted/deploy.sh logs api` (`api`'yi `web`, `ingest-upload`, `ingest-worker`, vb. ile değiştirin) |
| **Güncelleme** görüntüleri ve önyüklemeyi yeniden çalıştırma | `./scripts/selfhosted/deploy.sh update` |
| Verileri silerken her şeyi durdurun **olmadan** | `./scripts/selfhosted/deploy.sh stop` |
| **Sıfırla** kaplar ve hacimler (yıkıcı) | `./scripts/selfhosted/deploy.sh reset` |

**`update`** daha yeni görüntüler çeker (varsa), mevcut klonunuzdan önyükleme görüntüsünü yeniden oluşturur, yığını yeniden başlatır ve veritabanı şeması ve depolama ayarlarının `.env.selfhosted`'nizle aynı hizada kalması için önyükleme görüntüsünü yeniden çalıştırır. **Olumsuz**, Postgres'yi veya nesne depolama birimlerini siler.

Önyüklemeden önce hem `install` hem de `update`, yapılandırılmış kimlik bilgileriyle veritabanı bağlantısını doğrular. Kimlik bilgileri kalıcı Postgres verileriyle eşleşmezse dağıtım daha sonra önyüklemede başarısız olmak yerine kurtarma kılavuzuyla erken durdurulur.

**`stop`** yalnızca kapsayıcıları durdurur; Docker **birimler** (Postgres verileri, MinIO verileri vb.), siz bunları açıkça kaldırana kadar kalır.

**`reset`**, bir onay isteminden sonra şirket içinde barındırılan kapsayıcıları ve Docker birimlerini (`pgdata`, `redisdata`, `miniodata`, `traefik-certs`) kaldırır. Ayrıca, `.env.selfhosted` eksik olsa bile MinIO profil kaplarını da yıkar, böylece eski MinIO verileri bir sonraki kurulumu engellemez. Bunu yalnızca tamamen yeni bir kurulum istediğinizde kullanın.

---

## Depolama: MinIO ile harici S3 karşılaştırması

### Yerleşik MinIO (varsayılan)

- Tek bir sunucu için en kolayı: nesne depolama **Docker'nin içinde**'yi çalıştırır ve varsayılan olarak genel internete açık değildir.
- Oturum baytları **alma-yükleme** hizmeti tarafından yazılır; cihazların doğrudan MinIO'ye erişmesine gerek yoktur.
- Paket oluşturma yükleme sırasında gerçekleştirilir.

### Harici S3-compatible depolama

AWS S3, Cloudflare R2, Hetzner Object Storage, Wasabi veya herhangi bir S3-compatible API kullanın. Yükleme sırasında uç nokta URL'sini, paketi, bölgeyi ve erişim anahtarlarını sağlarsınız.

Uç nokta URL stillerine örnekler (sağlayıcınızın dokümanları yetkilidir):

- AWS: `https://s3.<region>.amazonaws.com`
- Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`
- Hetzner: `https://<location>.your-objectstorage.com`

İndirmeler için bir **ayrı genel URL** eklerseniz, `S3_PUBLIC_ENDPOINT`'yi `.env.selfhosted`'de ayarlayın ve `./scripts/selfhosted/deploy.sh update`'yi çalıştırın.

---

## Önemli yapılandırma (`.env.selfhosted`)

Yükleyici bu dosyayı oluşturur. Tipik değişkenler şunları içerir:

- **Etki alanları ve genel URL'ler:** `BASE_DOMAIN`, `DASHBOARD_DOMAIN`, `API_DOMAIN`, `INGEST_DOMAIN`, `PUBLIC_*_URL`
- **Veritabanı:** `DATABASE_URL` (Compose içindeki `postgres` hizmetini işaret eder)
- **Redis:** `REDIS_URL`
- **Depolamak:** `STORAGE_BACKEND`, `S3_*` ve isteğe bağlı olarak `MINIO_*`
- **Güvenlik:** `JWT_SECRET`, `JWT_SIGNING_KEY`, `INGEST_HMAC_SECRET`, `STORAGE_ENCRYPTION_KEY`

İsteğe bağlı entegrasyonlar (kullanılmıyorsa boş bırakın): Stripe, SMTP, GitHub OAuth, Turnstile, vb.

**Depolama veya etki alanıyla ilgili değerleri değiştirme:** `.env.selfhosted`'yi düzenleyin ve ardından şunu çalıştırın:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## Veritabanı kurulumu nasıl çalışır (ilk önyükleme ve sonraki güncellemeler)

Normalde **Olumsuz**'nin SQL'i elle çalıştırması gerekir. **önyükleme** konteyneri bunu hallediyor.

- **Yepyeni boş veritabanı:** yığını, koddaki geçerli şemayı uygular ve ardından hangi geçiş sürümlerinin halihazırda karşılandığını kaydeder, böylece gelecekteki güncellemeler yalnızca **yeni** geçişlerini uygular.
- **Mevcut veritabanı (zaten başlatılmış):** yalnızca **askıda olması** geçişleri uygulanır. Verileriniz her `update`'de sıfırdan yeniden oluşturulmaz.
- **zaten tablolar var** veritabanı ancak geçiş geçmişi tablosu **eksik veya boş** ise (örneğin kısmi geri yükleme), kazara hasarı önlemek için **bir hatayla duruyor**'yi önyükleyin. Gelişmiş kurtarma seçenekleri [Sorun Giderme](/docs/selfhosted/troubleshooting) bölümünde belgelenmiştir.

---

## Apple Silicon ve ARM sunucuları

**ARM64** makinelerde (birçok Mac, bazı bulut örnekleri), dağıtım komut dosyası, kendiniz ayarlamadığınızda görüntü çekme işlemleri için `DOCKER_DEFAULT_PLATFORM=linux/amd64`'yi ayarlar; dolayısıyla yalnızca `amd64` yayınlayan önceden oluşturulmuş görüntüler çalışmaya devam eder. Farklı bir davranışa ihtiyacınız varsa betiği çalıştırmadan önce ortamınızda `DOCKER_DEFAULT_PLATFORM`'yi ayarlayın.

**önyükleme** görüntüsü her zaman klonlanmış depodaki **makinenizde yerleşik**'dir, dolayısıyla ödeme işleminizle her zaman eşleşir.

---

## Docker'de neler çalışır (genel bakış)

- **Traefik:** HTTPS sertifikaları ve kontrol paneline yönlendirme, API ve ana bilgisayar adlarını alma.
- **Postgres / Redis:** Uygulama verileri ve kuyrukları.
- **MinIO:** İsteğe bağlı dahili nesne depolama.
- **API:** Ana HTTP API.
- **alma-yükleme:** Aktarma trafiğini yüklemeye yönelik özel hizmet.
- **ağ:** Kontrol Paneli statik kullanıcı arayüzü.
- **İşçiler:** İşlem alma kuyrukları, yeniden yürütme yapıları, oturum yaşam döngüsü, zamanlanmış saklama tarzı çalışma ve uyarılar.

Bu yığında **HAYIR** ayrı faturalandırma toplu işçisi var; Faturalandırma entegrasyonu, anahtarları yapılandırdığınızda Stripe ve API tarafından yönlendirilir.

---

## Mobil uygulamanızı yapılandırma

SDK'yi **senin** API ana bilgisayarına doğrultun (`API_DOMAIN` / `PUBLIC_API_URL` ile eşleşmelidir).

### React Native örneği

```ts
import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('pk_live_your_public_key', {
  apiUrl: 'https://api.example.com',
});

startRejourney();
```

Gerçek API URL'nizi kullanın. Sunucu doğru şekilde yapılandırıldığında `ingest.<your-domain>` için yükleme URL'leri otomatik olarak türetilir.

---

## Yedeklemeler

En azından **PostgreSQL**, **`.env.selfhosted`** ve (yerleşik MinIO kullanıyorsanız) **nesne depolama verileri**'yi yedekleyin.

```bash
./scripts/selfhosted/backup.sh
./scripts/selfhosted/backup.sh --full
```

Ayrıntılar: [Yedekleme ve Kurtarma](/docs/selfhosted/backup-recovery).

---

## Sorun giderme ve destek

- [Sorun giderme](/docs/selfhosted/troubleshooting) — önyükleme hataları, TLS, boş Tekrar Oynatma, harici S3 sorunları.
- [Yedekleme ve Kurtarma](/docs/selfhosted/backup-recovery) — sırayı geri yükleyin ve MinIO.

Bu belgelerdeki hatalar veya iyileştirmeler için projenin GitHub adresindeki genel sorun izleyicisini kullanın.

---

## İlgili belgeler

- [Dağıtılmış ve tek düğümlü bulut karşılaştırması](/docs/distributed-vs-single-node/distributed-vs-single-node) — bunun çok hizmetli bulut düzeniyle karşılaştırılması (kavramsal).
