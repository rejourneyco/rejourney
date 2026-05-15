# استكشاف الأخطاء وإصلاحها المستضافة ذاتيًا

استخدم هذه الصفحة إذا تابعت [Self-hosted Rejourney](/docs/selfhosted) وفشل شيء ما أو كان يتصرف بشكل غريب. يتم تشغيل الأوامر من **جذر المستودع** (حيث يعيش `docker-compose.selfhosted.yml`).

---

## الشيكات السريعة

### حالة الخدمة

```bash
./scripts/selfhosted/deploy.sh status
```

### سجلات API

```bash
./scripts/selfhosted/deploy.sh logs api
```

### تحميل سجلات التتابع

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### سجلات العامل

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. فشل التثبيت أو التحديث قبل أو أثناء التمهيد

### أعراض

- `bootstrap` يخرج من الصفر
- خدمات التطبيقات لا تصبح صحية أبدًا
- يعرض `status` API أو العمال الذين ينتظرون التمهيد
- يتم الخروج من التثبيت أو التحديث باستخدام `Database authentication failed before bootstrap.`

### الشيكات

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

الأسباب الشائعة:

- `DATABASE_URL` سيئة
- عدم تطابق بيانات الاعتماد (على سبيل المثال، من عملية نشر فاشلة سابقة)
- مفقود `STORAGE_ENCRYPTION_KEY`
- بيانات اعتماد S3 غير صالحة
- عنوان URL لنقطة النهاية S3 الخارجية معطل
- في **أرم64**، دعم الصورة مفقود (اضبط `DOCKER_DEFAULT_PLATFORM=linux/amd64` أو استخدم `./scripts/selfhosted/deploy.sh`، الذي يقوم بتعيينه عند عدم الضبط)

استعادة:

1. إذا كان لا يزال لديك `.env.selfhosted` الأصلي، فقم باستعادته وتشغيل:

```bash
./scripts/selfhosted/deploy.sh update
```

2. إذا لم تكن بحاجة إلى بيانات قديمة، فقم بمسحها وإعادة تثبيتها:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**رسائل المخطط/الترحيل:** عند التثبيت العادي، تبدأ قاعدة البيانات فارغة ويقوم bootstrap بإعداد كل شيء. إذا قمت بإدخال **استعادة Postgres من نسخة احتياطية** إلى خادم جديد ولكن بيانات تعريف الترحيل مفقودة، أو قمت بتوجيه المكدس إلى **قاعدة بيانات خاطئة**، فقد يخرج bootstrap مع وجود خطأ حول قاعدة بيانات غير متناسقة بدلاً من الكتابة فوق بياناتك. ما لم تكن تقوم بالاسترداد المتقدم، قم بإصلاح `DATABASE_URL` واستعادة نسخة احتياطية متسقة، أو ابدأ من وحدة تخزين نظيفة. من أجل استرداد الترحيل المتعمد فقط، تستخدم بعض الإعدادات `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` في `.env.selfhosted` (راجع مستندات المشرف أو الدعم قبل استخدام هذا).

### يصلح

1. إذا كان لديك `.env.selfhosted` الأصلي، فاستعده وأعد تشغيله:

```bash
./scripts/selfhosted/deploy.sh update
```

2. إذا لم يكن لديك `.env.selfhosted` الأصلي، فقم بمسحه وإعادة تثبيته:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

يقوم `update` بإعادة تشغيل مزامنة المخطط والبذور ونقطة نهاية التخزين. يقوم `reset` بإزالة الحاويات ووحدات تخزين البيانات ذاتية الاستضافة بحيث يمكن للتثبيت الجديد إنشاء بيانات اعتماد جديدة بأمان.

---

## 2. يتم احتساب الجلسات ولكن تظل إعادة التشغيل فارغة

### ماذا يعني هذا عادة الآن

في البنية الحالية، عادةً ما يكون هذا أحد أمرين:

- تعذر على `ingest-upload` تخزين وحدات البايت الاصطناعية
- تعذر على `ingest-worker` معالجة العناصر التي تم تحميلها

لم يعد الجهاز يقوم بالتحميل مباشرة إلى MinIO/S3، لذلك لم تعد إمكانية الوصول إلى الحاوية من الهاتف هي المشتبه به الرئيسي.

### الشيكات

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

بحث:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### الأسباب الشائعة

- بيانات اعتماد S3 خاطئة في `.env.selfhosted`
- دلو S3 الخارجي مفقود
- نقطة النهاية S3 الخارجية لا يمكن الوصول إليها من شبكة Docker
- تحميل التتابع غير صحي
- العامل عالق في إعادة محاولة العناصر الفاشلة

### يصلح

- تحقق من قيم `S3_*`
- إذا قمت بتغيير تكوين التخزين، أعد تشغيل:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. يتم تحميل لوحة المعلومات، ولكن تفشل استدعاءات المصادقة أو API

### الشيكات

- يشير مضيف لوحة المعلومات DNS إلى الخادم
- يشير مضيف API DNS إلى الخادم
- استيعاب المضيف DNS يشير إلى الخادم
- المنفذان `80` و`443` مفتوحان
- أصدرت Let’s Encrypt الشهادات

فحص:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS أو مشكلات الشهادة

يقوم Traefik بإدارة الشهادات تلقائيًا.

### الشيكات

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

تأكد من حل كلا الاسمين للخادم الذي يقوم بتشغيل المكدس.

إذا كان DNS خاطئًا أثناء التثبيت الأول، فقم بإصلاح DNS وأعد التشغيل:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. يعمل S3 الخارجي في CLI، لكن لا يمكن تحميل Rejourney

تذكر أن مسار التحميل هو من جانب الخادم.

مسار الشبكة المهم هو:

- حاوية `ingest-upload` -> نقطة النهاية S3 الخاصة بك

اختبر من الخادم من خلال مراجعة سجلات الترحيل وتأكيد نقطة النهاية/المجموعة/المفاتيح في `.env.selfhosted`.

إذا قمت بتغييرها، قم بإعادة التشغيل:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. تثبيت MinIO المدمج، لكن التحف لا تزال تفشل

### الشيكات

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

يجب أن تقوم اللقطة الواحدة `minio-setup` بإنشاء الجرافة المسماة `S3_BUCKET`.

إذا قمت بتغيير اسم الحاوية بعد التثبيت الأول، قم بتشغيل:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. تعرض صفحات الفوترة الفوترة المعطلة

وهذا أمر متوقع ما لم يتم تكوين مفاتيح Stripe.

لم يعد المكدس يعطل الفوترة لأنه "مستضاف ذاتيًا". يقوم بتعطيل الفوترة لأن Stripe غير مكون.

إذا لم تقم بتعيين مفاتيح Stripe:

- تظل واجهة مستخدم الفوترة في حالة الاستضافة الذاتية/غير المحدودة
- يظل تسجيل الخروج وخطافات الويب Stripe معطلين

---

## 8. نقطة نهاية التخزين في Postgres خاطئة بعد تغيير `.env.selfhosted`

يجري:

```bash
./scripts/selfhosted/deploy.sh update
```

يقوم مسار التحديث بإعادة تشغيل bootstrap وإعادة مزامنة صف `storage_endpoints` النشط.

---

## 9. الحاجة إلى إيقاف الخدمات دون فقدان البيانات

يستخدم:

```bash
./scripts/selfhosted/deploy.sh stop
```

هذا يوقف الحاويات فقط. لا يزيل وحدات التخزين.

---

## 10. تحتاج إلى سجلات أعمق لخدمة واحدة

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
