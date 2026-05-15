# المساهمة في Rejourney

نحن نرحب بالمساهمات! يرجى الاطلاع على الأدلة أدناه للبدء.

## هيكل المشروع

هذا عبارة عن monorepo تتم إدارته بواسطة مساحات عمل npm.

## المتطلبات الأساسية

1. **Node.js** >= 18.0.0
2. **npm** أو **yarn** (تعمل مساحات العمل مع كليهما)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode وCocoaPods
7. **Android**: Android Studio وJDK 17

## الإعداد الأولي

### 1. تثبيت التبعيات

من **جذر** من monorepo:

```bash
npm install
```

هذا سوف:
- تثبيت كافة تبعيات مساحة العمل
- إنشاء حزمة SDK تلقائيًا (تشغيل `npm run build:sdk` عبر البرنامج النصي `postinstall` في الجذر `package.json`)
- ربط كافة الحزم بشكل صحيح

### 2. قم ببناء SDK

إذا كنت بحاجة إلى إعادة بناء SDK بعد إجراء التغييرات:

```bash
npm run build:sdk
```

أو لبناء نظيف:

```bash
npm run build:clean
```

## تطوير الواجهة الخلفية (Kubernetes المحلي)

يستخدم Rejourney `local-k8s/` للتطوير المحلي بحيث يظل وقت التشغيل قريبًا من إعداد Kubernetes للإنتاج مع الحفاظ على سرعة الحلقة اليومية.

### 1. قم بتكوين `.env.k8s.local`

انسخ قالب بيئة Kubernetes المحلي:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. ابدأ تشغيل Hybrid Dev Stack

```bash
npm run dev
```

ذلك التدفق:

- يقوم بإنشاء مجموعة `k3d` محلية إذا لزم الأمر
- ينطبق على `local-k8s/namespace.yaml`، و`postgres.yaml`، و`redis.yaml`، و`minio.yaml`
- مزامنة `.env.k8s.local` مع أسرار Kubernetes
- يقوم بتشغيل API ولوحة المعلومات والعاملين من المصدر على جهازك المضيف

لتشغيل التكافؤ الكامل داخل المجموعة:

```bash
npm run dev:full
```

لإيقاف المكدس المحلي:

```bash
npm run dev:down
```

### 3. تكوين عنوان IP (اختبار الجهاز المادي)

إذا كنت تختبر على **الجهاز المادي** (iOS أو Android) متصلاً بنفس شبكة WiFi، فإن SDK وDashboard بحاجة إلى معرفة عنوان IP المحلي لجهاز الكمبيوتر الخاص بك للتواصل.

#### البحث عن عنوان IP الخاص بك (Mac)

قم بتشغيل الأمر التالي في المحطة الطرفية الخاصة بك:

```bash
ipconfig getifaddr en0
```

أو ابحث عنه في **إعدادات النظام > WiFi > تفاصيل [شبكتك].**.

#### تحديث `.env.k8s.local`

تستخدم المتغيرات التالية **يجب** عنوان IP المحلي الخاص بك (على سبيل المثال، `http://192.168.1.5:3000`) بدلاً من `localhost`:

| متغير | استخدام المفتاح |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | الوصول العام إلى MinIO لإعادة تشغيل الفيديو |
| `PUBLIC_DASHBOARD_URL` | عنوان URL الأساسي لواجهة مستخدم لوحة المعلومات |
| `PUBLIC_API_URL` | عنوان URL الأساسي لـ API |
| `PUBLIC_INGEST_URL` | عنوان URL الأساسي لاستيعاب الحدث SDK |
| `DASHBOARD_ORIGIN` | أصل CORS للوحة القيادة |
| `OAUTH_REDIRECT_BASE` | عنوان URL الأساسي لعمليات الاسترجاعات عبر OAuth |




> [!IMPORTANT]
> سيؤدي الفشل في تعيين هذه العناصر بشكل صحيح إلى حدوث أخطاء "تم رفض الاتصال" على الأجهزة الفعلية أو روابط الصور/الفيديو المعطلة في لوحة المعلومات.

يقوم `npm run dev` بتحديث هذه القيم التي تواجه الشبكة المحلية (LAN) تلقائيًا من خلال `scripts/local-k8s/update-ips.sh`، ويكتب أيضًا ملفات بيئة التطبيق النموذجية التي تستخدمها تطبيقات Expo.

#### مثال للتكوين (`.env.k8s.local`)

بافتراض أن عنوان IP لجهاز الكمبيوتر الخاص بك هو `192.168.1.100`:

```env
# Object storage (host access to local-k8s MinIO)
S3_ENDPOINT=http://127.0.0.1:9000
S3_PUBLIC_ENDPOINT=http://192.168.1.100:9000

# Public URLs
PUBLIC_DASHBOARD_URL=http://192.168.1.100:8080
PUBLIC_API_URL=http://192.168.1.100:3000
PUBLIC_INGEST_URL=http://192.168.1.100:3000
DASHBOARD_ORIGIN=http://192.168.1.100:8080
OAUTH_REDIRECT_BASE=http://192.168.1.100:3000
```

### 4. ملفات Kubernetes المحلية

تعكس بيانات Kubernetes المحلية تخطيط `k8s/` للإنتاج عمدًا:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## تشغيل تطبيقات المثال

### React Native النموذجي (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

أو من دليل المثال:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### مختبرات تحضير القهوة (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native العارية

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## كيف يعمل

### إعداد مساحة العمل

يستخدم monorepo مساحات عمل npm للحزم الأساسية، ولكن أمثلة التطبيقات مستقلة:

1. يتضمن **الجذر `package.json`** فقط `packages/*` و`backend` و`dashboard/web-ui` في مساحات العمل
2. **تطبيقات الأمثلة مستقلة** - لديهم `node_modules` الخاصة بهم لتجنب تعارضات التبعية
3. **تطبيقات المثال** قم بالرجوع إلى SDK باستخدام `"rejourney": "file:../../packages/react-native"`
4. تم تكوين **تكوينات المترو** لمشاهدة حزمة SDK وحلها بشكل صحيح

**لماذا لا توجد الأمثلة في مساحات العمل:**
- تستخدم أمثلة التطبيقات إصدارات مختلفة من Expo/React Native
- يمنع تعارضات إلغاء البيانات المكررة التابعة لـ npm
- يمكن أن يكون لكل مثال شجرة التبعية الكاملة الخاصة به

### تكوين المترو

يحتوي كل تطبيق مثال على `metro.config.js` الذي:

1. **الساعات** الدليل المصدر SDK (`packages/react-native`) للتغييرات
2. **يحل** حزمة `rejourney` إلى الموقع الصحيح
3. يقوم **كتل** بتكرار حزم `react-native` و`react` من جذر مساحة العمل

### كودجن (وحدات توربو)

يتم تشغيل Codegen الخاص بـ React Native تلقائيًا عند إنشاء التطبيق في حالة:

1. تم تعريف `package.json` SDK على `codegenConfig` ✅
2. يتبع ملف المواصفات (`NativeRejourney.ts`) اصطلاح التسمية ✅
3. يتضمن التطبيق حزمة SDK ✅

يعمل Codegen تلقائيًا أثناء:
- `npm run ios` (إصدارات iOS)
- `npm run android` (إصدارات Android)

## هيكل المشروع

```
rejourney/
├── packages/
│   └── react-native/          # SDK package
│       ├── src/                # TypeScript source
│       ├── android/           # Android native code
│       ├── ios/               # iOS native code
│       └── package.json       # Package config with codegenConfig
├── examples/
│   ├── react-native-boilerplate/  # Expo example
│   ├── brew-coffee-labs/          # Expo example
│   └── react-native-bare/         # Bare RN example
└── package.json               # Root workspace config
```

## CI/CD والنشر

يستخدم Rejourney GitHub Actions لأتمتة الاختبار والبناء والنشر عبر monorepo بأكمله.

للحصول على تفاصيل تفصيلية لمجموعات الاختبار واختبار التكامل الأصلي ومنطق النشر الآلي، يرجى الاطلاع على [CI/CD ووثائق الاختبار](/docs/architecture/ci-cd).

---

استكشف [مقارنة البنية](/docs/architecture/distributed-vs-single-node) للحصول على تفاصيل حول السحابة (K8s) مقابل الاستضافة الذاتية (Docker).

## أفضل الممارسات

1. **قم دائمًا ببناء SDK** قبل الاختبار: `npm run build:sdk`
2. **استخدم بروتوكول الملف** (`file:../../packages/react-native`) في package.json لمساحات العمل npm
3. **مسح ذاكرة التخزين المؤقت للمترو** عند مواجهة مشكلات: `npm start -- --reset-cache`
4. **إعادة بناء التطبيقات الأصلية** بعد تغيير الكود الأصلي SDK
5. **اختبار على كل من iOS و Android** قبل الالتزام
