<!-- AI_PROMPT_SECTION -->
**Cursor, Claude, या ChatGPT का उपयोग कर रहे हैं?** एकीकरण प्रॉम्प्ट को कॉपी करें और सेटअप कोड को स्वचालित रूप से जेनरेट करने के लिए इसे अपने AI सहायक में पेस्ट करें।

<!-- /AI_PROMPT_SECTION -->

## इंस्टालेशन

npm या yarn का उपयोग करके अपने प्रोजेक्ट में Rejourney पैकेज जोड़ें।

```bash
npm install @rejourneyco/browser
```

## बुनियादी सेटअप

आरंभ करें और अपने ऐप के प्रवेश बिंदु पर Rejourney प्रारंभ करें।

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init` आपके प्रोजेक्ट का रिमोट कॉन्फिगरेशन लाता है और SDK तैयार करता है। `start` सत्र शुरू करता है, विज़िटर को पंजीकृत करता है, और (यदि रीप्ले सक्षम है) rrweb रिकॉर्डर शुरू करता है। यदि आपको पूरा होने पर कुछ भी गेट करने की आवश्यकता नहीं है, तो प्रतीक्षा किए बिना कॉल करने के लिए दोनों एसिंक और सुरक्षित हैं।




> [!NOTE]
> `autoStart` डिफ़ॉल्ट रूप से `false` है। आपको स्पष्ट रूप से `start()` पर कॉल करना होगा, जो आपको सहमति जांच के पीछे रिकॉर्डिंग करने की सुविधा देता है। `init` के बाद स्वचालित रूप से प्रारंभ करने के लिए, `{ autoStart: true }` पास करें।

### फ़्रेमवर्क एकीकरण

पैकेज लोकप्रिय फ्रेमवर्क के लिए समर्पित प्रवेश बिंदु भेजता है। उसका उपयोग करें जो आपके स्टैक से मेल खाता हो - या किसी भी ढांचे से उपरोक्त वेनिला API का उपयोग करें।

---

#### प्रतिक्रिया

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

`startOnMount`, `RejourneyProvider` पर डिफ़ॉल्ट रूप से `false` होता है। घटक माउंट होते ही रिकॉर्डिंग शुरू करने के लिए `startOnMount` (या `startOnMount={true}`) पास करें।

---

#### अगला.जे.एस

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

`RejourneyNext` एक `'use client'` घटक है जो `null` प्रस्तुत करता है। `startOnMount` डिफ़ॉल्ट रूप से `true` है। रूट परिवर्तन इतिहास API के माध्यम से स्वचालित रूप से ट्रैक किए जाते हैं।

---

#### वीयूई

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

Rejourney उदाहरण `app.config.globalProperties.$rejourney` और `inject('rejourney')` के माध्यम से उपलब्ध है। सुविधा के लिए `useRejourney()` कंपोजेबल का निर्यात भी किया जाता है।

---

#### अगला

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

`.client.ts` प्रत्यय सुनिश्चित करता है कि यह प्लगइन केवल ब्राउज़र में चलता है। Rejourney उदाहरण को `$rejourney` के रूप में इंजेक्ट किया गया है और `useNuxtApp().$rejourney` के माध्यम से उपलब्ध है।

---

#### स्वेल्ट / स्वेल्टेकिट

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount` एक क्लीनअप फ़ंक्शन लौटाता है जो `Rejourney.stop()` को कॉल करता है - Svelte का `onMount` रिटर्न मान स्वचालित रूप से नष्ट कॉलबैक के रूप में उपयोग किया जाता है।

---

#### कोणीय

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

`createRejourneyAppInitializer` एक फ़ैक्टरी लौटाता है जो एंगुलर के बूटस्ट्रैप चरण के दौरान Rejourney को आरंभ और प्रारंभ करता है। आप क्लास-आधारित API के लिए `RejourneyService` भी इंजेक्ट कर सकते हैं।

---

#### रीमिक्स

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

`startOnMount` डिफ़ॉल्ट रूप से `true` है। रूट परिवर्तन स्वचालित रूप से ट्रैक किए जाते हैं।

---

#### खगोल

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

SSR वातावरण में `startRejourneyForAstro` नो-ऑप्स - यह चलने से पहले `window` की जाँच करता है।

---

## रिमोट रिकॉर्डिंग सेटिंग्स

प्रोजेक्ट सेटिंग्स बिना कोड परिनियोजन के वेब रिकॉर्डिंग डिफ़ॉल्ट को नियंत्रित कर सकती हैं। SDK प्रत्येक `start()` कॉल पर रिमोट कॉन्फिगरेशन पढ़ता है। रिमोट कॉन्फिगरेशन पूरी तरह से रिकॉर्डिंग को सक्षम या अक्षम कर सकता है, अनुमत डोमेन सूची को समायोजित कर सकता है और अधिकतम सत्र अवधि निर्धारित कर सकता है। यदि रिमोट कॉन्फ़िगरेशन अनुपलब्ध है, तो `start()` आगे नहीं बढ़ेगा - यह अज्ञात प्रोजेक्ट स्थिति के तहत रिकॉर्डिंग को रोकने के लिए जानबूझकर किया गया है।

## रूट ट्रैकिंग

Rejourney स्वचालित रूप से पेज और रूट परिवर्तनों को ट्रैक करता है ताकि आप रीप्ले में नेविगेशन संदर्भ देख सकें। यह डिफ़ॉल्ट रूप से सक्षम है (`autoTrackRoutes: true`) और इतिहास API कॉल (`pushState`, `replaceState`) को इंटरसेप्ट करके और `popstate` घटनाओं को सुनकर काम करता है।

### कस्टम रूट नाम

डिफ़ॉल्ट रूप से वर्तमान `window.location.pathname` का उपयोग स्क्रीन नाम के रूप में किया जाता है। अपना स्वयं का नामकरण तर्क प्रदान करने के लिए, एक `routeName` फ़ंक्शन पास करें:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### मैनुअल स्क्रीन ट्रैकिंग

स्क्रीन को मैन्युअल रूप से ट्रैक करने के लिए (उदाहरण के लिए टैब परिवर्तन या इन-पेज व्यू ट्रांज़िशन के लिए), सीधे `trackScreen` पर कॉल करें:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

स्वचालित रूट ट्रैकिंग को अक्षम करने और केवल मैन्युअल कॉल पर निर्भर रहने के लिए:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## उपयोगकर्ता की पहचान

डैशबोर्ड में विशिष्ट उपयोगकर्ताओं को फ़िल्टर करने और खोजने के लिए सत्रों को अपनी आंतरिक उपयोगकर्ता आईडी के साथ संबद्ध करें।

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **गोपनीयता:** आंतरिक आईडी या यूयूआईडी का उपयोग करें। यदि आपको PII (ईमेल, फोन) का उपयोग करना है, तो भेजने से पहले इसे हैश करें।

## कस्टम इवेंट

व्यवहार पैटर्न, डिबग समस्याओं और डैशबोर्ड में फ़िल्टर सत्र रीप्ले को समझने के लिए सार्थक उपयोगकर्ता क्रियाओं को ट्रैक करें।

### बुनियादी उपयोग

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

| पैरामीटर | प्रकार | आवश्यक | विवरण |
|---|---|---|---|
| `name` | `string` | हाँ | इवेंट का नाम - स्थिरता के लिए `snake_case` का उपयोग करें |
| `properties` | `object` | नहीं | इस विशिष्ट घटना घटना से जुड़े कुंजी-मूल्य जोड़े |

### उदाहरण

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

### डैशबोर्ड में इवेंट कैसे दिखाई देते हैं

कस्टम ईवेंट प्रति सत्र संग्रहीत होते हैं और दो स्थानों पर दिखाई देते हैं:

1. **सत्र पुनः चलाने की समयरेखा** - घटनाएँ रीप्ले टाइमलाइन पर मार्कर के रूप में दिखाई देती हैं ताकि आप ठीक उसी क्षण पर जा सकें जब कोई कार्रवाई हुई हो।
2. **सत्र पुरालेख फ़िल्टर** - सत्र सूची को फ़िल्टर करें:
   - **घटना नाम** - एक विशिष्ट घटना वाले सभी सत्र खोजें (उदाहरण के लिए `purchase_completed`)
   - **घटना संपत्ति** - संपत्ति कुंजी और/या मान द्वारा और संकीर्ण करें (जैसे `plan = pro`)
   - **घटना गिनती** - विशिष्ट संख्या में कस्टम इवेंट वाले सत्र ढूंढें (उदाहरण के लिए 5 से अधिक इवेंट)

### सर्वोत्तम प्रथाएं




> [!TIP]
> - सुसंगत नामकरण का उपयोग करें (`snake_case`, उदाहरण के लिए `button_clicked` नहीं `Button Clicked`)
> - संपत्ति मूल्यों को सरल रखें (स्ट्रिंग्स, संख्याएं, बूलियन) - नेस्टेड वस्तुओं से बचें
> - उन कार्रवाइयों पर ध्यान केंद्रित करें जो डिबगिंग या एनालिटिक्स के लिए महत्वपूर्ण हैं - हर चीज़ को लॉग न करें
> - गुण प्रति-घटना संदर्भ के लिए हैं। सत्र-स्तरीय विशेषताओं के लिए, इसके बजाय **मेटाडाटा** का उपयोग करें

---

## मेटाडाटा

सत्र-स्तरीय कुंजी-मूल्य जोड़े संलग्न करें जो उपयोगकर्ता या सत्र संदर्भ का वर्णन करते हैं। घटनाओं के विपरीत, मेटाडेटा प्रति कुंजी एक बार सेट किया जाता है और पूरे सत्र पर लागू होता है।

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

मेटाडेटा मान `string`, `number`, या `boolean` होना चाहिए। ऑब्जेक्ट और सरणियाँ स्वीकार नहीं की जाती हैं।

### मेटाडेटा बनाम इवेंट का उपयोग कब करें

| केस का प्रयोग करें | **मेटाडाटा** का उपयोग करें | **घटनाएँ** | का उपयोग करें
|---|---|---|
| उपयोगकर्ता की सदस्यता योजना | `setMetadata('plan', 'pro')` | |
| उपयोगकर्ता ने एक बटन क्लिक किया | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| ए/बी परीक्षण संस्करण | `setMetadata('ab_variant', 'v2')` | |
| खरीद पूरी हो गई | | `logEvent('purchase', { amount: 29 })` |
| उपयोगकर्ता की भूमिका | `setMetadata('role', 'admin')` | |
| ऑनबोर्डिंग चरण पूरा हो गया | | `logEvent('onboarding_step', { step: 3 })` |

**अंगूठे का नियम:** यदि यह वर्णन करता है कि *उपयोगकर्ता कौन है* या *वे किस स्थिति में हैं*, तो मेटाडेटा का उपयोग करें। यदि यह *कुछ घटित* का वर्णन करता है, तो घटनाओं का उपयोग करें।

## गोपनीयता नियंत्रण

सभी टेक्स्ट इनपुट डिफ़ॉल्ट रूप से मास्क्ड होते हैं (`maskAllInputs: true`)। रिप्ले में छिपे हुए फ़ील्ड रिक्त इनपुट के रूप में दिखाई देते हैं और मान कभी भी स्रोत पर कैप्चर नहीं किए जाते हैं। पासवर्ड, ईमेल, फ़ोन और अन्य संवेदनशील इनपुट प्रकार इस सेटिंग की परवाह किए बिना हमेशा छिपे रहते हैं।

### तत्वों को अवरुद्ध करना

किसी DOM तत्व को रीप्ले से पूरी तरह बाहर करने के लिए (यह एक ठोस प्लेसहोल्डर के रूप में दिखाई देता है), निम्नलिखित में से एक जोड़ें:

- सीएसएस वर्ग: `rr-block`
- डेटा विशेषता: `data-rj-block` या `data-rejourney-block`
- `blockSelector` कॉन्फ़िगरेशन विकल्प के माध्यम से कस्टम सीएसएस चयनकर्ता

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### मास्किंग टेक्स्ट

किसी तत्व की पाठ्य सामग्री को छुपाने के लिए (पाठ को बदल दिया जाता है लेकिन तत्व का आकार दृश्यमान रहता है), निम्नलिखित में से एक जोड़ें:

- सीएसएस वर्ग: `rr-mask`
- डेटा विशेषता: `data-rj-mask`, `data-rejourney-mask`, `data-private`, या `"password"` युक्त कोई `data-testid`
- `maskTextSelector` कॉन्फ़िगरेशन विकल्प के माध्यम से कस्टम सीएसएस चयनकर्ता

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### तत्वों की अनदेखी

किसी तत्व के आकार को कैप्चर करने के लिए लेकिन उस पर सभी इंटरैक्शन ईवेंट (क्लिक, इनपुट) को दबाने के लिए, जोड़ें:

- सीएसएस वर्ग: `rr-ignore`
- डेटा विशेषता: `data-rj-ignore` या `data-rejourney-ignore`

### कस्टम मास्किंग कार्य

प्रोग्रामेटिक मास्किंग लॉजिक के लिए, `maskInputFn` या `maskTextFn` का उपयोग करें:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### उपयोगकर्ता की सहमति और GDPR




> [!IMPORTANT]
> **आप डेटा नियंत्रक हैं.** Rejourney आपकी ओर से डेटा प्रोसेसर के रूप में कार्य करता है। आप यह सुनिश्चित करने के लिए ज़िम्मेदार हैं कि आपके अंतिम उपयोगकर्ताओं को सत्र रिकॉर्डिंग के बारे में सूचित किया गया है और आपके पास उनके डेटा को संसाधित करने के लिए वैध कानूनी आधार है (उदाहरण के लिए सहमति या वैध हित)।

#### आपको क्या करना चाहिए

1. **अपनी गोपनीयता नीति में सत्र रिकॉर्डिंग का खुलासा करें।** ऐसी भाषा शामिल करें:

   > * "हम उत्पाद को बेहतर बनाने और घर्षण को कम करने में मदद करने के लिए हमारी वेबसाइट पर आपकी गतिविधि के अज्ञात और गैर-अनाम सत्र रिप्ले को रिकॉर्ड करने के लिए Rejourney का उपयोग करते हैं। सत्र डेटा में पेज इंटरैक्शन, ब्राउज़र जानकारी और अनुमानित स्थान शामिल हो सकते हैं। टेक्स्ट इनपुट और संवेदनशील तत्व स्वचालित रूप से मास्क किए जाते हैं और कभी कैप्चर नहीं किए जाते हैं।"*

2. **सहमति के पीछे गेट रिकॉर्डिंग** (ईईए उपयोगकर्ताओं के लिए अनुशंसित):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **ऑप्ट-आउट का सम्मान करें।** यदि कोई उपयोगकर्ता सहमति वापस लेता है, तो रिकॉर्डिंग बंद करें और उनकी पहचान साफ़ करें:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### `setConsent` के माध्यम से विस्तृत सहमति

बेहतर नियंत्रण के लिए, एनालिटिक्स को स्वतंत्र रूप से टॉगल करने और रीप्ले करने के लिए `setConsent` का उपयोग करें:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

`analytics: false` और `replay: false` को एक साथ सेट करने से सत्र रुक जाता है और सभी पंक्तिबद्ध डेटा साफ़ हो जाता है। अकेले `replay: false` सेट करने से rrweb रिकॉर्डर बंद हो जाता है लेकिन इवेंट ट्रैकिंग चालू रहती है।

#### कंसोल लॉग कैप्चर

कंसोल लॉग कैप्चर डिफ़ॉल्ट रूप से अक्षम है (`trackConsoleLogs: false`)। यदि आपको इसकी आवश्यकता हो तो ही इसे सक्षम करें, क्योंकि कंसोल लॉग में आपकी लॉगिंग प्रथाओं के आधार पर PII हो सकता है:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### जियोलोकेशन

आईपी-व्युत्पन्न जियोलोकेशन (देश, क्षेत्र, शहर) डिफ़ॉल्ट रूप से एकत्र किया जाता है। जब `collectGeoLocation`, `false` है, तो SDK एक ध्वज पास करता है जो बैकएंड पर आईपी जियोलोकेशन लुकअप को दबा देता है - उस सत्र के लिए कोई स्थान डेटा संग्रहीत नहीं किया जाता है:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### केवल निरीक्षण मोड (कोई दृश्य रिकॉर्डिंग नहीं)

त्रुटियों, लंबे कार्यों, नेटवर्क गतिविधि और एनालिटिक्स **बिना** रिकॉर्डिंग विज़ुअल रिप्ले को कैप्चर करने के लिए, `observeOnly: true` सेट करें:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

सक्षम होने पर, सभी टेलीमेट्री एकत्र की जाती है लेकिन कोई आरआरवेब रिकॉर्डिंग नहीं चलती है - सत्र आपके रीप्ले पेज में दिखाई नहीं देंगे, लेकिन पूर्ण विश्लेषण, त्रुटि और नेटवर्क डेटा अभी भी कैप्चर किया गया है। तब उपयोगी जब किसी उपयोगकर्ता ने विज़ुअल रिकॉर्डिंग से ऑप्ट आउट कर दिया है लेकिन आप अभी भी अवलोकन चाहते हैं।

> **टिप्पणी:** आप इसे प्रति उपयोगकर्ता सशर्त रूप से सेट कर सकते हैं, उदाहरण के लिए संग्रहीत सहमति प्राथमिकता के आधार पर:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### बॉट का पता लगाना

बॉट्स और स्वचालित ब्राउज़र को डिफ़ॉल्ट रूप से अनदेखा कर दिया जाता है (`ignoreBots: true`)। नाटककार, कठपुतली, सेलेनियम और अन्य वेबड्राइवर-आधारित ग्राहकों को दबा दिया जाता है। स्वचालन सत्र रिकॉर्ड करने के लिए (जैसे आंतरिक टूलींग के लिए):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

एक कस्टम बॉट डिटेक्शन पैटर्न प्रदान करने के लिए:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### नेटवर्क अनुरोध कैप्चर

नेटवर्क अनुरोध (फ़ेच और एक्सएचआर) को डिफ़ॉल्ट रूप से इंटरसेप्ट और लॉग किया जाता है (`autoTrackNetwork: true`)। अनुरोध और प्रतिक्रिया के मुख्य भाग का आकार डिफ़ॉल्ट रूप से कैप्चर किया गया **नहीं** है (`networkCaptureSizes: false`)। यूआरएल, विधियां, स्थिति कोड और अवधि हमेशा कैप्चर की जाती हैं।

विशिष्ट यूआरएल को बाहर करने के लिए:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

अनुरोधों को भेजने से पहले फ़िल्टर या संशोधित करने के लिए:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## कॉन्फ़िगरेशन संदर्भ

| विकल्प | प्रकार | डिफ़ॉल्ट | विवरण |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | `init()` पूरा होने के बाद स्वचालित रूप से `start()` पर कॉल करें |
| `disableInDev` | `boolean` | `false` | `localhost` और `127.0.0.1` पर रिकॉर्डिंग रोकें |
| `debug` | `boolean` | `false` | ब्राउज़र कंसोल पर वर्बोज़ SDK लॉगिंग सक्षम करें |
| `enabled` | `boolean` | `true` | मास्टर किल स्विच - किसी भी रिकॉर्डिंग को रोकने के लिए `false` पर सेट करें |
| `observeOnly` | `boolean` | `false` | विज़ुअल रीप्ले के बिना एनालिटिक्स/त्रुटियां/नेटवर्क कैप्चर करें |
| `captureReplay` | `boolean` | `true` | आरआरवेब विज़ुअल रीप्ले कैप्चर सक्षम करें |
| `allowedDomains` | `string[]` | `[]` | रिकॉर्डिंग को विशिष्ट डोमेन तक सीमित रखें. खाली का मतलब सभी डोमेन की अनुमति है। `*.example.com` वाइल्डकार्ड का समर्थन करता है |
| `maxSessionDuration` | `number` | `1800000` | अधिकतम सत्र लंबाई मिलीसेकेंड में (डिफ़ॉल्ट: 30 मिनट) |
| `collectGeoLocation` | `boolean` | `true` | आईपी-व्युत्पन्न देश/क्षेत्र/शहर एकत्रित करें |
| `captureAttribution` | `boolean` | `true` | सत्र प्रारंभ होने पर UTM पैरामीटर, रेफ़रलकर्ता और प्रविष्टि URL कैप्चर करें |
| `ignoreBots` | `boolean` | `true` | पता लगाए गए बॉट्स और वेबड्राइवर्स के लिए रिकॉर्डिंग रोकें |
| `recordAutomation` | `boolean` | `false` | नाटककार/कठपुतली/सेलेनियम सत्रों की रिकॉर्डिंग की अनुमति दें |
| `autoTrackRoutes` | `boolean` | `true` | इतिहास API | के माध्यम से स्वचालित रूप से मार्ग परिवर्तन ट्रैक करें
| `routeName` | `(location: Location) => string` | — | `window.location` | से स्क्रीन नाम प्राप्त करने के लिए कस्टम फ़ंक्शन
| `autoTrackNetwork` | `boolean` | `true` | अवरोधन और लॉग फ़ेच/XHR अनुरोध |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | नेटवर्क ट्रैकिंग से बाहर किए जाने वाले यूआरएल |
| `networkCaptureSizes` | `boolean` | `false` | नेटवर्क लॉग में अनुरोध/प्रतिक्रिया मुख्य भाग का आकार शामिल करें |
| `trackConsoleLogs` | `boolean` | `false` | `console.log/warn/error` आउटपुट कैप्चर करें |
| `trackLongTasks` | `boolean` | `true` | लंबे कार्यों का पता लगाएं और लॉग इन करें (जेएस थ्रेड ब्लॉक> 50 एमएस) |
| `trackResourceErrors` | `boolean` | `true` | विफल संसाधन लोड (चित्र, स्क्रिप्ट, स्टाइलशीट) कैप्चर करें |
| `maskAllInputs` | `boolean` | `true` | रीप्ले में सभी टेक्स्ट इनपुट मानों को मास्क करें |
| `blockClass` | `string \| RegExp` | `'rr-block'` | सीएसएस क्लास किसी तत्व को रीप्ले से पूरी तरह से ब्लॉक करने के लिए |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | सीएसएस चयनकर्ता तत्वों को रीप्ले से पूरी तरह से ब्लॉक करने के लिए |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | किसी तत्व पर इंटरेक्शन इवेंट को अनदेखा करने के लिए सीएसएस क्लास |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | इंटरेक्शन इवेंट को अनदेखा करने के लिए सीएसएस चयनकर्ता |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | रीप्ले में टेक्स्ट सामग्री को छिपाने के लिए सीएसएस क्लास |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | पाठ्य सामग्री को छिपाने के लिए सीएसएस चयनकर्ता |
| `maskInputFn` | `(value, element) => string` | — | कैप्चर से पहले इनपुट मानों को बदलने के लिए कस्टम फ़ंक्शन |
| `maskTextFn` | `(text, element) => string` | — | कैप्चर से पहले टेक्स्ट सामग्री को बदलने के लिए कस्टम फ़ंक्शन |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | प्रति-पेज-लोड तय करने के लिए कस्टम फ़ंक्शन कि रिकॉर्ड करना है या नहीं |
| `beforeSendEvent` | `(event) => event \| null` | — | कतारबद्ध होने से पहले घटनाओं को फ़िल्टर या संशोधित करें। ड्रॉप करने के लिए `null` लौटें |
| `beforeSendNetwork` | `(request) => request \| null` | — | कतारबद्ध होने से पहले नेटवर्क प्रविष्टियों को फ़िल्टर या संशोधित करें। ड्रॉप करने के लिए `null` लौटें |
| `onAuthError` | `(error) => void` | — | जब SDK बैकएंड के साथ प्रमाणित करने में विफल रहता है तो कॉल किया जाता है

## रिकॉर्डिंग बंद करना

सत्र समाप्त करने, किसी भी लंबित ईवेंट को फ्लश करने और सभी SDK श्रोताओं को साफ़ करने के लिए `stop()` पर कॉल करें:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` पर कई बार कॉल करना सुरक्षित है। रुकने के बाद, नया सत्र शुरू करने के लिए फिर से `start()` पर कॉल करें।

## सत्र आईडी

अपने स्वयं के लॉग या समर्थन टूल के साथ Rejourney सत्रों को सहसंबंधित करने के लिए वर्तमान सत्र आईडी तक पहुंचें:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

यदि कोई सत्र सक्रिय नहीं है तो `null` लौटाता है।

## स्थिति सहायक

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
