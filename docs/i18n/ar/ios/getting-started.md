<!-- AI_PROMPT_SECTION -->
**هل تستخدم Cursor أو Claude أو ChatGPT؟** انسخ مطالبة التكامل والصقه في مساعد AI الخاص بك لإنشاء رمز الإعداد تلقائيًا.

<!-- /AI_PROMPT_SECTION -->

## تثبيت

### Swift Package Manager

أضف الحزمة Rejourney في Xcode عبر **ملف → إضافة تبعيات الحزمة** وأدخل:

```
https://github.com/rejourneyco/rejourney
```

أو أضفه مباشرة إلى `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.3.0")
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
> يتطلب Rejourney الإصدار iOS 15.1 أو إصدار أحدث.

## إعداد Swift

قم بتهيئة وبدء تشغيل Rejourney في بنية تطبيق `@main`.

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

إذا كنت تستخدم `UIApplicationDelegate`، فاتصل بـ `configure` في `application(_:didFinishLaunchingWithOptions:)`:

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

يبدأ التسجيل بمجرد حل مشكلة `start()`. يمكنك التحقق من النتيجة إذا لزم الأمر:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## إعدادات التسجيل عن بعد

يمكن لإعدادات المشروع التحكم في الإعدادات الافتراضية لتسجيل Swift دون شحن إصدار تطبيق جديد. تقرأ إصدارات SDK المدعومة هذه الإعدادات عند استدعاء `start()`:

| الإعداد | السلوك |
|---|---|
| معدل العينة | الإعدادات الافتراضية هي `100%`. يتم التقاط الجلسات التي تم أخذ عينات منها بشكل طبيعي. تعود الجلسات التي تم أخذ عينات منها قبل إعادة التقاط العرض، أو اعتراض الشبكة، أو التحميلات، أو بدء أعمال الحزمة الأخرى. |
| أقصى مدة للملاحظة | يحد من الحد الأقصى لطول كل جلسة مراقبة. |
| تسجيل إطارا في الثانية | الإعدادات الافتراضية هي `1 FPS`. يمكن لمسؤولي المشروع اختيار `1` أو `2` أو `3 FPS`. إذا لم يكن التكوين عن بعد متاحًا، فسيعود SDK إلى سلوك الالتقاط المحلي/الافتراضي. |
| خصوصية إدخال النص | الإعدادات الافتراضية لإخفاء جميع مدخلات النص. يعمل الوضع الآمن فقط على إبقاء كلمة المرور/الحقول الآمنة مخفية ويسمح لمدخلات النص الأخرى بالظهور في عمليات إعادة تصحيح الأخطاء. |

## تتبع الشاشة

لا يتم ربط Rejourney بالتنقل في SwiftUI تلقائيًا، لذا اتصل بـ `trackScreen` كلما انتقل المستخدم إلى شاشة جديدة.

### SwiftUI

استخدم `.onAppear` أو معدّل التنقل:

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

اتصل بـ `trackScreen` داخل `viewDidAppear`:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### مسار التنقل / NavigationStack

راقب مسار التنقل وتتبع التغيير:

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

## تحديد هوية المستخدم

قم بربط الجلسات بمعرفات المستخدم الخاصة بك حتى تتمكن من العثور على مستخدمين محددين في لوحة المعلومات.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **خصوصية:** استخدم المعرفات الداخلية أو UUIDs. إذا كان يجب عليك استخدام PII (البريد الإلكتروني، الهاتف)، فقم بتجزئته قبل تمريره.

يتم الحفاظ على الهوية عبر عمليات تشغيل التطبيق عبر `UserDefaults` - ما عليك سوى الاتصال بـ `identify` مرة واحدة لكل تسجيل دخول، وليس في كل تطبيق مفتوح.

## الأحداث المخصصة

تتبع إجراءات المستخدم ذات المغزى لفهم السلوك ومشكلات تصحيح الأخطاء وإعادة تشغيل جلسة التصفية في لوحة المعلومات.

### الاستخدام الأساسي

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

| المعلمة | اكتب | مطلوب | الوصف |
|---|---|---|---|
| `name` | `String` | نعم | اسم الحدث - استخدم `snake_case` للتناسق |
| `properties` | `[String: RejourneyMetadataValue]` | لا | أزواج القيمة الرئيسية المرتبطة بهذا الحدث |

يقبل `RejourneyMetadataValue` أحرف Swift مباشرة - دون الحاجة إلى تغليف:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### أمثلة

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

### كيفية ظهور الأحداث في لوحة التحكم

يتم تخزين الأحداث المخصصة لكل جلسة وتكون مرئية في مكانين:

1. **الجدول الزمني لإعادة تشغيل الجلسة** — تظهر الأحداث كعلامات على المخطط الزمني لإعادة التشغيل حتى تتمكن من الانتقال إلى اللحظة المحددة التي حدث فيها الإجراء.
2. **مرشحات أرشيف الجلسة** — قم بتصفية قائمة الجلسات حسب:
   - **اسم الحدث** — البحث عن كافة الجلسات التي تحتوي على حدث معين (على سبيل المثال، `purchase_completed`)
   - **عدد الأحداث** — ابحث عن جلسات تحتوي على عدد محدد من الأحداث المخصصة

### أفضل الممارسات




> [!TIP]
> - استخدم تسمية متسقة (`snake_case`، على سبيل المثال `button_tapped` وليس `Button Tapped`)
> - حافظ على بساطة قيم الخاصية (السلاسل والأرقام والقيم المنطقية) - وتجنب الكائنات المتداخلة بعمق
> - ركز على الإجراءات المهمة لتصحيح الأخطاء أو التحليلات، ولا تقم بتسجيل كل شيء

## ضوابط الخصوصية

يتم إخفاء مدخلات النص وطرق عرض الكاميرا تلقائيًا بشكل افتراضي. يمكن لمسؤولي المشروع تغيير مستوى إخفاء إدخال النص الافتراضي في إعدادات المشروع لإصدارات SDK المدعومة. تظل الحقول الآمنة/كلمة المرور وطرق عرض الكاميرا والأقنعة الصريحة محمية.

لإخفاء طرق عرض حساسة إضافية، استخدم واجهات برمجة التطبيقات `mask` و`unmask`:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

بالنسبة إلى SwiftUI، احصل على `UIView` الأساسي عبر غلاف `UIViewRepresentable` أو `introspect`.

#### أوراق أصلية

يتم تمكين التقاط الورقة الأصلية بشكل افتراضي (`captureNativeSheets: true`). يسمح هذا للأوراق ومربعات الحوار الأصلية المملوكة للتطبيق، مثل نماذج تفويض الدفع، بالظهور في عمليات إعادة تصحيح الأخطاء عندما يسمح نظام التشغيل بالالتقاط. يتم استبعاد أوراق نظام لوحة المفاتيح/إدخال النص عندما تكون مدخلات النص مقنعة بشكل افتراضي. عند تعيين قناع إدخال النص على الحقول الآمنة فقط، فإن أفضل جهد للوحات المفاتيح فقط ولا يمكن التقاطها بشكل موثوق لأن iOS قد يجعلها بمثابة أسطح نظام محمية أو بعيدة. تعد أوراق مشاركة نظام التشغيل أيضًا أفضل جهد فقط ولا يمكن التقاطها بشكل موثوق عندما يعرضها النظام كأسطح محمية أو بعيدة.

قم بتعطيل التقاط الورقة الأصلية إذا كنت تريد أن تظل إعادة العرض المرئي مقتصرة على نافذة التطبيق الرئيسية:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### موافقة المستخدم وGDPR




> [!IMPORTANT]
> تعمل **أنت مراقب البيانات.** Rejourney كمعالج بيانات نيابة عنك. أنت مسؤول عن ضمان إبلاغ المستخدمين النهائيين بتسجيل الجلسة وأن لديك أساسًا قانونيًا صالحًا لمعالجة بياناتهم (مثل الموافقة أو المصالح المشروعة).

#### ما يجب عليك فعله

1. **قم بالكشف عن تسجيل الجلسة في سياسة خصوصية تطبيقك.** تتضمن لغة مثل:

   > * "نحن نستخدم Rejourney لتسجيل عمليات إعادة تشغيل الجلسة مجهولة المصدر وغير مجهولة المصدر لنشاطك داخل التطبيق لمساعدتنا في تحسين المنتج وتتبع الأعطال والمشكلات وتقليل احتكاك المنتج. قد تتضمن بيانات الجلسة تفاعلات الشاشة ومعلومات الجهاز والموقع التقريبي. ويتم إخفاء مدخلات النص وعناصر واجهة المستخدم الحساسة تلقائيًا ولا يتم التقاطها أبدًا."*

2. **تسجيل البوابة وراء الموافقة** (موصى به لمستخدمي المنطقة الاقتصادية الأوروبية):

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

3. **احترام الانسحابات.** إذا قام المستخدم بسحب موافقته، توقف عن التسجيل وقم بمسح هويته:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### وضع المراقبة فقط (لا يوجد تسجيل مرئي)

لالتقاط الأخطاء والأعطال وANRs ونشاط الشبكة **بدون** لتسجيل عمليات الإعادة المرئية، قم بتعيين `observeOnly: true`:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

عند التمكين، يتم جمع كل القياسات عن بعد ولكن لا يتم التقاط لقطات شاشة - لن تظهر الجلسات في صفحة الإعادة الخاصة بك ولكن لا يزال يتم التقاط التحليلات الكاملة والخطأ والشبكة وبيانات الأعطال. يكون هذا مفيدًا عندما يقوم المستخدمون بإلغاء الاشتراك في تسجيل الشاشة ولكنك لا تزال ترغب في رؤية الخطأ.

> **ملحوظة:** يمكن ضبط ذلك بشكل مشروط لكل مستخدم بناءً على التفضيلات المخزنة أو علامة الموافقة:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### التقاط الشبكة

التقاط طلب الشبكة (`autoTrackNetwork: true` بشكل افتراضي) يعترض حركة مرور `URLSession` عبر `URLProtocol` مخصص. قم بتعطيله إذا كنت لا تريد جمع بيانات الشبكة:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### تحديد الموقع الجغرافي

يتم جمع الموقع الجغرافي المشتق من IP (البلد، المنطقة، المدينة) بشكل افتراضي. قم بتعطيله لمنع البحث بالكامل:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## مرجع التكوين

يتم ضبط كافة الخيارات مرة واحدة في `configure` ولا يمكن تغييرها بعد استدعاء `start`.

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

| الخيار | اكتب | الافتراضي | الوصف |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | تجاوز عمليات النشر المستضافة ذاتيًا |
| `userId` | `String?` | `nil` | معرف المستخدم الداخلي الأولي الاختياري |
| `enabled` | `Bool` | `true` | مفتاح القتل الرئيسي - تم ضبطه على `false` لتعطيل SDK بالكامل |
| `observeOnly` | `Bool` | `false` | جمع القياس عن بعد فقط، لا يوجد تسجيل مرئي |
| `captureFPS` | `Int?` | `nil` | اختياري التقاط محلي FPS احتياطي. تسجيل إعدادات المشروع عن بعد FPS له الأسبقية عند توفره |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | جودة التقاط JPEG (`.low`، `.medium`، `.high`) |
| `wifiOnly` | `Bool` | `false` | قم بتحميل بيانات الجلسة فقط على شبكة Wi-Fi |
| `captureScreen` | `Bool` | `true` | تمكين/تعطيل التقاط الشاشة المرئية |
| `captureAnalytics` | `Bool` | `true` | تمكين/تعطيل مجموعة أحداث التحليلات |
| `captureCrashes` | `Bool` | `true` | تمكين/تعطيل الإبلاغ عن الأعطال |
| `captureANR` | `Bool` | `true` | تمكين/تعطيل اكتشاف ANR (التطبيق لا يستجيب) |
| `trackConsoleLogs` | `Bool` | `true` | التقاط سجلات وحدة التحكم للجلسة |
| `collectGeoLocation` | `Bool` | `true` | جمع تحديد الموقع الجغرافي المشتق من IP |
| `autoTrackNetwork` | `Bool` | `true` | اعتراض طلبات `URLSession` لالتقاط الشبكة |
| `captureNativeSheets` | `Bool` | `true` | قم بتضمين نوافذ الورقة/الحوار الأصلية المملوكة للتطبيق في إعادة التشغيل المرئي عندما يسمح iOS بالالتقاط. قد تكون أوراق مشاركة نظام التشغيل ولوحات المفاتيح محمية أو أسطح بعيدة ولا يمكن التقاطها بشكل موثوق |
| `debug` | `Bool` | `false` | طباعة سجلات SDK المطولة إلى وحدة التحكم |

## إيقاف التسجيل

إيقاف الجلسة الحالية وتدفق البيانات المعلقة:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

يتوفر متغير رد الاتصال للسياقات غير المتزامنة:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## معرف الجلسة

قم بالوصول إلى معرف الجلسة الحالية في أي وقت لربطه بسجلاتك الخاصة أو أدوات الدعم:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
