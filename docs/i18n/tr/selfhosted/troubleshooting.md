# Kendi kendine barındırılan sorun giderme

[Kendi kendine barındırılan Rejourney](/docs/selfhosted) yöntemini izlediyseniz ve bir şey başarısız olursa veya tuhaf davranıyorsa bu sayfayı kullanın. Komutlar **depo kökü**'den (`docker-compose.selfhosted.yml`'nin yaşadığı yer) çalıştırılır.

---

## Hızlı Kontroller

### Hizmet durumu

```bash
./scripts/selfhosted/deploy.sh status
```

### API günlükleri

```bash
./scripts/selfhosted/deploy.sh logs api
```

### Geçiş günlüklerini yükle

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### Çalışan günlükleri

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. Yükleme veya güncelleme önyüklemeden önce veya önyükleme sırasında başarısız oluyor

### Belirtiler

- `bootstrap` sıfırdan farklı bir durumdan çıkıyor
- uygulama hizmetleri asla sağlıklı olmaz
- `status`, API'yi veya önyüklemeyi bekleyen çalışanları gösterir
- `Database authentication failed before bootstrap.` ile kurulum veya güncelleme çıkışları

### Çekler

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

Yaygın nedenler:

- kötü `DATABASE_URL`
- kimlik bilgileri uyuşmazlığı (örneğin daha önceki başarısız bir dağıtımdan)
- eksik `STORAGE_ENCRYPTION_KEY`
- geçersiz S3 kimlik bilgileri
- bozuk harici S3 uç nokta URL'si
- **ARM64** üzerinde, eksik görüntü desteği (`DOCKER_DEFAULT_PLATFORM=linux/amd64`'yi ayarlayın veya ayarlanmadığında bunu ayarlayan `./scripts/selfhosted/deploy.sh`'yi kullanın)

İyileşmek:

1. Hala orijinal `.env.selfhosted`'ye sahipseniz, onu geri yükleyin ve çalıştırın:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Eski verilere ihtiyacınız yoksa silin ve yeniden yükleyin:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**Şema/geçiş mesajları:** Normal bir kurulumda veritabanı boş başlar ve önyükleme her şeyi ayarlar. **Postgres bir yedekten geri yüklendi**'yi yeni bir sunucuya aktarırsanız ancak geçiş meta verileri eksikse veya yığını **yanlış veritabanı**'ye yönlendirdiyseniz, önyükleme verilerinizin üzerine yazmak yerine tutarsız bir veritabanı hatası vererek çıkabilir. Gelişmiş kurtarma yapmıyorsanız `DATABASE_URL`'yi düzeltin ve tutarlı bir yedeklemeyi geri yükleyin veya temiz bir birimden başlayın. Yalnızca geçiş amaçlı kasıtlı kurtarma için, bazı kurulumlar `.env.selfhosted`'de `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` kullanır (bunu kullanmadan önce bakımcı belgelerine veya desteğine bakın).

### Düzeltmek

1. Orijinal `.env.selfhosted`'ye sahipseniz onu geri yükleyin ve yeniden çalıştırın:

```bash
./scripts/selfhosted/deploy.sh update
```

2. Orijinal `.env.selfhosted`'niz yoksa silin ve yeniden yükleyin:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` şema, çekirdek ve depolama uç noktası senkronizasyonunu yeniden çalıştırır. `reset`, şirket içinde barındırılan kapsayıcıları ve veri birimlerini kaldırarak yeni bir kurulumun yeni kimlik bilgilerini güvenli bir şekilde oluşturabilmesini sağlar.

---

## 2. Oturumlar sayılır ancak Tekrar oynatma alanı boş kalır

### Bu genellikle şu anda ne anlama geliyor?

Mevcut mimaride bu genellikle iki şeyden biridir:

- `ingest-upload` yapı baytlarını depolayamadı
- `ingest-worker`, yüklenen bir yapıyı işleyemedi

Cihaz artık doğrudan MinIO/S3'ye yükleme yapmıyor, bu nedenle pakete telefondan erişilebilirlik artık ana şüpheli değil.

### Çekler

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

Aramak:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### Yaygın nedenler

- `.env.selfhosted`'de yanlış S3 kimlik bilgileri
- harici S3 paketi eksik
- Docker ağından harici S3 uç noktasına erişilemiyor
- yükleme geçişi sağlıksız
- Çalışan, başarısız eserleri yeniden denemeye çalışırken takılıp kaldı

### Düzeltmek

- `S3_*` değerlerini doğrulayın
- depolama yapılandırmasını değiştirdiyseniz yeniden çalıştırın:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. Kontrol paneli yükleniyor ancak kimlik doğrulama veya API çağrıları başarısız oluyor

### Çekler

- kontrol paneli ana bilgisayarı DNS sunucuyu işaret ediyor
- API ana bilgisayarı DNS sunucuyu işaret ediyor
- alma ana bilgisayarı DNS sunucuyu işaret ediyor
- `80` ve `443` bağlantı noktaları açık
- Let’s Encrypt sertifikaları yayınladı

İncelemek:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS veya sertifika sorunları

Traefik, sertifikaları otomatik olarak yönetir.

### Çekler

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

Her iki adın da yığını çalıştıran sunucuya çözümlendiğinden emin olun.

İlk yükleme sırasında DNS hatalıysa DNS'yi düzeltin ve yeniden çalıştırın:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. Harici S3, CLI'de çalışıyor ancak Rejourney yüklenemiyor

Yükleme yolunun sunucu tarafında olduğunu unutmayın.

Önemli ağ yolu:

- `ingest-upload` kapsayıcısı -> S3 uç noktanız

Aktarma günlüklerini inceleyerek ve `.env.selfhosted`'deki uç nokta/paket/anahtarları onaylayarak sunucudan test yapın.

Bunları değiştirdiyseniz yeniden çalıştırın:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. Yerleşik MinIO kurulumu, ancak yapılar hala başarısız oluyor

### Çekler

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

`minio-setup` tek atış, `S3_BUCKET` tarafından adlandırılan paketi oluşturmalıdır.

İlk kurulumdan sonra paket adını değiştirdiyseniz şunu çalıştırın:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. Faturalandırma sayfalarında devre dışı bırakılmış faturalandırma gösteriliyor

Stripe anahtarları yapılandırılmadığı sürece bu beklenen bir durumdur.

Yığın, "kendi kendine barındırıldığı" için artık faturalandırmayı devre dışı bırakmıyor. Stripe yapılandırılmadığından faturalamayı devre dışı bırakır.

Stripe anahtarlarını ayarlamazsanız:

- faturalandırma kullanıcı arayüzü kendi kendine barındırılan/sınırsız durumda kalıyor
- Stripe ödeme ve web kancaları devre dışı kalıyor

---

## 8. `.env.selfhosted` değiştirildikten sonra Postgres'deki depolama uç noktası yanlış

Koşmak:

```bash
./scripts/selfhosted/deploy.sh update
```

Güncelleme yolu önyüklemeyi yeniden çalıştırır ve etkin `storage_endpoints` satırını yeniden senkronize eder.

---

## 9. Veri kaybı olmadan hizmetleri durdurmanız gerekiyor

Kullanmak:

```bash
./scripts/selfhosted/deploy.sh stop
```

Bu yalnızca kapsayıcıları durdurur. Birimleri kaldırmaz.

---

## 10. Bir hizmet için daha derin günlüklere ihtiyaç var

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
