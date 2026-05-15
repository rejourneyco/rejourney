# CI/CD ve Otomatik Test

Rejourney, tüm monorepo genelinde kod kalitesini sağlamak için GitHub Actions'yi kullanır. Her çekme isteği ve ana şubeye yapılan gönderim, kapsamlı bir dizi testi tetikler.

## Test Paketleri

### 1. Arka Uç API Testleri
`backend/` dizininde yer alan bu testler, temel mantık ve veritabanı etkileşimlerinin kararlı olmasını sağlar.
* **Linting**: Kod stilini uygulamak ve yaygın hataları yakalamak için ESLint'i kullanır.
* **Birim Testleri**: Vitest tarafından desteklenmektedir; hizmet mantığını, yardımcı program işlevlerini ve API denetleyicilerini test eder.
* **Doğrulama Oluştur**: TypeScript kaynağının son dağıtımda doğru şekilde derlenmesini sağlar.

### 2. React Native SDK Testleri
`packages/react-native/`'de bulunan bu testler, platformlar arası kararlılık açısından kritik öneme sahiptir.
* **TypeScript Kontrol Et**: SDK'nin tamamındaki türleri doğrulayarak potansiyel köprü uyumsuzluklarını yakalar.
* **Linting**: Tutarlı kod kalitesini zorunlu kılar.
* **Doğrulama Oluştur**: Paketin dağıtım için paketlenebilmesini sağlamak için hazırlama komut dosyasını çalıştırır.

### 3. Web Kontrol Paneli Testleri
`dashboard/web-ui/`'de bulunur ve kullanıcı arayüzüne ve SSR'ye odaklanır.
* **TypeScript Kontrol Et**: Rota güvenliğini sağlamak için React Router tipi oluşturmayı içerir.
* **SSR Yapısı**: Tüm Remix/React Router uygulamasının sunucu tarafı işleme için oluşturulabileceğini doğrular.

---

## Yerel Entegrasyon Testi
CI/CD ürünümüzün en sağlam parçalarından biri, SDK'nin gerçek platform ortamlarında doğrulanmasıdır.

### iOS Entegrasyon (macos-en son)
* **Yeni Kurulum**: CI, sıfırdan yepyeni bir React Native projesi oluşturur.
* **Paket Enjeksiyonu**: `npm pack` kullanarak yerel SDK'yi paketler ve test uygulamasına yükler.
* **CocoaPods Doğrulaması**: Yerel bağımlılıkların ve bölme özelliklerinin doğru şekilde bağlanmasını sağlamak için `pod install`'yi çalıştırır.
* **Doğrulama Oluştur**: Test uygulamasının entegre SDK ile başarılı bir şekilde derlenmesini sağlamak için `xcodebuild`'yi çalıştırır.

### Android Entegrasyonu (ubuntu-en son)
* **Yeni Kurulum**: iOS'ye benzer şekilde, yeni bir Android tabanlı React Native projesi başlatılır.
* **Doğrulama Oluştur**: `./gradlew assembleDebug` yerel kodunda hiçbir bildirim çakışması veya derleme hatası olmadığından emin olmak için `./gradlew assembleDebug`'yi çalıştırır.

---

## Dağıtım ve Yayınlama Mantığı

### Otomatik Bulut Dağıtımı (VPS)
Üretim ortamımıza dağıtım, versiyonlama ile kontrol edilir.
* **Sürüm Kontrolü**: Tahsis edilmiş bir iş, kök `package.json` sürümünü önceki işlemeyle karşılaştırır.
* **Koşullu Tetikleyici**: Dağıtım yalnızca sürüm artırıldığında devam eder.
* **Otomatik Kullanıma Alma**: Tetiklenirse en son K8 bildirimlerini uygular ve tüm dağıtımların (api, web ve çalışanlar) sürekli olarak yeniden başlatılmasını gerçekleştirir.

### Otomatik SDK Yayınlama (NPM)
`rejourney` paketi için kusursuz bir yayınlama akışını sürdürüyoruz.
* **Yola Duyarlı**: Yalnızca `packages/react-native/` içindeki dosyalar değiştirildiğinde tetiklenir.
* **Kayıt Kontrolü**: Yerel paket sürümünü NPM kayıt defterindeki en son sürümle karşılaştırır.
* **Otomatik Yayınla**: Yerel sürüm daha yüksekse, tüm testler geçtikten sonra yeni sürümü otomatik olarak NPM'ye yayınlar.
