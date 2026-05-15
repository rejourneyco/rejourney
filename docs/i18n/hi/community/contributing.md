# Rejourney में योगदान

हम योगदान का स्वागत करते हैं! आरंभ करने के लिए कृपया नीचे दी गई मार्गदर्शिकाएँ देखें।

## परियोजना संरचना

यह npm कार्यस्थानों द्वारा प्रबंधित एक मोनोरेपो है।

## आवश्यक शर्तें

1. **Node.js** >= 18.0.0
2. **npm** या **yarn** (कार्यस्थान दोनों के साथ काम करते हैं)
3. **Docker Desktop**
4. **kubectl**
5. **k3d**
6. **iOS**: Xcode और CocoaPods
7. **Android**: Android Studio और JDK 17

## प्रारंभिक सेटअप

### 1. निर्भरताएँ स्थापित करें

मोनोरेपो के **जड़** से:

```bash
npm install
```

यह करेगा:
- सभी कार्यस्थान निर्भरताएँ स्थापित करें
- स्वचालित रूप से SDK पैकेज बनाएं (रूट `package.json` में `postinstall` स्क्रिप्ट के माध्यम से `npm run build:sdk` चलाता है)
- सभी पैकेजों को सही ढंग से लिंक करें

### 2. SDK बनाएं

यदि आपको परिवर्तन करने के बाद SDK को फिर से बनाने की आवश्यकता है:

```bash
npm run build:sdk
```

या साफ़ निर्माण के लिए:

```bash
npm run build:clean
```

## बैकएंड विकास (स्थानीय Kubernetes)

Rejourney स्थानीय विकास के लिए `local-k8s/` का उपयोग करता है, इसलिए रनटाइम दैनिक लूप को तेज़ रखते हुए उत्पादन Kubernetes सेटअप के करीब रहता है।

### 1. `.env.k8s.local` कॉन्फ़िगर करें

स्थानीय Kubernetes पर्यावरण टेम्पलेट की प्रतिलिपि बनाएँ:

```bash
cp local-k8s/env.example .env.k8s.local
```

### 2. हाइब्रिड देव स्टैक प्रारंभ करें

```bash
npm run dev
```

वह प्रवाह:

- यदि आवश्यक हो तो एक स्थानीय `k3d` क्लस्टर बनाता है
- `local-k8s/namespace.yaml`, `postgres.yaml`, `redis.yaml`, और `minio.yaml` लागू होता है
- `.env.k8s.local` को Kubernetes रहस्यों में सिंक करता है
- आपकी होस्ट मशीन पर API, डैशबोर्ड और स्रोत से श्रमिकों को चलाता है

पूर्ण इन-क्लस्टर समता चलाने के लिए:

```bash
npm run dev:full
```

स्थानीय स्टैक को रोकने के लिए:

```bash
npm run dev:down
```

### 3. आईपी एड्रेस कॉन्फ़िगरेशन (भौतिक उपकरण परीक्षण)

यदि आप एक ही वाईफाई से जुड़े **भौतिक उपकरण** (iOS या Android) पर परीक्षण कर रहे हैं, तो संचार करने के लिए SDK और डैशबोर्ड को आपके कंप्यूटर का स्थानीय आईपी पता जानना होगा।

#### अपना आईपी पता ढूँढना (मैक)

अपने टर्मिनल में निम्नलिखित कमांड चलाएँ:

```bash
ipconfig getifaddr en0
```

या इसे **सिस्टम सेटिंग्स > वाईफाई > [आपका नेटवर्क] विवरण** में ढूंढें।

#### `.env.k8s.local` को अपडेट करें

निम्नलिखित वेरिएबल **अवश्य**, `localhost` के बजाय आपके स्थानीय आईपी पते (जैसे, `http://192.168.1.5:3000`) का उपयोग करते हैं:

| परिवर्तनीय | मुख्य उपयोग |
| ------------------------ | ---------------------------------------------- |
| `S3_PUBLIC_ENDPOINT` | वीडियो रीप्ले के लिए MinIO तक सार्वजनिक पहुंच |
| `PUBLIC_DASHBOARD_URL` | डैशबोर्ड यूआई के लिए बेस यूआरएल |
| `PUBLIC_API_URL` | API | के लिए बेस यूआरएल
| `PUBLIC_INGEST_URL` | SDK ईवेंट अंतर्ग्रहण के लिए आधार URL |
| `DASHBOARD_ORIGIN` | डैशबोर्ड के लिए CORS मूल |
| `OAUTH_REDIRECT_BASE` | OAuth कॉलबैक के लिए आधार URL |




> [!IMPORTANT]
> इन्हें सही ढंग से सेट करने में विफलता के परिणामस्वरूप भौतिक उपकरणों पर "कनेक्शन अस्वीकृत" त्रुटियां या डैशबोर्ड में टूटी छवि/वीडियो लिंक होंगे।

`npm run dev` इन LAN-फेसिंग मानों को `scripts/local-k8s/update-ips.sh` के माध्यम से स्वचालित रूप से अपडेट करता है, और यह Expo ऐप्स द्वारा उपयोग की जाने वाली उदाहरण ऐप env फ़ाइलों को भी लिखता है।

#### उदाहरण कॉन्फ़िगरेशन (`.env.k8s.local`)

मान लें कि आपके कंप्यूटर का आईपी पता `192.168.1.100` है:

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

### 4. स्थानीय Kubernetes फ़ाइलें

स्थानीय Kubernetes मैनिफ़ेस्ट जानबूझकर उत्पादन `k8s/` लेआउट को प्रतिबिंबित करता है:

- `local-k8s/namespace.yaml`
- `local-k8s/postgres.yaml`
- `local-k8s/redis.yaml`
- `local-k8s/minio.yaml`
- `local-k8s/api.yaml`
- `local-k8s/web.yaml`
- `local-k8s/workers.yaml`
- `local-k8s/ingress.yaml`

## उदाहरण ऐप्स चलाना

### React Native बॉयलरप्लेट (Expo)

```bash
# Start Metro bundler
npm run example:boilerplate

# Run on iOS
npm run example:boilerplate:ios

# Run on Android
npm run example:boilerplate:android
```

या उदाहरण निर्देशिका से:

```bash
cd examples/react-native-boilerplate
npm start
npm run ios
npm run android
```

### ब्रू कॉफ़ी लैब्स (Expo)

```bash
# Start Metro bundler
npm run example:brew

# Run on iOS
npm run example:brew:ios

# Run on Android
npm run example:brew:android
```

### React Native नंगे

```bash
# Start Metro bundler
npm run example:bare

# Run on iOS
npm run example:bare:ios

# Run on Android
npm run example:bare:android
```

## यह काम किस प्रकार करता है

### कार्यस्थल सेटअप

मोनोरेपो कोर पैकेज के लिए npm कार्यस्थान का उपयोग करता है, लेकिन उदाहरण ऐप्स स्टैंडअलोन हैं:

1. **रूट `package.json`** में कार्यस्थलों में केवल `packages/*`, `backend`, और `dashboard/web-ui` शामिल हैं
2. **उदाहरण ऐप्स स्टैंडअलोन हैं** - निर्भरता संघर्ष से बचने के लिए उनके पास अपना स्वयं का `node_modules` है
3. **उदाहरण ऐप्स** `"rejourney": "file:../../packages/react-native"` का उपयोग करके SDK का संदर्भ लें
4. **मेट्रो विन्यास** को SDK पैकेज को सही ढंग से देखने और हल करने के लिए कॉन्फ़िगर किया गया है

**उदाहरण कार्यस्थानों में क्यों नहीं हैं:**
- उदाहरण ऐप्स विभिन्न Expo/React Native संस्करणों का उपयोग करते हैं
- npm निर्भरता डिडुप्लीकेशन विवादों को रोकता है
- प्रत्येक उदाहरण का अपना पूर्ण निर्भरता वृक्ष हो सकता है

### मेट्रो विन्यास

प्रत्येक उदाहरण ऐप में एक `metro.config.js` है:

1. **घड़ियाँ** परिवर्तन के लिए SDK स्रोत निर्देशिका (`packages/react-native`)
2. **हल** `rejourney` पैकेज सही स्थान पर
3. कार्यस्थल रूट से **ब्लाकों** डुप्लिकेट `react-native` और `react` पैकेज

### कोडजेन (टर्बो मॉड्यूल)

ऐप बनाते समय React Native का कोडजन स्वचालित रूप से चलता है यदि:

1. SDK के `package.json` में `codegenConfig` परिभाषित है ✅
2. विशिष्ट फ़ाइल (`NativeRejourney.ts`) नामकरण परिपाटी ✅ का अनुसरण करती है
3. ऐप में SDK पैकेज शामिल है

कोडजेन इस दौरान स्वचालित रूप से चलता है:
- `npm run ios` (iOS बनाता है)
- `npm run android` (Android बनाता है)

## परियोजना संरचना

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

## CI/CD एवं परिनियोजन

Rejourney संपूर्ण मोनोरेपो में परीक्षण, निर्माण और तैनाती को स्वचालित करने के लिए GitHub Actions का उपयोग करता है।

हमारे परीक्षण सुइट्स, मूल एकीकरण परीक्षण और स्वचालित परिनियोजन तर्क के विस्तृत विवरण के लिए, कृपया [CI/CD और परीक्षण दस्तावेज़ीकरण](/docs/architecture/ci-cd) देखें।

---

क्लाउड (K8s) बनाम सेल्फ-होस्टेड (Docker) पर विवरण के लिए [आर्किटेक्चर तुलना](/docs/architecture/distributed-vs-single-node) का अन्वेषण करें।

## सर्वोत्तम प्रथाएं

1. परीक्षण से पहले **हमेशा SDK बनाएं**: `npm run build:sdk`
2. **फ़ाइल प्रोटोकॉल का उपयोग करें** (`file:../../packages/react-native`) npm कार्यस्थानों के लिए package.json में
3. समस्या होने पर **मेट्रो कैश साफ़ करें**: `npm start -- --reset-cache`
4. SDK मूल कोड परिवर्तन के बाद **देशी ऐप्स का पुनर्निर्माण करें**
5. प्रतिबद्ध होने से पहले **iOS और Android दोनों पर परीक्षण करें**
