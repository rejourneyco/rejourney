# स्व-होस्टेड समस्या निवारण

यदि आपने [स्वयं-होस्टेड Rejourney](/docs/selfhosted) का अनुसरण किया है और कुछ विफल रहता है या अजीब व्यवहार करता है तो इस पृष्ठ का उपयोग करें। कमांड **भंडार जड़** (जहां `docker-compose.selfhosted.yml` रहता है) से चलाए जाते हैं।

---

## तेजी से जांच

### सेवा की स्थिति

```bash
./scripts/selfhosted/deploy.sh status
```

### API लॉग

```bash
./scripts/selfhosted/deploy.sh logs api
```

### रिले लॉग अपलोड करें

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
```

### कार्यकर्ता लॉग करता है

```bash
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs retention-worker
./scripts/selfhosted/deploy.sh logs alert-worker
```

---

## 1. बूटस्ट्रैप से पहले या उसके दौरान इंस्टॉल या अपडेट विफल हो जाता है

### लक्षण

- `bootstrap` गैर-शून्य से बाहर निकलता है
- ऐप सेवाएँ कभी भी स्वस्थ नहीं होतीं
- `status` API या बूटस्ट्रैप पर प्रतीक्षा कर रहे श्रमिकों को दिखाता है
- `Database authentication failed before bootstrap.` के साथ निकास स्थापित या अद्यतन करें

### चेकों

```bash
docker compose -f docker-compose.selfhosted.yml --env-file .env.selfhosted logs bootstrap
```

सामान्य कारणों में:

- ख़राब `DATABASE_URL`
- क्रेडेंशियल्स बेमेल (उदाहरण के लिए पहले विफल तैनाती से)
- `STORAGE_ENCRYPTION_KEY` गायब है
- अमान्य S3 क्रेडेंशियल
- टूटा हुआ बाहरी S3 समापन बिंदु URL
- **एआरएम64** पर, छवि समर्थन गायब है (`DOCKER_DEFAULT_PLATFORM=linux/amd64` सेट करें या `./scripts/selfhosted/deploy.sh` का उपयोग करें, जो अनसेट होने पर इसे सेट करता है)

वसूली:

1. यदि आपके पास अभी भी मूल `.env.selfhosted` है, तो इसे पुनर्स्थापित करें और चलाएं:

```bash
./scripts/selfhosted/deploy.sh update
```

2. यदि आपको पुराने डेटा की आवश्यकता नहीं है, तो मिटाएँ और पुनः इंस्टॉल करें:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

**स्कीमा/माइग्रेशन संदेश:** सामान्य इंस्टालेशन पर, डेटाबेस खाली होने लगता है और बूटस्ट्रैप सब कुछ सेट कर देता है। यदि आप एक नए सर्वर में **बैकअप से Postgres को पुनर्स्थापित किया गया** करते हैं लेकिन माइग्रेशन मेटाडेटा गायब है, या आपने स्टैक को **ग़लत डेटाबेस** पर इंगित किया है, तो बूटस्ट्रैप आपके डेटा को ओवरराइट करने के बजाय एक असंगत डेटाबेस के बारे में त्रुटि के साथ बाहर निकल सकता है। जब तक आप उन्नत पुनर्प्राप्ति नहीं कर रहे हैं, `DATABASE_URL` को ठीक करें और एक सुसंगत बैकअप पुनर्स्थापित करें, या एक साफ़ वॉल्यूम से शुरू करें। जानबूझकर माइग्रेट-ओनली पुनर्प्राप्ति के लिए, कुछ सेटअप `.env.selfhosted` में `REJOURNEY_ALLOW_ORPHAN_DB_MIGRATE_ONLY=1` का उपयोग करते हैं (इसका उपयोग करने से पहले अनुरक्षक दस्तावेज़ या समर्थन देखें)।

### हल करना

1. यदि आपके पास मूल `.env.selfhosted` है, तो इसे पुनर्स्थापित करें और पुनः चलाएँ:

```bash
./scripts/selfhosted/deploy.sh update
```

2. यदि आपके पास मूल `.env.selfhosted` नहीं है, तो मिटाएँ और पुनः स्थापित करें:

```bash
./scripts/selfhosted/deploy.sh reset
./scripts/selfhosted/deploy.sh install
```

`update` स्कीमा, सीड और स्टोरेज-एंडपॉइंट सिंक को फिर से चलाता है। `reset` स्व-होस्ट किए गए कंटेनर और डेटा वॉल्यूम को हटा देता है ताकि एक ताज़ा इंस्टॉल सुरक्षित रूप से नए क्रेडेंशियल उत्पन्न कर सके।

---

## 2. सत्र गिने जाते हैं लेकिन रीप्ले खाली रहता है

### अब आमतौर पर इसका क्या मतलब है

वर्तमान वास्तुकला के साथ, यह आमतौर पर दो चीजों में से एक है:

- `ingest-upload` आर्टिफैक्ट बाइट्स संग्रहीत नहीं कर सका
- `ingest-worker` अपलोड किए गए आर्टिफैक्ट को संसाधित नहीं कर सका

डिवाइस अब सीधे MinIO/S3 पर अपलोड नहीं होता है, इसलिए फोन से बकेट रीचैबिलिटी अब मुख्य संदिग्ध नहीं है।

### चेकों

```bash
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs api
```

देखो के लिए:

- `artifact.upload_received`
- `artifact.upload_stored`
- `artifact.retry`
- `artifact.failed`
- `session.reconciled`
- `session.finalized`

### सामान्य कारणों में

- `.env.selfhosted` में गलत S3 क्रेडेंशियल
- बाहरी S3 बाल्टी गायब है
- बाहरी S3 समापन बिंदु Docker नेटवर्क से पहुंच योग्य नहीं है
- अपलोड रिले अस्वस्थ
- कार्यकर्ता विफल कलाकृतियों को पुनः प्रयास करने में अटक गया

### हल करना

- `S3_*` मान सत्यापित करें
- यदि आपने स्टोरेज कॉन्फ़िगरेशन बदल दिया है, तो पुनः चलाएँ:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 3. डैशबोर्ड लोड होता है, लेकिन ऑथ या API कॉल विफल हो जाती है

### चेकों

- डैशबोर्ड होस्ट DNS सर्वर की ओर इंगित करता है
- API होस्ट DNS सर्वर को इंगित करता है
- इनजेस्ट होस्ट DNS सर्वर की ओर इंगित करता है
- पोर्ट `80` और `443` खुले हैं
- Let’s Encrypt ने प्रमाणपत्र जारी किए हैं

निरीक्षण करें:

```bash
./scripts/selfhosted/deploy.sh logs traefik
./scripts/selfhosted/deploy.sh logs api
```

---

## 4. TLS या प्रमाणपत्र मुद्दे

Traefik प्रमाणपत्रों को स्वचालित रूप से प्रबंधित करता है।

### चेकों

```bash
dig example.com
dig api.example.com
dig ingest.example.com
dig www.example.com
```

सुनिश्चित करें कि दोनों नाम स्टैक चलाने वाले सर्वर के अनुरूप हों।

यदि पहली स्थापना के दौरान DNS गलत था, तो DNS को ठीक करें और पुनः चलाएँ:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 5. बाहरी S3 CLI में काम करता है, लेकिन Rejourney अपलोड नहीं हो सकता

याद रखें कि अपलोड पथ सर्वर-साइड है।

महत्वपूर्ण नेटवर्क पथ है:

- `ingest-upload` कंटेनर -> आपका S3 समापन बिंदु

रिले लॉग की समीक्षा करके और `.env.selfhosted` में एंडपॉइंट/बकेट/कुंजी की पुष्टि करके सर्वर से परीक्षण करें।

यदि आपने उन्हें बदल दिया है, तो पुनः चलाएँ:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 6. अंतर्निहित MinIO स्थापित है, लेकिन कलाकृतियाँ अभी भी विफल हैं

### चेकों

```bash
./scripts/selfhosted/deploy.sh logs minio
./scripts/selfhosted/deploy.sh logs minio-setup
```

`minio-setup` वन-शॉट को `S3_BUCKET` द्वारा नामित बाल्टी बनानी चाहिए।

यदि आपने पहली बार इंस्टॉल करने के बाद बकेट का नाम बदल दिया है, तो चलाएँ:

```bash
./scripts/selfhosted/deploy.sh update
```

---

## 7. बिलिंग पृष्ठ अक्षम बिलिंग दिखाते हैं

यह अपेक्षित है जब तक कि Stripe कुंजियाँ कॉन्फ़िगर नहीं की जातीं।

स्टैक अब बिलिंग को अक्षम नहीं करता क्योंकि यह "स्वयं-होस्टेड" है। यह बिलिंग को अक्षम कर देता है क्योंकि Stripe कॉन्फ़िगर नहीं किया गया है।

यदि आप Stripe कुंजियाँ सेट नहीं करते हैं:

- बिलिंग यूआई स्व-होस्टेड/असीमित स्थिति में रहता है
- Stripe चेकआउट और वेबहुक अक्षम रहेंगे

---

## 8. `.env.selfhosted` को बदलने के बाद Postgres में स्टोरेज एंडपॉइंट गलत है

दौड़ना:

```bash
./scripts/selfhosted/deploy.sh update
```

अद्यतन पथ बूटस्ट्रैप को फिर से चलाता है और सक्रिय `storage_endpoints` पंक्ति को फिर से सिंक करता है।

---

## 9. बिना डेटा खोए सेवाएं बंद करने की जरूरत

उपयोग:

```bash
./scripts/selfhosted/deploy.sh stop
```

इससे केवल कंटेनर रुकते हैं। यह वॉल्यूम नहीं हटाता है.

---

## 10. एक सेवा के लिए गहरे लॉग की आवश्यकता है

```bash
./scripts/selfhosted/deploy.sh logs api
./scripts/selfhosted/deploy.sh logs ingest-upload
./scripts/selfhosted/deploy.sh logs ingest-worker
./scripts/selfhosted/deploy.sh logs web
```
