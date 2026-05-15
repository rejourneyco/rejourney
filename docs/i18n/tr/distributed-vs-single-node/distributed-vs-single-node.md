# Dağıtılmış ve Tek Düğümlü Bulut Karşılaştırması

Rejourney, şirket içinde barındırılan iki resmi dağıtım şeklini destekler:

- Bir sunucu için **Tek düğümlü Docker Compose** veya VPS
- Üretim kümeleri ve yatay ölçeklendirme için **Dağıtılmış K3s**

Her ikisi de artık aynı çekirdek arka uç modelini kullanıyor:

- depolama uç noktaları veritabanı desteklidir
- besleme yüklemeleri arka uca ait yükleme geçişinden geçer
- işçiler doğrulanmış eserleri işler
- tekrar görünürlüğü yapaylığa dayalıdır

---

## Özellik Karşılaştırması

| Özellik | Dağıtılmış Bulut | Tek Düğümlü Bulut |
|---------|--------------------|-------------------|
| Platformu | K3s | Docker Compose |
| Ölçek | Çok düğümlü | Tek düğümlü |
| Halka açık giriş noktaları | Traefik giriş | Traefik konteyner |
| Yükleme yolu | API + alma-yükleme hizmeti | API + alma yükleme hizmeti |
| Gerçeğin depolama kaynağı | `storage_endpoints` tablosu | `storage_endpoints` tablosu |
| Varsayılan nesne depolama | Harici S3 | Dahili MinIO |
| Harici S3 desteği | Evet | Evet |
| Gizli şifreleme | `STORAGE_ENCRYPTION_KEY` | `STORAGE_ENCRYPTION_KEY` |
| Akışı güncelle | k8s dağıtım + işler | `deploy.sh update` |

---

## Paylaşılan Depolama Modeli

Her iki dağıtım modelinde de çalışma zamanı depolama yapılandırması, bir env geri dönüşünden değil, Postgres'den gelir.

Bu şu anlama gelir:

- etkin nesne depolama uç noktası `storage_endpoints`'de depolanır
- gizli erişim anahtarları `key_ref` olarak şifrelenir
- çalışma zamanı veritabanı satırını okur
- önyükleme/kurulum komut dosyaları `.env` girişinin veritabanı satırına senkronize edilmesinden sorumludur

Bu, kendi kendine barındırılan Docker'yi prod'a ve local-k8s'ye eski geri dönüş modelinden çok daha yakın hale getirir.

---

## Tek Düğümlü Docker Compose Ne Zaman Seçilmeli?

Aşağıdaki durumlarda Docker Compose'yi seçin:

- bir VPS veya yalın donanım ana bilgisayarına dağıtım yapıyorsunuz
- en hızlı yükleme yolunu istiyorsunuz
- varsayılan olarak yerleşik MinIO istiyorsunuz
- çok düğümlü ölçeklendirmeye veya Kubernetes işlemlerine ihtiyacınız yoktur

Resmi giriş noktaları:

- `docker-compose.selfhosted.yml`
- `scripts/selfhosted/deploy.sh`
- `docs/selfhosted/README.md`

---

## Dağıtılmış K3s Ne Zaman Seçilmeli?

Aşağıdaki durumlarda K3s'yi seçin:

- birden fazla düğüme ihtiyacınız var
- Kubernetes-yerel operasyonlar ve gizli işlemeyi istiyorsunuz
- API, yükleme ve çalışan hizmetlerini bağımsız olarak ölçeklendirmek istiyorsanız
- sürekli dağıtımlar ve daha güçlü altyapı izolasyonu istiyorsunuz

K3s yolu, `k8s/` ve `scripts/k8s/` altında bulunur.

---

## Operasyonel Fark

Temel fark artık veri modeli değil. Operasyonel şeklidir:

- Compose: bir makine, bir Docker ağı, bir operatör komut dosyası
- K3s: çoklu bölmeler, ad alanları, küme girişi, Kubernetes işleri ve sırlar

---

## Pratik Rehberlik

Hızlı bir şekilde kendi kendine barındırmak istiyorsanız tek düğümlü Compose ile başlayın.

Aşağıdakilere ihtiyacınız olduğunda K3s'ye geçin:

- daha fazla verim
- yuvarlanan küme dağıtımları
- yatay ölçeklendirme
- daha dayanıklı altyapı ayrımı

---

## İç Mimarlık Dokümanları

En son şirket içi mühendislik görselleri ve daha derin operatör ayrıntıları için:

- `dev_docs/ingest-session-recording-lifecycle.md` (oturum yaşam döngüsü diyagramı)
- `dev_docs/storage-and-endpoints.md` (çoklu paket topoloji diyagramı)
- `dev_docs/allthingscloud.md` (k3s bulut kurulum şeması)

### Oturum Yaşam Döngüsü

![Oturum yaşam döngüsü mimarisi](./assets/session-lifecycle.svg)

### Çoklu Kova Topolojisi

![Çoklu paket depolama topolojisi](./assets/multi-bucket-topology.svg)

### K3s Bulut Kurulumu

![K3s dağıtılmış bulut mimarisi](./assets/k3s-cloud-setup.svg)
