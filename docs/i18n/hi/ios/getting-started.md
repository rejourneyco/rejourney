<!-- AI_PROMPT_SECTION -->
**Cursor, Claude, या ChatGPT का उपयोग कर रहे हैं?** एकीकरण प्रॉम्प्ट को कॉपी करें और सेटअप कोड को स्वचालित रूप से जेनरेट करने के लिए इसे अपने AI सहायक में पेस्ट करें।

<!-- /AI_PROMPT_SECTION -->

## इंस्टालेशन

### Swift Package Manager

Rejourney के माध्यम से Xcode में Rejourney पैकेज जोड़ें और दर्ज करें:

```
https://github.com/rejourneyco/rejourney
```

या इसे सीधे अपने `Package.swift` में जोड़ें:

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
> Rejourney को iOS 15.1 या बाद के संस्करण की आवश्यकता है।

## Swift सेटअप

आरंभ करें और अपने `@main` ऐप संरचना में Rejourney प्रारंभ करें।

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

यदि आप `UIApplicationDelegate` का उपयोग करते हैं, तो `application(_:didFinishLaunchingWithOptions:)` में `configure` पर कॉल करें:

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

`start()` का समाधान होते ही रिकॉर्डिंग शुरू हो जाती है। यदि आवश्यक हो तो आप परिणाम की जांच कर सकते हैं:

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## रिमोट रिकॉर्डिंग सेटिंग्स

प्रोजेक्ट सेटिंग्स नए ऐप बिल्ड को शिपिंग किए बिना Swift रिकॉर्डिंग डिफ़ॉल्ट को नियंत्रित कर सकती हैं। समर्थित SDK संस्करण इन सेटिंग्स को पढ़ते हैं जब `start()` को कॉल किया जाता है:

| सेटिंग | व्यवहार |
|---|---|
| नमूना दर | डिफ़ॉल्ट रूप से `100%`. सैंपल-इन सत्र सामान्य रूप से कैप्चर होते हैं। सैंपल-आउट सत्र रीप्ले कैप्चर, नेटवर्क इंटरसेप्शन, अपलोड या अन्य पैकेज कार्य शुरू होने से पहले वापस आ जाते हैं। |
| अधिकतम अवलोकन अवधि | प्रत्येक अवलोकन सत्र की अधिकतम लंबाई सीमित करता है। |
| रिकॉर्डिंग एफपीएस | डिफ़ॉल्ट रूप से `1 FPS`. प्रोजेक्ट व्यवस्थापक `1`, `2`, या `3 FPS` चुन सकते हैं। यदि रिमोट कॉन्फ़िगरेशन अनुपलब्ध है, तो SDK स्थानीय/डिफ़ॉल्ट कैप्चर व्यवहार पर वापस आ जाता है। |
| पाठ इनपुट गोपनीयता | सभी टेक्स्ट इनपुट को मास्क करने में डिफ़ॉल्ट। केवल-सुरक्षित मोड पासवर्ड/सुरक्षित फ़ील्ड को छिपाकर रखता है और अन्य टेक्स्ट इनपुट को डिबगिंग रीप्ले में प्रदर्शित होने की अनुमति देता है। |

## स्क्रीन ट्रैकिंग

Rejourney स्वचालित रूप से SwiftUI नेविगेशन में शामिल नहीं होता है, इसलिए जब भी उपयोगकर्ता नई स्क्रीन पर नेविगेट करता है तो `trackScreen` पर कॉल करें।

### SwiftUI

`.onAppear` या नेविगेशन-जागरूक संशोधक का उपयोग करें:

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

### यूआईकिट

`viewDidAppear` के अंदर `trackScreen` पर कॉल करें:

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### नेविगेशनपाथ/नेविगेशनस्टैक

नेविगेशन पथ का निरीक्षण करें और परिवर्तन पर नज़र रखें:

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

## उपयोगकर्ता की पहचान

सत्रों को अपनी स्वयं की उपयोगकर्ता आईडी के साथ संबद्ध करें ताकि आप डैशबोर्ड में विशिष्ट उपयोगकर्ता ढूंढ सकें।

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **गोपनीयता:** आंतरिक आईडी या यूयूआईडी का उपयोग करें। यदि आपको PII (ईमेल, फोन) का उपयोग करना है, तो इसे पास करने से पहले इसे हैश करें।

पहचान `UserDefaults` के माध्यम से लॉन्च किए गए सभी ऐप पर बनी रहती है - आपको प्रति लॉगिन केवल एक बार `identify` पर कॉल करने की आवश्यकता है, प्रत्येक खुले ऐप पर नहीं।

## कस्टम इवेंट

व्यवहार को समझने, डीबग समस्याओं और डैशबोर्ड में सत्र रीप्ले को फ़िल्टर करने के लिए सार्थक उपयोगकर्ता क्रियाओं को ट्रैक करें।

### बुनियादी उपयोग

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

| पैरामीटर | प्रकार | आवश्यक | विवरण |
|---|---|---|---|
| `name` | `String` | हाँ | इवेंट का नाम - स्थिरता के लिए `snake_case` का उपयोग करें |
| `properties` | `[String: RejourneyMetadataValue]` | नहीं | इस घटना से जुड़े कुंजी-मूल्य जोड़े |

`RejourneyMetadataValue` सीधे Swift अक्षर स्वीकार करता है - किसी रैपिंग की आवश्यकता नहीं:

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### उदाहरण

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

### डैशबोर्ड में इवेंट कैसे दिखाई देते हैं

कस्टम ईवेंट प्रति सत्र संग्रहीत होते हैं और दो स्थानों पर दिखाई देते हैं:

1. **सत्र पुनः चलाने की समयरेखा** - घटनाएँ रीप्ले टाइमलाइन पर मार्कर के रूप में दिखाई देती हैं ताकि आप ठीक उसी क्षण पर जा सकें जब कोई कार्रवाई हुई हो।
2. **सत्र पुरालेख फ़िल्टर** - सत्र सूची को फ़िल्टर करें:
   - **घटना नाम** - एक विशिष्ट घटना वाले सभी सत्र खोजें (उदाहरण के लिए `purchase_completed`)
   - **घटना गिनती** - विशिष्ट संख्या में कस्टम इवेंट वाले सत्र खोजें

### सर्वोत्तम प्रथाएं




> [!TIP]
> - सुसंगत नामकरण का उपयोग करें (`snake_case`, उदाहरण के लिए `button_tapped` नहीं `Button Tapped`)
> - संपत्ति मूल्यों को सरल रखें (स्ट्रिंग्स, संख्याएं, बूलियन) - गहराई से नेस्टेड वस्तुओं से बचें
> - उन कार्रवाइयों पर ध्यान केंद्रित करें जो डिबगिंग या एनालिटिक्स के लिए महत्वपूर्ण हैं - हर चीज़ को लॉग न करें

## गोपनीयता नियंत्रण

टेक्स्ट इनपुट और कैमरा दृश्य डिफ़ॉल्ट रूप से स्वचालित रूप से मास्क हो जाते हैं। प्रोजेक्ट व्यवस्थापक समर्थित SDK संस्करणों के लिए प्रोजेक्ट सेटिंग्स में डिफ़ॉल्ट टेक्स्ट इनपुट मास्किंग स्तर को बदल सकते हैं। सुरक्षित/पासवर्ड फ़ील्ड, कैमरा दृश्य और स्पष्ट मास्क सुरक्षित रहते हैं।

अतिरिक्त संवेदनशील दृश्यों को छिपाने के लिए, `mask` और `unmask` API का उपयोग करें:

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

SwiftUI के लिए, `UIViewRepresentable` रैपर या `introspect` के माध्यम से अंतर्निहित `UIView` प्राप्त करें।

#### देशी चादरें

नेटिव शीट कैप्चर डिफ़ॉल्ट रूप से सक्षम है (`captureNativeSheets: true`)। यह ऐप-स्वामित्व वाली मूल शीट और संवाद, जैसे भुगतान प्राधिकरण मॉडल, को डिबगिंग रीप्ले में प्रदर्शित होने की अनुमति देता है जब ओएस कैप्चर की अनुमति देता है। जब टेक्स्ट इनपुट डिफ़ॉल्ट रूप से छुपाए जाते हैं तो कीबोर्ड/टेक्स्ट-इनपुट सिस्टम शीट को बाहर रखा जाता है। जब टेक्स्ट इनपुट मास्किंग केवल फ़ील्ड को सुरक्षित करने के लिए सेट की जाती है, तो कीबोर्ड केवल सर्वोत्तम प्रयास होते हैं और विश्वसनीय रूप से कैप्चर नहीं किए जा सकते क्योंकि iOS उन्हें संरक्षित या दूरस्थ सिस्टम सतहों के रूप में प्रस्तुत कर सकता है। ओएस शेयर शीट भी केवल सर्वोत्तम प्रयास हैं और जब सिस्टम उन्हें संरक्षित या दूरस्थ सतहों के रूप में प्रस्तुत करता है तो उन्हें विश्वसनीय रूप से कैप्चर नहीं किया जा सकता है।

यदि आप चाहते हैं कि विज़ुअल रीप्ले मुख्य ऐप विंडो तक सीमित रहे तो नेटिव शीट कैप्चर अक्षम करें:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### उपयोगकर्ता की सहमति और GDPR




> [!IMPORTANT]
> **आप डेटा नियंत्रक हैं.** Rejourney आपकी ओर से डेटा प्रोसेसर के रूप में कार्य करता है। आप यह सुनिश्चित करने के लिए ज़िम्मेदार हैं कि आपके अंतिम उपयोगकर्ताओं को सत्र रिकॉर्डिंग के बारे में सूचित किया गया है और आपके पास उनके डेटा को संसाधित करने के लिए वैध कानूनी आधार है (उदाहरण के लिए सहमति या वैध हित)।

#### आपको क्या करना चाहिए

1. **अपने ऐप की गोपनीयता नीति में सत्र रिकॉर्डिंग का खुलासा करें।** ऐसी भाषा शामिल करें:

   > * "हम Rejourney का उपयोग आपकी इन-ऐप गतिविधि के अज्ञात और गैर-अनाम सत्र रिप्ले को रिकॉर्ड करने के लिए करते हैं ताकि हमें उत्पाद को बेहतर बनाने, क्रैश और समस्याओं को ट्रैक करने और उत्पाद घर्षण को कम करने में मदद मिल सके। सत्र डेटा में स्क्रीन इंटरैक्शन, डिवाइस जानकारी और अनुमानित स्थान शामिल हो सकते हैं। टेक्स्ट इनपुट और संवेदनशील यूआई तत्व स्वचालित रूप से मास्क किए जाते हैं और कभी कैप्चर नहीं किए जाते हैं। "*

2. **सहमति के पीछे गेट रिकॉर्डिंग** (ईईए उपयोगकर्ताओं के लिए अनुशंसित):

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

3. **ऑप्ट-आउट का सम्मान करें।** यदि कोई उपयोगकर्ता सहमति वापस लेता है, तो रिकॉर्डिंग बंद करें और उनकी पहचान साफ़ करें:

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### केवल निरीक्षण मोड (कोई दृश्य रिकॉर्डिंग नहीं)

त्रुटियों, क्रैश, ANRs, और नेटवर्क गतिविधि **बिना** रिकॉर्डिंग विज़ुअल रीप्ले को कैप्चर करने के लिए, `observeOnly: true` सेट करें:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

सक्षम होने पर, सभी टेलीमेट्री एकत्र की जाती है लेकिन कोई स्क्रीनशॉट नहीं लिया जाता है - सत्र आपके रीप्ले पेज में दिखाई नहीं देंगे लेकिन पूर्ण विश्लेषण, त्रुटि, नेटवर्क और क्रैश डेटा अभी भी कैप्चर किया गया है। यह तब उपयोगी है जब उपयोगकर्ताओं ने स्क्रीन रिकॉर्डिंग से ऑप्ट आउट कर लिया है लेकिन आप अभी भी त्रुटि दृश्यता चाहते हैं।

> **टिप्पणी:** इसे संग्रहीत प्राथमिकता या सहमति ध्वज के आधार पर प्रति उपयोगकर्ता सशर्त रूप से सेट किया जा सकता है:
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### नेटवर्क पर कब्जा

नेटवर्क अनुरोध कैप्चर (डिफ़ॉल्ट रूप से `autoTrackNetwork: true`) एक कस्टम `URLProtocol` के माध्यम से `URLSession` ट्रैफ़िक को रोकता है। यदि आप नेटवर्क डेटा एकत्र नहीं करना चाहते तो इसे अक्षम करें:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### जियोलोकेशन

आईपी-व्युत्पन्न जियोलोकेशन (देश, क्षेत्र, शहर) डिफ़ॉल्ट रूप से एकत्र किया जाता है। लुकअप को पूरी तरह से दबाने के लिए इसे अक्षम करें:

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## कॉन्फ़िगरेशन संदर्भ

सभी विकल्प `configure` में एक बार सेट होते हैं और `start` को कॉल करने के बाद इन्हें बदला नहीं जा सकता।

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

| विकल्प | प्रकार | डिफ़ॉल्ट | विवरण |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | स्व-होस्टेड परिनियोजन के लिए ओवरराइड |
| `userId` | `String?` | `nil` | वैकल्पिक प्रारंभिक आंतरिक उपयोगकर्ता आईडी |
| `enabled` | `Bool` | `true` | मास्टर किल स्विच - SDK को पूरी तरह से अक्षम करने के लिए `false` पर सेट करें |
| `observeOnly` | `Bool` | `false` | केवल टेलीमेट्री एकत्र करें, कोई दृश्य रिकॉर्डिंग नहीं |
| `captureFPS` | `Int?` | `nil` | वैकल्पिक स्थानीय कैप्चर एफपीएस फ़ॉलबैक। रिमोट प्रोजेक्ट सेटिंग्स रिकॉर्डिंग एफपीएस को प्राथमिकता दी जाती है जब उपलब्ध हो |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG कैप्चर गुणवत्ता (`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | केवल वाई-फ़ाई पर सत्र डेटा अपलोड करें |
| `captureScreen` | `Bool` | `true` | विज़ुअल स्क्रीन कैप्चर सक्षम/अक्षम करें |
| `captureAnalytics` | `Bool` | `true` | एनालिटिक्स इवेंट संग्रह सक्षम/अक्षम करें |
| `captureCrashes` | `Bool` | `true` | क्रैश रिपोर्टिंग सक्षम/अक्षम करें |
| `captureANR` | `Bool` | `true` | ANR (ऐप प्रतिक्रिया नहीं दे रहा है) का पता लगाने को सक्षम/अक्षम करें |
| `trackConsoleLogs` | `Bool` | `true` | सत्र के लिए कंसोल लॉग कैप्चर करें |
| `collectGeoLocation` | `Bool` | `true` | आईपी-व्युत्पन्न जियोलोकेशन एकत्र करें |
| `autoTrackNetwork` | `Bool` | `true` | नेटवर्क कैप्चर के लिए अवरोधन `URLSession` अनुरोध |
| `captureNativeSheets` | `Bool` | `true` | जब iOS कैप्चर की अनुमति देता है, तो विज़ुअल रीप्ले में ऐप-स्वामित्व वाली मूल शीट/डायलॉग विंडो शामिल करें। ओएस शेयर शीट और कीबोर्ड को सुरक्षित या दूरस्थ सतहों पर रखा जा सकता है और इन्हें विश्वसनीय रूप से कैप्चर नहीं किया जा सकता है |
| `debug` | `Bool` | `false` | कंसोल पर वर्बोज़ SDK लॉग प्रिंट करें |

## रिकॉर्डिंग बंद करना

वर्तमान सत्र रोकें और लंबित डेटा फ्लश करें:

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

कॉलबैक वैरिएंट गैर-एसिंक संदर्भों के लिए उपलब्ध है:

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## सत्र आईडी

अपने स्वयं के लॉग या समर्थन टूलींग से सहसंबंधित करने के लिए किसी भी समय वर्तमान सत्र आईडी तक पहुंचें:

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
