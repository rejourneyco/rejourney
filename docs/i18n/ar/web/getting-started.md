<!-- AI_PROMPT_SECTION -->
**هل تستخدم Cursor أو Claude أو ChatGPT؟** انسخ مطالبة التكامل والصقه في مساعد AI الخاص بك لإنشاء رمز الإعداد تلقائيًا.

<!-- /AI_PROMPT_SECTION -->

## تثبيت

قم بإضافة حزمة Rejourney إلى مشروعك باستخدام npm أو yarn.

```bash
npm install @rejourneyco/browser
```

## الإعداد الأساسي

قم بتهيئة وبدء تشغيل Rejourney عند نقطة دخول التطبيق الخاص بك.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

يقوم `init` بإحضار التكوين عن بعد لمشروعك وإعداد ملف SDK. يبدأ `start` الجلسة، ويسجل الزائر، و(إذا تم تمكين إعادة التشغيل) يبدأ مسجل rrweb. كلاهما غير متزامن وآمن للاتصال دون انتظار ما إذا كنت لا تحتاج إلى بوابة أي شيء عند الانتهاء.




> [!NOTE]
> `autoStart` هو `false` بشكل افتراضي. يجب عليك الاتصال بـ `start()` بشكل صريح، مما يتيح لك تسجيل التسجيل خلف التحقق من الموافقة. للبدء تلقائيًا بعد `init`، قم بتمرير `{ autoStart: true }`.

### تكاملات الإطار

تشحن الحزمة نقاط دخول مخصصة للأطر الشائعة. استخدم ما يطابق مجموعتك — أو استخدم الفانيليا API أعلاه من أي إطار عمل.

---

#### رد فعل

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

`startOnMount` الافتراضي هو `false` على `RejourneyProvider`. قم بتمرير `startOnMount` (أو `startOnMount={true}`) لبدء التسجيل بمجرد تركيب المكون.

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

`RejourneyNext` هو مكون `'use client'` الذي يعرض `null`. `startOnMount` الافتراضي هو `true`. يتم تتبع تغييرات المسار تلقائيًا عبر السجل API.

---

#### فيو

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

يتوفر مثيل Rejourney عبر `app.config.globalProperties.$rejourney` وعبر `inject('rejourney')`. يتم أيضًا تصدير `useRejourney()` القابل للتركيب من أجل الراحة.

---

#### نوكست

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

تضمن اللاحقة `.client.ts` أن هذا المكون الإضافي يعمل فقط في المتصفح. يتم إدخال مثيل Rejourney كـ `$rejourney` وهو متاح عبر `useNuxtApp().$rejourney`.

---

#### سفليت / سفلتكيت

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

تقوم `startRejourneyOnMount` بإرجاع وظيفة تنظيف تستدعي `Rejourney.stop()` - يتم استخدام قيمة الإرجاع `onMount` الخاصة بـ Svelte كرد اتصال تدمير تلقائيًا.

---

#### الزاوي

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

تقوم `createRejourneyAppInitializer` بإرجاع مصنع يقوم بتهيئة Rejourney وبدء تشغيله أثناء مرحلة تمهيد Angular. يمكنك أيضًا حقن `RejourneyService` لـ API على أساس الفصل.

---

#### ريمكس

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

`startOnMount` الافتراضي هو `true`. يتم تعقب تغييرات المسار تلقائيًا.

---

#### استرو

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

`startRejourneyForAstro` no-ops في بيئات SSR - فهو يتحقق من وجود `window` قبل التشغيل.

---

## إعدادات التسجيل عن بعد

يمكن لإعدادات المشروع التحكم في الإعدادات الافتراضية لتسجيل الويب دون نشر التعليمات البرمجية. يقرأ SDK التكوين عن بعد في كل مكالمة `start()`. يمكن للتكوين عن بعد تمكين التسجيل أو تعطيله بالكامل، وضبط قائمة النطاقات المسموح بها، وتعيين الحد الأقصى لمدة الجلسة. إذا كان التكوين عن بعد غير متاح، فلن تتم متابعة `start()` — وهذا مقصود لمنع التسجيل في حالة مشروع غير معروفة.

## تتبع الطريق

يقوم Rejourney تلقائيًا بتتبع تغييرات الصفحة والمسار حتى تتمكن من رؤية سياق التنقل في عمليات الإعادة. يتم تمكين هذا افتراضيًا (`autoTrackRoutes: true`) ويعمل عن طريق اعتراض مكالمات السجل API (`pushState`، `replaceState`) والاستماع إلى أحداث `popstate`.

### أسماء الطرق المخصصة

بشكل افتراضي، يتم استخدام `window.location.pathname` كاسم الشاشة. لتوفير منطق التسمية الخاص بك، قم بتمرير وظيفة `routeName`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### تتبع الشاشة يدويًا

لتتبع الشاشات يدويًا (على سبيل المثال لتغييرات علامات التبويب أو انتقالات العرض داخل الصفحة)، اتصل بـ `trackScreen` مباشرة:

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

لتعطيل تتبع المسار التلقائي والاعتماد فقط على المكالمات اليدوية:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## تحديد هوية المستخدم

قم بربط الجلسات بمعرفات المستخدم الداخلية الخاصة بك لتصفية مستخدمين محددين والبحث عنهم في لوحة المعلومات.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **خصوصية:** استخدم المعرفات الداخلية أو UUIDs. إذا كان يجب عليك استخدام PII (البريد الإلكتروني، الهاتف)، فقم بتجزئته قبل الإرسال.

## الأحداث المخصصة

تتبع إجراءات المستخدم ذات المعنى لفهم أنماط السلوك ومشكلات تصحيح الأخطاء وعمليات إعادة تشغيل جلسة التصفية في لوحة المعلومات.

### الاستخدام الأساسي

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

| المعلمة | اكتب | مطلوب | الوصف |
|---|---|---|---|
| `name` | `string` | نعم | اسم الحدث - استخدم `snake_case` للتناسق |
| `properties` | `object` | لا | أزواج القيمة الأساسية المرتبطة بهذا الحدث المحدد |

### أمثلة

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

### كيفية ظهور الأحداث في لوحة التحكم

يتم تخزين الأحداث المخصصة لكل جلسة وتكون مرئية في مكانين:

1. **الجدول الزمني لإعادة تشغيل الجلسة** — تظهر الأحداث كعلامات على المخطط الزمني لإعادة التشغيل حتى تتمكن من الانتقال إلى اللحظة المحددة التي حدث فيها الإجراء.
2. **مرشحات أرشيف الجلسة** — قم بتصفية قائمة الجلسات حسب:
   - **اسم الحدث** — البحث عن جميع الجلسات التي تحتوي على حدث معين (على سبيل المثال، `purchase_completed`)
   - **خاصية الحدث** — تضييق نطاقه أكثر حسب مفتاح الخاصية و/أو القيمة (على سبيل المثال، `plan = pro`)
   - **عدد الأحداث** — البحث عن جلسات تحتوي على عدد محدد من الأحداث المخصصة (على سبيل المثال، أكثر من 5 أحداث)

### أفضل الممارسات




> [!TIP]
> - استخدم تسمية متسقة (`snake_case`، على سبيل المثال `button_clicked` وليس `Button Clicked`)
> - حافظ على بساطة قيم الخاصية (السلاسل والأرقام والقيم المنطقية) - وتجنب الكائنات المتداخلة
> - ركز على الإجراءات المهمة لتصحيح الأخطاء أو التحليلات، ولا تقم بتسجيل كل شيء
> - الخصائص مخصصة لسياق كل حدث. بالنسبة للسمات على مستوى الجلسة، استخدم **البيانات الوصفية** بدلاً من ذلك

---

## البيانات الوصفية

قم بإرفاق أزواج قيمة المفتاح على مستوى الجلسة التي تصف المستخدم أو سياق الجلسة. على عكس الأحداث، يتم تعيين البيانات التعريفية مرة واحدة لكل مفتاح وتنطبق على الجلسة بأكملها.

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

يجب أن تكون قيم البيانات التعريفية `string` أو `number` أو `boolean`. لا يتم قبول الكائنات والمصفوفات.

### متى يتم استخدام بيانات التعريف مقابل الأحداث

| حالة الاستخدام | استخدم **البيانات الوصفية** | استخدم **الأحداث** |
|---|---|---|
| خطة اشتراك المستخدم | `setMetadata('plan', 'pro')` | |
| قام المستخدم بالنقر على زر | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| متغير اختبار أ/ب | `setMetadata('ab_variant', 'v2')` | |
| اكتمل الشراء | | `logEvent('purchase', { amount: 29 })` |
| دور المستخدم | `setMetadata('role', 'admin')` | |
| تم الوصول إلى خطوة الإعداد | | `logEvent('onboarding_step', { step: 3 })` |

**القاعدة الأساسية:** إذا كان يصف *من هو المستخدم* أو *الحالة التي هم عليها*، فاستخدم بيانات التعريف. إذا كانت تصف *شيئًا ما حدث*، فاستخدم الأحداث.

## ضوابط الخصوصية

يتم إخفاء كافة مدخلات النص بشكل افتراضي (`maskAllInputs: true`). تظهر الحقول المقنعة كمدخلات فارغة في عمليات الإعادة ولا يتم التقاط القيم مطلقًا من المصدر. يتم دائمًا إخفاء كلمة المرور والبريد الإلكتروني والهاتف وأنواع الإدخال الحساسة الأخرى بغض النظر عن هذا الإعداد.

### عناصر المنع

لاستبعاد عنصر DOM تمامًا من عمليات الإعادة (يظهر كعنصر نائب ثابت)، قم بإضافة أحد العناصر التالية:

- فئة CSS: `rr-block`
- سمة البيانات: `data-rj-block` أو `data-rejourney-block`
- محدد CSS مخصص عبر خيار التكوين `blockSelector`

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### اخفاء النص

لإخفاء محتوى النص لعنصر ما (يتم استبدال النص ولكن يظل شكل العنصر مرئيًا)، قم بإضافة أحد الإجراءات التالية:

- فئة CSS: `rr-mask`
- سمة البيانات: `data-rj-mask` أو `data-rejourney-mask` أو `data-private` أو أي `data-testid` يحتوي على `"password"`
- محدد CSS مخصص عبر خيار التكوين `maskTextSelector`

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### تجاهل العناصر

لالتقاط شكل عنصر مع منع جميع أحداث التفاعل (النقرات والمدخلات) عليه، أضف:

- فئة CSS: `rr-ignore`
- سمة البيانات: `data-rj-ignore` أو `data-rejourney-ignore`

### وظائف اخفاء مخصصة

بالنسبة لمنطق التقنيع البرمجي، استخدم `maskInputFn` أو `maskTextFn`:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### موافقة المستخدم وGDPR




> [!IMPORTANT]
> تعمل **أنت مراقب البيانات.** Rejourney كمعالج بيانات نيابة عنك. أنت مسؤول عن ضمان إبلاغ المستخدمين النهائيين بتسجيل الجلسة وأن لديك أساسًا قانونيًا صالحًا لمعالجة بياناتهم (مثل الموافقة أو المصالح المشروعة).

#### ما يجب عليك فعله

1. **الكشف عن تسجيل الجلسة في سياسة الخصوصية الخاصة بك.** تتضمن لغة مثل:

   > * "نحن نستخدم Rejourney لتسجيل عمليات إعادة تشغيل الجلسة مجهولة المصدر وغير مجهولة المصدر لنشاطك على موقعنا على الويب لمساعدتنا على تحسين المنتج وتقليل الاحتكاك. قد تتضمن بيانات الجلسة تفاعلات الصفحة ومعلومات المتصفح والموقع التقريبي. ويتم إخفاء مدخلات النص والعناصر الحساسة تلقائيًا ولا يتم التقاطها أبدًا."*

2. **تسجيل البوابة وراء الموافقة** (موصى به لمستخدمي المنطقة الاقتصادية الأوروبية):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **احترام الانسحابات.** إذا قام المستخدم بسحب موافقته، توقف عن التسجيل وقم بمسح هويته:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### موافقة تفصيلية عبر `setConsent`

للتحكم بشكل أفضل، استخدم `setConsent` لتبديل التحليلات وإعادة التشغيل بشكل مستقل:

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

يؤدي تعيين `analytics: false` و`replay: false` معًا إلى إيقاف الجلسة ومسح كافة البيانات الموجودة في قائمة الانتظار. يؤدي ضبط `replay: false` وحده إلى إيقاف مسجل rrweb ولكنه يحافظ على تشغيل تتبع الأحداث.

#### التقاط سجل وحدة التحكم

يتم تعطيل التقاط سجل وحدة التحكم بشكل افتراضي (`trackConsoleLogs: false`). قم بتمكينه فقط إذا كنت في حاجة إليه، حيث يمكن أن تحتوي سجلات وحدة التحكم على PII وفقًا لممارسات التسجيل الخاصة بك:

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### تحديد الموقع الجغرافي

يتم جمع الموقع الجغرافي المشتق من IP (البلد، المنطقة، المدينة) بشكل افتراضي. عندما يكون `collectGeoLocation` هو `false`، يمرر SDK علامة تمنع البحث عن الموقع الجغرافي لـ IP على الواجهة الخلفية - لا يتم تخزين بيانات الموقع لتلك الجلسة:

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### وضع المراقبة فقط (لا يوجد تسجيل مرئي)

لالتقاط الأخطاء والمهام الطويلة ونشاط الشبكة والتحليلات، يقوم **بدون** بتسجيل عمليات الإعادة المرئية، قم بتعيين `observeOnly: true`:

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

عند التمكين، يتم جمع كل القياسات عن بعد ولكن لا يتم تشغيل تسجيل rrweb - لن تظهر الجلسات في صفحة الإعادة الخاصة بك، ولكن لا يزال يتم التقاط التحليلات الكاملة والأخطاء وبيانات الشبكة. يكون هذا مفيدًا عندما يقوم المستخدم بإلغاء الاشتراك في التسجيل المرئي ولكنك لا تزال ترغب في إمكانية الملاحظة.

> **ملحوظة:** يمكنك ضبط هذا بشكل مشروط لكل مستخدم، على سبيل المثال بناءً على تفضيل الموافقة المخزنة:
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### كشف البوت

يتم تجاهل الروبوتات والمتصفحات الآلية افتراضيًا (`ignoreBots: true`). يتم قمع الكاتب المسرحي ومحرك الدمى والسيلينيوم وغيرهم من العملاء المعتمدين على برنامج تشغيل الويب. لتسجيل جلسات التشغيل الآلي (على سبيل المثال، للأدوات الداخلية):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

لتوفير نمط مخصص لاكتشاف الروبوتات:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### التقاط طلب الشبكة

يتم اعتراض طلبات الشبكة (الجلب وXHR) وتسجيلها افتراضيًا (`autoTrackNetwork: true`). يتم التقاط أحجام نص الطلب والاستجابة بشكل افتراضي **لا** (`networkCaptureSizes: false`). يتم دائمًا التقاط عناوين URL والأساليب ورموز الحالة والمدد.

لاستبعاد عناوين URL محددة:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

لتصفية الطلبات أو تنقيحها قبل إرسالها:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## مرجع التكوين

| الخيار | اكتب | الافتراضي | الوصف |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | اتصل بـ `start()` تلقائيًا بعد اكتمال `init()` |
| `disableInDev` | `boolean` | `false` | منع التسجيل على `localhost` و`127.0.0.1` |
| `debug` | `boolean` | `false` | تمكين التسجيل المطول SDK إلى وحدة تحكم المتصفح |
| `enabled` | `boolean` | `true` | مفتاح القتل الرئيسي - تم ضبطه على `false` لمنع أي تسجيل |
| `observeOnly` | `boolean` | `false` | التقط التحليلات/الأخطاء/الشبكة دون إعادة التشغيل المرئي |
| `captureReplay` | `boolean` | `true` | تمكين التقاط إعادة العرض المرئي rrweb |
| `allowedDomains` | `string[]` | `[]` | تقييد التسجيل على مجالات محددة. فارغ يعني أن جميع المجالات مسموح بها. يدعم أحرف البدل `*.example.com` |
| `maxSessionDuration` | `number` | `1800000` | الحد الأقصى لطول الجلسة بالمللي ثانية (الافتراضي: 30 دقيقة) |
| `collectGeoLocation` | `boolean` | `true` | اجمع البلد/المنطقة/المدينة المشتقة من IP |
| `captureAttribution` | `boolean` | `true` | التقط معلمات UTM والمرجع وعنوان URL للإدخال عند بدء الجلسة |
| `ignoreBots` | `boolean` | `true` | منع التسجيل للروبوتات وبرامج تشغيل الويب المكتشفة |
| `recordAutomation` | `boolean` | `false` | السماح بتسجيل جلسات الكاتب المسرحي/ محرك الدمى/ السيلينيوم |
| `autoTrackRoutes` | `boolean` | `true` | تتبع تغييرات المسار تلقائيًا عبر History API |
| `routeName` | `(location: Location) => string` | — | وظيفة مخصصة لاشتقاق اسم الشاشة من `window.location` |
| `autoTrackNetwork` | `boolean` | `true` | اعتراض وتسجيل طلبات الجلب/XHR |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | عناوين URL المطلوب استبعادها من تتبع الشبكة |
| `networkCaptureSizes` | `boolean` | `false` | تضمين أحجام نص الطلب/الاستجابة في سجلات الشبكة |
| `trackConsoleLogs` | `boolean` | `false` | التقاط إخراج `console.log/warn/error` |
| `trackLongTasks` | `boolean` | `true` | اكتشاف وتسجيل المهام الطويلة (كتل سلاسل JS> 50 مللي ثانية) |
| `trackResourceErrors` | `boolean` | `true` | التقاط تحميلات الموارد الفاشلة (الصور والبرامج النصية وأوراق الأنماط) |
| `maskAllInputs` | `boolean` | `true` | قم بإخفاء كافة قيم إدخال النص في عمليات الإعادة |
| `blockClass` | `string \| RegExp` | `'rr-block'` | فئة CSS لمنع عنصر بالكامل من إعادة التشغيل |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | محدد CSS لمنع العناصر بالكامل من إعادة التشغيل |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | فئة CSS لتجاهل أحداث التفاعل على عنصر |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | محدد CSS لتجاهل أحداث التفاعل |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | فئة CSS لإخفاء محتوى النص في إعادة التشغيل |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | محدد CSS لإخفاء محتوى النص |
| `maskInputFn` | `(value, element) => string` | — | وظيفة مخصصة لتحويل قيم الإدخال قبل الالتقاط |
| `maskTextFn` | `(text, element) => string` | — | وظيفة مخصصة لتحويل محتوى النص قبل الالتقاط |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | وظيفة مخصصة لتحديد ما إذا كان سيتم تسجيل كل صفحة يتم تحميلها أم لا
| `beforeSendEvent` | `(event) => event \| null` | — | تصفية الأحداث أو تعديلها قبل وضعها في قائمة الانتظار. قم بإرجاع `null` للإسقاط |
| `beforeSendNetwork` | `(request) => request \| null` | — | تصفية إدخالات الشبكة أو تعديلها قبل وضعها في قائمة الانتظار. قم بإرجاع `null` للإسقاط |
| `onAuthError` | `(error) => void` | — | يتم استدعاؤه عندما يفشل SDK في المصادقة مع الواجهة الخلفية |

## إيقاف التسجيل

اتصل بـ `stop()` لإنهاء الجلسة، ومسح أي أحداث معلقة، وتنظيف كافة مستمعي SDK:

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()` آمن للاتصال به عدة مرات. بعد التوقف، اتصل بـ `start()` مرة أخرى لبدء جلسة جديدة.

## معرف الجلسة

قم بالوصول إلى معرف الجلسة الحالية لربط جلسات Rejourney بسجلاتك أو أدوات الدعم الخاصة بك:

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

يتم إرجاع `null` إذا لم تكن هناك جلسة نشطة.

## مساعدو الحالة

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
