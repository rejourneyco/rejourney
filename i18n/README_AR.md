<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney Logo" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="https://rejourney.co/images/session-replay-preview.png" alt="إعادة تشغيل الجلسات في ريجورني" width="100%" />

  <p>
    <strong>إعادة تشغيل الجلسات والمراقبة خفيفة الوزن لتطبيقات React Native</strong>
    <br />
    تركيز على الأجهزة المحمولة مع التقاط فيديو بدقة بكسل مثالية واكتشاف الحوادث في الوقت الفعلي.
  </p>
  
  <p>
    <a href="https://rejourney.co"><strong>استكشف الموقع الإلكتروني »</strong></a>
  </p>
  
  <p>
    <a href="https://reactnative.dev"><img src="https://img.shields.io/badge/React%20Native-61DAFB?logo=react&logoColor=black" alt="React Native" /></a>
    <a href="https://expo.dev"><img src="https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white" alt="Expo" /></a>
  </p>
</div>

## الميزات

### التقاط بدقة بكسل مثالية
تشغيل فيديو بمعدل إطارات حقيقي يلتقط كل بكسل تم رندرتُه. على عكس المنافسين، نحن نلتقط كل شيء—بما في ذلك Mapbox (Metal)، والظلال المخصصة (Shaders)، وطرق العرض المسرعة بواسطة وحدة معالجة الرسومات (GPU).

### تدفق الحوادث المباشر
![تغذية المشكلات](https://rejourney.co/images/issues-feed.png)

شاهد الانهيارات، والأخطاء، ونقرات الغضب أثناء حدوثها في الوقت الفعلي مع تقارير فورية عن الانهيارات.

### اكتشاف الأخطاء/ANR/الانهيارات
![مشاكل ANR](https://rejourney.co/images/anr-issues.png)

اكتشاف تلقائي لأحداث "التطبيق لا يستجيب" (ANR) مع تفريغ كامل للخيوط وتحليل الخيط الأساسي.

### معالم الرحلة
![رحلات المستخدمين](https://rejourney.co/images/user-journeys.png)

تصور كيف يتنقل المستخدمون في تطبيقك. حدد نقاط الانقطاع ذات الاحتكاك الشديد وحسّن مسارات التحويل.

### خرائط الحرارة للتفاعل
![خرائط الحرارة](https://rejourney.co/heatmaps-demo.png)

**تصور مشاركة المستخدم بدقة.** تعرف على الأماكن التي ينقرون عليها، ويسحبون، ويمررون لتحسين وضع واجهة المستخدم.

### الاستقرار العالمي
![الذكاء الجغرافي](https://rejourney.co/images/geo-intelligence.png)

راقب الأداء والاستقرار عبر مناطق مختلفة. اكتشف مشكلات البنية التحتية قبل أن تؤثر على جمهورك العالمي.

### محركات النمو
![محركات النمو](https://rejourney.co/images/growth-engines.png)
تتبع الاحتفاظ بالمستخدمين وشرائح الولاء. افهم كيف تؤثر الإصدارات على مستخدميك النشطين مقابل معدلات الارتداد.

### تنبيهات الفريق
![تنبيهات الفريق](https://rejourney.co/images/team-alerts.png)
إشعارات بريد إلكتروني ذكية للانهيارات، وANRs، وارتفاع الأخطاء. وصول قائم على الأدوار لفرق الهندسة.

## التوثيق

أدلة تكامل كاملة ومرجع API: https://rejourney.co/docs/reactnative/overview

### الاستضافة الذاتية

- استضافة ذاتية بملف Docker واحد: https://rejourney.co/docs/selfhosted
- استضافة K3s على مستوى المؤسسات (وثائق البنية): https://rejourney.co/docs/architecture/distributed-vs-single-node

## المساهمة

هل تريد المساهمة في Rejourney؟ راجع دليل المساهمة الخاص بنا: https://rejourney.co/docs/community/contributing

## الاختبارات القياسية (Benchmarks)

تم تصميم Rejourney ليكون **غير مرئي للعين**. نحن نستخدم **خط أنابيب التقاط غير متزامن** مدمج مع **بوابة حلقة التشغيل (Run Loop Gating)**، مما يضمن توقف SDK تلقائيًا أثناء التفاعلات (اللمس/التمرير) للحفاظ على استجابة واجهة المستخدم بنسبة 100%.

**الجهاز:** iPhone 15 Pro (iOS 18)  
**البيئة:** Expo SDK 54, React Native New Architecture (Concurrent Mode)  
**تطبيق الاختبار:** [Merch App](https://merchcampus.com) (نسخة الإنتاج مع Mapbox Metal + Firebase)  
**عبء العمل للاختبار:** 46 عنصر تغذية معقد، عرض Mapbox GL، 124 مكالمة API، 31 مكونًا فرعيًا، تتبع الإيماءات النشط، وتدقيق الخصوصية في الوقت الفعلي.

| المقياس | المتوسط (ملي ثانية) | الأقصى (ملي ثانية) | الأدنى (ملي ثانية) | الخيط |
| :--- | :---: | :---: | :---: | :---: |
| **الرئيسي: التقاط UIKit + Metal** | **12.4** | 28.2 | 8.1 | الرئيسي |
| **الخلفية: معالجة الصور غير المتزامنة** | 42.5 | 88.0 | 32.4 | الخلفية |
| **الخلفية: ضغط Tar+Gzip** | 14.2 | 32.5 | 9.6 | الخلفية |
| **الخلفية: مصافحة التحميل** | 0.8 | 2.4 | 0.3 | الخلفية |
| **إجمالي التأثير على الخيط الرئيسي** | **12.4** | 28.2 | 8.1 | الرئيسي |

*ملاحظة: إجمالي التأثير على الخيط الرئيسي هو العمل الوحيد الذي يعيق رندرة تطبيقك.*

## الهندسة

القرارات الهندسية والبنية: https://rejourney.co/engineering

## الترخيص

مكونات جانب العميل (SDKs, CLIs) مرخصة تحت Apache 2.0. مكونات جانب الخادم (الخلفية، لوحة التحكم) مرخصة تحت SSPL 1.0. راجع [LICENSE-APACHE](LICENSE-APACHE) و [LICENSE-SSPL](LICENSE-SSPL) للحصول على التفاصيل.
