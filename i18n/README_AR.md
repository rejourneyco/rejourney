<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="شعار Rejourney" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="../dashboard/web-ui/public/images/landing-replay-theater.png" alt="اكتشاف المشكلات في Rejourney" width="100%" />

  <p>
    <strong>اكتشاف تسربات مسار التحويل بالذكاء الاصطناعي وتسريع التحويلات</strong>
    <br />
    أصلح تسربات المسارات والتحويلات باستخدام Rejourney.
  </p>

  <p>
    <a href="https://rejourney.co"><strong>استكشف الموقع »</strong></a>
  </p>

  <p>
    <a href="https://reactnative.dev">
      <img src="https://img.shields.io/badge/React%20Native-20232A?style=for-the-badge&amp;logo=react&amp;logoColor=61DAFB" alt="React Native" />
    </a>
    <a href="https://expo.dev">
      <img src="https://img.shields.io/badge/Expo-000020?style=for-the-badge&amp;logo=expo&amp;logoColor=white" alt="Expo" />
    </a>
    <a href="https://www.swift.org">
      <img src="https://img.shields.io/badge/Swift-F05138?style=for-the-badge&amp;logo=swift&amp;logoColor=white" alt="Swift" />
    </a>
  </p>

  <p>
    <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript">
      <img src="https://img.shields.io/badge/Browser%20SDK-F7DF1E?style=for-the-badge&amp;logo=javascript&amp;logoColor=black" alt="Browser SDK" />
    </a>
    <a href="https://nextjs.org">
      <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&amp;logo=nextdotjs&amp;logoColor=white" alt="Next.js" />
    </a>
    <a href="https://vuejs.org">
      <img src="https://img.shields.io/badge/Vue.js-4FC08D?style=for-the-badge&amp;logo=vuedotjs&amp;logoColor=white" alt="Vue.js" />
    </a>
    <a href="https://nuxt.com">
      <img src="https://img.shields.io/badge/Nuxt-00DC82?style=for-the-badge&amp;logo=nuxt&amp;logoColor=white" alt="Nuxt" />
    </a>
  </p>
</div>

## الميزات

### التقاط Pixel Perfect
![مسرح إعادة تشغيل الجلسات](../dashboard/web-ui/public/images/session-replay-preview.png)

تشغيل فيديو بمعدل FPS حقيقي يلتقط كل بكسل تم عرضه. بخلاف المنافسين، نلتقط كل شيء، بما في ذلك Mapbox (Metal) والـ shaders المخصصة والواجهات المسرعة بواسطة GPU.

### اكتشاف التسربات بالذكاء الاصطناعي
![موجز المشكلات](../dashboard/web-ui/public/images/readme-general-demo.png)

يرتب تسربات المسارات المتكررة، ونقرات الغضب، وفشل API، وأدلة الإعادة في حزم سياق جاهزة للإصلاح. مدعوم من Rejourney Marlin.

### اكتشاف الأخطاء وANR والانهيارات
![مشكلات ANR](../dashboard/web-ui/public/images/anr-issues.png)

اكتشاف تلقائي لأحداث عدم استجابة التطبيق مع تفريغات كاملة للخيوط وتحليل للخيط الرئيسي.

### تخطيط الرحلات
![رحلات المستخدمين](../dashboard/web-ui/public/images/readme-user-journeys.png)

تصور كيف يتنقل المستخدمون داخل تطبيقك. حدد نقاط الانسحاب عالية الاحتكاك وحسن مسارات التحويل.

### خرائط حرارة التفاعل
![خرائط الحرارة](../dashboard/web-ui/public/images/heatmaps.png)

**تصور تفاعل المستخدم بدقة.** شاهد أين ينقرون ويمررون ويسحبون لتحسين موضع عناصر الواجهة.

### الاستقرار العالمي
![التحليلات الجغرافية](../dashboard/web-ui/public/images/geo-analytics.png)

راقب الأداء والاستقرار عبر المناطق المختلفة. اكتشف مشكلات البنية التحتية قبل أن تؤثر على جمهورك العالمي.

### محركات النمو
![محركات النمو](../dashboard/web-ui/public/images/growth-engines.png)
تتبع احتفاظ المستخدمين وشرائح الولاء. افهم كيف تؤثر الإصدارات على المستخدمين الأقوى مقارنة بمعدلات الارتداد.

## التوثيق

أدلة التكامل الكاملة ومرجع API: https://rejourney.co/docs/reactnative/overview

## المساهمة

هل تريد المساهمة في Rejourney؟ راجع دليل المساهمة: https://rejourney.co/docs/community/contributing

## التطوير المحلي

يعكس التطوير المحلي الإنتاج عبر [`local-k8s/`](../local-k8s). عند checkout جديد، انسخ `local-k8s/env.example` إلى `.env.k8s.local`، واملأ الأسرار المحلية المطلوبة، ثم شغل `npm run ci:local` للتثبيت والتحقق والبناء والنشر والترحيل وتشغيل المكدس المحلي. بعد أول bootstrap، استخدم `npm run dev` لسير العمل اليومي مع hot reload.

`docker-compose.selfhosted.yml` هو مسار النشر الرسمي للاستضافة الذاتية بعقدة واحدة.

## الاختبارات المعيارية

صمم Rejourney ليبقى خفيفا: حجم حزمة صغير، حمل منخفض على المتصفح، والتقاط على الجوال يحافظ على الخيط الرئيسي متاحا. يمكن فتح معرض الاختبارات المعيارية مباشرة على [rejourney.co/#benchmark-gallery](https://rejourney.co/#benchmark-gallery).

### الويب مقابل PostHog

اختبار Chromium حي عبر ثلاث fixtures للويب: Next.js وSvelteKit وNuxt. تم تشغيل كل SDK مقابل endpoint مشروع حي لثلاث تكرارات لكل framework. الأقل أفضل في كل المقاييس أدناه.

**الأدلة:** [تقرير benchmark](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md)، [النتائج الخام](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-results.json)، [التقاطات شبكة Rejourney الحية](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/rejourney-live-network-captures.json)، [التقاطات شبكة PostHog](../benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/posthog-network-captures.json).

| القسم | الفائز | الهامش |
| :--- | :---: | :--- |
| حجم الحزمة gzipped في Bundlephobia | Rejourney | **أصغر 3.9x** من `posthog-js` |
| وسيط حجم upload للـ SDK الحي | Rejourney | **أصغر 3.0x** من PostHog |
| مدة مهام المتصفح | Rejourney | **أقل 1.1x** في وسيط وقت المهمة |
| وقت تنفيذ السكربت | Rejourney | **أقل 2.0x** في وسيط وقت السكربت |
| JS heap النهائي | Rejourney | **أقل 1.4x** في وسيط heap |

#### حجم الحزمة

حجم الحزمة بإصدار ثابت في Bundlephobia. Gzip هو جزء حجم النقل؛ وminified هو الشريط الكامل المعروض في المعرض.

| الحزمة | الإصدار | Minified | Gzipped | المصدر |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/browser` | `0.1.0` | **52.3 kB** | **15.9 kB** | [Bundlephobia](https://bundlephobia.com/package/@rejourneyco/browser@0.1.0) |
| `posthog-js` | `1.374.2` | 187.5 kB | 61.5 kB | [Bundlephobia](https://bundlephobia.com/package/posthog-js@1.374.2) |

#### مقاييس benchmark الويب الحي

| App | Rejourney upload | PostHog upload | Rejourney task | PostHog task | Rejourney script | PostHog script | Rejourney heap | PostHog heap |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next.js | **21.29 KiB** | 45.35 KiB | **417.96 ms** | 449.91 ms | **160.46 ms** | 185.06 ms | **15.81 MiB** | 16.19 MiB |
| SvelteKit | **8.38 KiB** | 24.99 KiB | **268.72 ms** | 304.03 ms | **19.35 ms** | 42.02 ms | **6.63 MiB** | 9.17 MiB |
| Nuxt | **8.40 KiB** | 26.57 KiB | **305.51 ms** | 322.24 ms | **21.12 ms** | 41.17 ms | **11.33 MiB** | 15.44 MiB |

### الجوال مقابل Sentry

يستخدم Rejourney Mobile خط أنابيب التقاط غير متزامن مع run loop gating، لذلك يمكن أن يحدث عمل الالتقاط خارج مسار العرض الحرج للتطبيق ويتوقف تلقائيا أثناء فترات التفاعل العالي.

#### حجم حزمة React Native

| الحزمة | الإصدار | Minified | Gzipped | الفائز |
| :--- | :---: | ---: | ---: | :--- |
| `@rejourneyco/react-native` | `1.0.17` | **39.7 kB** | **13.2 kB** | **حزمة JS minified أصغر 10.2x** |
| `@sentry/react-native` | `8.7.0` | 403 kB | 135.3 kB | - |

المصادر: [`@rejourneyco/react-native` على Bundlephobia](https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17)، [`@sentry/react-native` على Bundlephobia](https://bundlephobia.com/package/@sentry/react-native@8.7.0).

#### أداء الجوال

**الجهاز:** iPhone 15 Pro (iOS 26)
**البيئة:** Expo SDK 54, React Native New Architecture
**تطبيق الاختبار:** [Merch App](https://merchcampus.com) build إنتاجي مع Mapbox Metal وFirebase
**عبء الاختبار:** 46 عنصرا معقدا في feed، وMapbox GL View، و124 استدعاء API، و31 مكونا فرعيا، وتتبع إيماءات نشط، وتنقيح خصوصية لحظي.

| المقياس | المتوسط (ms) | الأقصى (ms) | الأدنى (ms) | الخيط |
| :--- | ---: | ---: | ---: | :---: |
| **Main: UIKit + Metal Capture** | **12.4** | 28.2 | 8.1 | Main |
| **BG: Async Image Processing** | 42.5 | 88.0 | 32.4 | Background |
| **BG: Tar+Gzip Compression** | 14.2 | 32.5 | 9.6 | Background |
| **BG: Upload Handshake** | 0.8 | 2.4 | 0.3 | Background |
| **Total Main Thread Impact** | **12.4** | 28.2 | 8.1 | Main |

Total Main Thread Impact هو العمل الوحيد في هذا الجدول الذي يحجب عرض التطبيق.

## الهندسة

قرارات الهندسة والبنية: https://rejourney.co/engineering

## الترخيص

مكونات العميل (SDKs وCLIs) مرخصة بموجب Apache 2.0. مكونات الخادم (backend وdashboard) مرخصة بموجب SSPL 1.0. راجع [LICENSE-APACHE](../LICENSE-APACHE) و[LICENSE-SSPL](../LICENSE-SSPL) للتفاصيل.

---

## الترجمات

- [العربية | العربية](README_AR.md)
- [الصينية المبسطة | 简体中文](README_ZH_CN.md)
- [الفرنسية | Français](README_FR.md)
- [الألمانية | Deutsch](README_DE.md)
- [الهندية | हिन्दी](README_HI.md)
- [الإندونيسية | Bahasa Indonesia](README_ID.md)
- [اليابانية | 日本語](README_JA.md)
- [الكورية | 한국어](README_KO.md)
- [البرتغالية (البرازيل) | Português do Brasil](README_PT_BR.md)
- [الإسبانية | Español](README_ES.md)
- [التركية | Türkçe](README_TR.md)
