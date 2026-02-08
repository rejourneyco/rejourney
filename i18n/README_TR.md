<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney Logo" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="https://rejourney.co/images/session-replay-preview.png" alt="Rejourney Oturum Yeniden Oynatma" width="100%" />

  <p>
    <strong>React Native için hafif oturum yeniden oynatma ve gözlemlenebilirlik</strong>
    <br />
    Piksel mükemmelliğinde video yakalama ve gerçek zamanlı olay algılama ile mobil öncelikli odak.
  </p>
  
  <p>
    <a href="https://rejourney.co"><strong>Web Sitesini Keşfedin »</strong></a>
  </p>
  
  <p>
    <a href="https://reactnative.dev"><img src="https://img.shields.io/badge/React%20Native-61DAFB?logo=react&logoColor=black" alt="React Native" /></a>
    <a href="https://expo.dev"><img src="https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white" alt="Expo" /></a>
  </p>
</div>

## Özellikler

### Piksel Mükemmel Yakalama
İşlenen her pikseli yakalayan gerçek FPS video oynatma. Rakiplerin aksine, Mapbox (Metal), özel gölgelendiriciler ve GPU hızlandırmalı görünümler dahil her şeyi yakalıyoruz.

### Canlı Olay Akışı
![Sorun Akışı](https://rejourney.co/images/issues-feed.png)

Çökmeleri, hataları ve öfke tıklamalarını (rage taps) anlık çökme raporları ile gerçek zamanlı olarak gerçekleşirken görün.

### Hata/ANR/Çökme Algılama
![ANR Sorunları](https://rejourney.co/images/anr-issues.png)

Tam iş parçacığı dökümleri ve ana iş parçacığı analizi ile Uygulama Yanıt Vermiyor (ANR) olaylarının otomatik algılanması.

### Yolculuk Haritalama
![Kullanıcı Yolculukları](https://rejourney.co/images/user-journeys.png)

Kullanıcıların uygulamanızda nasıl gezindiğini görselleştirin. Yüksek sürtünmeli ayrılma noktalarını belirleyin ve dönüşüm hunilerini optimize edin.

### Etkileşim Isı Haritaları
![Isı Haritaları](https://rejourney.co/heatmaps-demo.png)

**Kullanıcı etkileşimini hassasiyetle görselleştirin.** Kullanıcı arayüzü yerleşimini optimize etmek için nereye dokunduklarını, kaydırdıklarını ve geçtiklerini görün.

### Küresel İstikrar
![Coğrafi Zeka](https://rejourney.co/images/geo-intelligence.png)

Performansı ve istikrarı farklı bölgelerde izleyin. Altyapı sorunlarını küresel hedef kitlenizi etkilemeden önce tespit edin.

### Büyüme Motorları
![Büyüme Motorları](https://rejourney.co/images/growth-engines.png)
Kullanıcı elde tutma ve sadakat segmentlerini takip edin. Sürümlerin yoğun kullanıcılarınızı ve hemen çıkma oranlarını nasıl etkilediğini anlayın.

### Ekip Uyarıları
![Ekip Uyarıları](https://rejourney.co/images/team-alerts.png)
Çökmeler, ANR'ler ve hata artışları için akıllı e-posta bildirimleri. Mühendislik ekipleri için rol tabanlı erişim.

## Dokümantasyon

Tam entegrasyon kılavuzları ve API referansı: https://rejourney.co/docs/reactnative/overview

### Kendi Sunucunda Barındırma

- Tek Docker dosyası ile barındırma: https://rejourney.co/docs/selfhosted
- Kurumsal düzeyde K3s barındırma (mimari belgeleri): https://rejourney.co/docs/architecture/distributed-vs-single-node

## Katkıda Bulunma

Rejourney'e katkıda bulunmak ister misiniz? Katkıda Bulunma Kılavuzumuza göz atın: https://rejourney.co/docs/community/contributing

## Karşılaştırmalı Testler (Benchmarks)

Rejourney, **gözle görülmeyecek kadar hafif** olacak şekilde tasarlanmıştır. %100 UI duyarlılığını korumak için etkileşimler (dokunma/kaydırma) sırasında SDK'nın otomatik olarak duraklamasını sağlayan, **Çalışma Döngüsü Kapılama (Run Loop Gating)** ile birleştirilmiş bir **Asenkron Yakalama İşlem Hattı** kullanıyoruz.

**Cihaz:** iPhone 15 Pro (iOS 18)  
**Ortam:** Expo SDK 54, React Native Yeni Mimarisi (Concurrent Mode)  
**Test Uygulaması:** [Merch App](https://merchcampus.com) (Mapbox Metal + Firebase ile üretim yapısı)  
**Test İş Yükü:** 46 karmaşık akış öğesi, Mapbox GL görünümü, 124 API çağrısı, 31 alt bileşen, aktif hareket takibi ve gerçek zamanlı gizlilik redaksiyonu.

| Metrik | Ort. (ms) | Maks. (ms) | Min. (ms) | İş Parçacığı |
| :--- | :---: | :---: | :---: | :---: |
| **Ana: UIKit + Metal Yakalama** | **12.4** | 28.2 | 8.1 | Ana |
| **Arka Plan: Asenkron Görüntü İşleme** | 42.5 | 88.0 | 32.4 | Arka Plan |
| **Arka Plan: Tar+Gzip Sıkıştırma** | 14.2 | 32.5 | 9.6 | Arka Plan |
| **Arka Plan: Yükleme El Sıkışması** | 0.8 | 2.4 | 0.3 | Arka Plan |
| **Toplam Ana İş Parçacığı Etkisi** | **12.4** | 28.2 | 8.1 | Ana |

*Not: Toplam Ana İş Parçacığı Etkisi, uygulamanızın oluşturulmasını (rendering) engelleyen tek işlemdir.*

## Mühendislik

Mühendislik kararları ve mimari: https://rejourney.co/engineering

## Lisans

İstemci tarafı bileşenleri (SDK'lar, CLI'lar) Apache 2.0 lisanslıdır. Sunucu tarafı bileşenleri (backend, dashboard) SSPL 1.0 lisanslıdır. Ayrıntılar için [LICENSE-APACHE](LICENSE-APACHE) ve [LICENSE-SSPL](LICENSE-SSPL) dosyalarına bakın.
