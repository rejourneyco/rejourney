<!-- AI_PROMPT_SECTION -->
**هل تستخدم Cursor أو Claude أو ChatGPT؟** انسخ مطالبة التكامل والصقه في مساعد AI الخاص بك لإنشاء رمز الإعداد تلقائيًا.

<!-- /AI_PROMPT_SECTION -->

## تثبيت

قم بإضافة حزمة Rejourney إلى مشروعك باستخدام npm أو yarn.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> يتطلب Rejourney كودًا أصليًا وهو غير متوافق مع Expo Go. استخدام بنيات التطوير:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3 خط الإعداد

قم بتهيئة Rejourney وبدء تشغيله في الجزء العلوي من تطبيقك (على سبيل المثال، في App.tsx أو Index.js).

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

لا يتطلب أي التفاف مزود. يبدأ التسجيل على الفور.

## إعدادات التسجيل عن بعد

يمكن لإعدادات المشروع التحكم في إعدادات التسجيل الافتراضية لـ React Native دون شحن إصدار تطبيق جديد. تقرأ إصدارات SDK المدعومة إعداد FPS للتسجيل عن بعد عند بدء الجلسة؛ الافتراضي هو 1 إطارًا في الثانية، ويمكن لمسؤولي المشروع اختيار 1 أو 2 أو 3 إطارات في الثانية. إذا كان التكوين عن بعد غير متاح، فسيعود SDK إلى سلوك الالتقاط المحلي/الافتراضي.

## تتبع الشاشة

يقوم Rejourney تلقائيًا بتتبع تغييرات الشاشة حتى تتمكن من معرفة مكان تواجد المستخدمين في تطبيقك أثناء عمليات إعادة التشغيل. اختر الإعداد الذي يطابق مكتبة التنقل الخاصة بك:

### Expo Router (تلقائي)

إذا كنت تستخدم **Expo Router**، فإن تتبع الشاشة يعمل خارج الصندوق. ليست هناك حاجة إلى رمز إضافي.




> [!TIP]
> **هل تستخدم أسماء الشاشة المخصصة؟** إذا كنت تستخدم Expo Router ولكنك تريد توفير أسماء الشاشة الخاصة بك يدويًا، فراجع قسم [أسماء الشاشة المخصصة](#custom-screen-names) أدناه.

---

### React Navigation

إذا كنت تستخدم **React Navigation** (`@react-navigation/native`)، فاستخدم الخطاف `useNavigationTracking` في جذرك `NavigationContainer`:

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

### أسماء الشاشة المخصصة

إذا كنت تريد تحديد أسماء الشاشة يدويًا (على سبيل المثال، لتناسق التحليلات أو إذا كنت لا تستخدم المكتبات المذكورة أعلاه)، فاستخدم طريقة `trackScreen`.

#### لمستخدمي Expo Router:
لاستخدام أسماء مخصصة مع Expo Router، يجب عليك أولاً تعطيل التتبع التلقائي في التكوين الخاص بك:

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### مكالمة التتبع اليدوي:
اتصل بـ `trackScreen` عند حدوث تغيير في الشاشة:

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## تحديد هوية المستخدم

قم بربط الجلسات بمعرفات المستخدم الداخلية الخاصة بك لتصفية مستخدمين محددين والبحث عنهم في لوحة المعلومات.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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
   - **اسم الحدث** — البحث عن كافة الجلسات التي تحتوي على حدث معين (على سبيل المثال، `purchase_completed`)
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

### متى يتم استخدام بيانات التعريف مقابل الأحداث

| حالة الاستخدام | استخدم **البيانات الوصفية** | استخدم **الأحداث** |
|---|---|---|
| خطة اشتراك المستخدم |  `setMetadata('plan', 'pro')` | |
| قام المستخدم بالنقر على زر | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| متغير اختبار أ/ب |  `setMetadata('ab_variant', 'v2')` | |
| اكتمل الشراء | |  `logEvent('purchase', { amount: 29 })` |
| دور المستخدم |  `setMetadata('role', 'admin')` | |
| تم الوصول إلى خطوة الإعداد | |  `logEvent('onboarding_step', { step: 3 })` |

**القاعدة الأساسية:** إذا كان يصف *من هو المستخدم* أو *الحالة التي هم عليها*، فاستخدم بيانات التعريف. إذا كانت تصف *شيئًا ما حدث*، فاستخدم الأحداث.

## ضوابط الخصوصية

يتم إخفاء مدخلات النص وطرق عرض الكاميرا تلقائيًا بشكل افتراضي. يمكن لمسؤولي المشروع تغيير مستوى إخفاء إدخال النص الافتراضي في إعدادات المشروع لإصدارات SDK المدعومة؛ تتجاهل الإصدارات الأقدم من SDK هذا الإعداد البعيد وتحتفظ بسلوك الإخفاء الحالي. تظل الحقول الآمنة/كلمة المرور وطرق عرض الكاميرا والأقنعة الصريحة محمية.

لإخفاء واجهة المستخدم الحساسة الإضافية يدويًا، قم بتغليف المكونات في المكون `Mask`:

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

يظهر المحتوى المقنع كمستطيل متصل في عمليات إعادة التشغيل ولا يتم التقاطه مطلقًا من المصدر.

### موافقة المستخدم وGDPR




> [!IMPORTANT]
> تعمل **أنت مراقب البيانات.** Rejourney كمعالج بيانات نيابة عنك. أنت مسؤول عن ضمان إبلاغ المستخدمين النهائيين بتسجيل الجلسة وأن لديك أساسًا قانونيًا صالحًا لمعالجة بياناتهم (مثل الموافقة أو المصالح المشروعة).

#### ما يجب عليك فعله

1. **قم بالكشف عن تسجيل الجلسة في سياسة خصوصية تطبيقك.** تتضمن لغة مثل:

   > * "نحن نستخدم Rejourney لتسجيل عمليات إعادة تشغيل الجلسة مجهولة المصدر وغير مجهولة المصدر لنشاطك داخل التطبيق لمساعدتنا في تحسين المنتج وتتبع الأعطال والمشكلات وتقليل احتكاك المنتج. قد تتضمن بيانات الجلسة تفاعلات الشاشة ومعلومات الجهاز والموقع التقريبي. ويتم إخفاء مدخلات النص وعناصر واجهة المستخدم الحساسة تلقائيًا ولا يتم التقاطها أبدًا."*

2. **تسجيل البوابة وراء الموافقة** (موصى به لمستخدمي المنطقة الاقتصادية الأوروبية):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **احترام الانسحابات.** إذا قام المستخدم بسحب موافقته، توقف عن التسجيل وامسح بياناته:

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### التقاط سجل وحدة التحكم

يتم تمكين التقاط سجل وحدة التحكم بشكل افتراضي (`trackConsoleLogs: true`). يمكن أن تحتوي سجلات وحدة التحكم على PII وفقًا لممارسات التسجيل الخاصة بتطبيقك. قم بتعطيله في حالة احتمال ظهور بيانات حساسة في السجلات:

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### تحديد الموقع الجغرافي

يتم جمع الموقع الجغرافي المشتق من IP (البلد، المنطقة، المدينة) بشكل افتراضي. عندما تكون قيمة `collectGeoLocation` هي `false`، تقوم SDK بتمرير إشارة إلى الطبقة الأصلية التي تمنع البحث عن الموقع الجغرافي لـ IP على الواجهة الخلفية - ولا يتم تخزين بيانات الموقع لتلك الجلسة. قم بتعطيله إذا كنت لا تحتاج إلى بيانات الموقع أو تريد تقليل جمع البيانات لمستخدمي المنطقة الاقتصادية الأوروبية:

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### أوراق أصلية

يتم تمكين التقاط الورقة الأصلية بشكل افتراضي (`captureNativeSheets: true`) لإصدارات SDK المدعومة. يسمح هذا للأوراق ومربعات الحوار الأصلية المملوكة للتطبيق، مثل نماذج تفويض الدفع، بالظهور في عمليات إعادة تصحيح الأخطاء عندما يسمح نظام التشغيل بالالتقاط. يتم استبعاد أوراق نظام لوحة المفاتيح/إدخال النص عندما تكون مدخلات النص مقنعة بشكل افتراضي. عند تعيين قناع إدخال النص على الحقول الآمنة فقط، فإن أفضل جهد للوحات المفاتيح فقط ولا يمكن التقاطها بشكل موثوق، خاصة عندما يعرضها نظام التشغيل على أنها أسطح محمية أو بعيدة. تعد أوراق مشاركة نظام التشغيل أيضًا أفضل جهد فقط ولا يمكن التقاطها بشكل موثوق عندما يعرضها النظام كأسطح محمية أو بعيدة.

قم بتعطيل التقاط الورقة الأصلية إذا كنت تريد أن تظل إعادة العرض المرئي مقتصرة على نافذة التطبيق الرئيسية:

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### وضع المراقبة فقط (لا يوجد تسجيل مرئي)

لالتقاط الأخطاء والأعطال وANRs ونشاط الشبكة **بدون** لتسجيل عمليات الإعادة المرئية، قم بتعيين `observeOnly: true`:

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

عند التمكين، يتم جمع كل القياسات عن بعد ولكن لا يتم التقاط لقطات شاشة - لن تظهر الجلسات في صفحة الإعادة الخاصة بك ولكن ستكون هناك بيانات تحليلية كاملة/خطأ/شبكة/تعطل. لا إعادة. يعد هذا مفيدًا عندما يقوم المستخدمون بإلغاء الاشتراك في تسجيل الشاشة ولكنك لا تزال ترغب في رؤية الخطأ.

> **ملحوظة:** يمكن تعيين ذلك بشكل مشروط لكل مستخدم، على سبيل المثال بناءً على التفضيل المخزن أو علامة الموافقة:
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
