<!-- AI_PROMPT_SECTION -->
**Cursor, Claude 또는 ChatGPT를 사용하시나요?** 통합 프롬프트를 복사하여 AI 어시스턴트에 붙여넣으면 설정 코드가 자동 생성됩니다.

<!-- /AI_PROMPT_SECTION -->

## 설치

npm 또는 yarn를 사용하여 프로젝트에 Rejourney 패키지를 추가합니다.

```bash
npm install @rejourneyco/browser
```

## 기본 설정

앱의 진입점에서 Rejourney를 초기화하고 시작합니다.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();
```

`init`는 프로젝트의 원격 구성을 가져오고 SDK를 준비합니다. `start`는 세션을 시작하고 방문자를 등록하며 (재생이 활성화된 경우) rrweb 레코더를 시작합니다. 둘 다 비동기식이며 완료 시 아무것도 게이트할 필요가 없는 경우 기다리지 않고 호출해도 안전합니다.




> [!NOTE]
> `autoStart`는 기본적으로 `false`입니다. `start()`를 명시적으로 호출해야 동의 확인 후에 녹음을 제어할 수 있습니다. `init` 이후 자동으로 시작하려면 `{ autoStart: true }`를 전달합니다.

### 프레임워크 통합

이 패키지는 널리 사용되는 프레임워크에 대한 전용 진입점을 제공합니다. 스택과 일치하는 것을 사용하거나 모든 프레임워크에서 위의 바닐라 API를 사용하십시오.

---

#### 반응하다

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

`startOnMount`의 기본값은 `RejourneyProvider`의 `false`입니다. `startOnMount`(또는 `startOnMount={true}`)를 전달하여 구성 요소가 마운트되는 즉시 녹화를 시작합니다.

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

`RejourneyNext`는 `null`를 렌더링하는 `'use client'` 구성 요소입니다. `startOnMount`의 기본값은 `true`입니다. 경로 변경 사항은 내역 API를 통해 자동으로 추적됩니다.

---

#### 뷰

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

Rejourney 인스턴스는 `app.config.globalProperties.$rejourney` 및 `inject('rejourney')`를 통해 사용할 수 있습니다. 편의를 위해 `useRejourney()` 컴포저블도 내보냅니다.

---

#### 누스트

```javascript
// plugins/rejourney.client.ts
import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});
```

`.client.ts` 접미사는 이 플러그인이 브라우저에서만 실행되도록 보장합니다. Rejourney 인스턴스는 `$rejourney`로 삽입되고 `useNuxtApp().$rejourney`를 통해 사용할 수 있습니다.

---

#### Svelte / SvelteKit

```javascript
// +layout.svelte
<script>
  import { onMount } from 'svelte';
  import { startRejourneyOnMount } from '@rejourneyco/browser/svelte';

  onMount(() => startRejourneyOnMount({ publicKey: 'pk_live_your_public_key' }));
</script>
```

`startRejourneyOnMount`는 `Rejourney.stop()`를 호출하는 정리 함수를 반환합니다. Svelte의 `onMount` 반환 값은 자동으로 삭제 콜백으로 사용됩니다.

---

#### 모난

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

`createRejourneyAppInitializer`는 Angular의 부트스트랩 단계 중에 Rejourney를 초기화하고 시작하는 팩토리를 반환합니다. 클래스 기반 API에 `RejourneyService`를 삽입할 수도 있습니다.

---

#### 리믹스

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

`startOnMount`의 기본값은 `true`입니다. 경로 변경 사항은 자동으로 추적됩니다.

---

#### 아스트로

```javascript
// src/components/Rejourney.astro (client:only="react" or similar)
// Or in a vanilla <script> block:
import { startRejourneyForAstro } from '@rejourneyco/browser/astro';

startRejourneyForAstro({ publicKey: 'pk_live_your_public_key' });
```

SSR 환경에서 `startRejourneyForAstro`는 작동하지 않습니다. 실행하기 전에 `window`를 확인합니다.

---

## 원격 녹화 설정

프로젝트 설정은 코드 배포 없이 웹 녹화 기본값을 제어할 수 있습니다. SDK는 모든 `start()` 호출에서 원격 구성을 읽습니다. 원격 구성은 녹화를 완전히 활성화 또는 비활성화하고, 허용된 도메인 목록을 조정하고, 최대 세션 기간을 설정할 수 있습니다. 원격 구성을 사용할 수 없는 경우 `start()`는 진행되지 않습니다. 이는 알 수 없는 프로젝트 상태에서 녹화를 방지하기 위한 것입니다.

## 경로 추적

Rejourney는 페이지 및 경로 변경 사항을 자동으로 추적하므로 재생에서 탐색 컨텍스트를 볼 수 있습니다. 이는 기본적으로 활성화되어 있으며(`autoTrackRoutes: true`) 내역 API 호출(`pushState`, `replaceState`)을 가로채고 `popstate` 이벤트를 수신하여 작동합니다.

### 사용자 정의 경로 이름

기본적으로 현재 `window.location.pathname`가 화면 이름으로 사용됩니다. 자신만의 이름 지정 논리를 제공하려면 `routeName` 함수를 전달하세요.

```javascript
await Rejourney.init('pk_live_your_public_key', {
  routeName: (location) => {
    // Example: strip IDs from dynamic segments
    return location.pathname.replace(/\/[0-9a-f-]{36}/g, '/:id');
  },
});
```

### 수동 화면 추적

화면을 수동으로 추적하려면(예: 탭 변경 또는 페이지 내 보기 전환) `trackScreen`를 직접 호출하세요.

```javascript
import { Rejourney } from '@rejourneyco/browser';

Rejourney.trackScreen('Settings / Billing');
```

자동 경로 추적을 비활성화하고 수동 호출에만 의존하려면:

```javascript
await Rejourney.init('pk_live_your_public_key', { autoTrackRoutes: false });
```

## 사용자 식별

세션을 내부 사용자 ID와 연결하여 대시보드에서 특정 사용자를 필터링하고 검색하세요.

```javascript
import { Rejourney } from '@rejourneyco/browser';

// After login
Rejourney.setUserIdentity('user_abc123');

// On logout
Rejourney.clearUserIdentity();
```

> [!IMPORTANT]
> **은둔:** 내부 ID 또는 UUID를 사용합니다. PII(이메일, 전화)를 사용해야 하는 경우 보내기 전에 해시하세요.

## 맞춤 이벤트

의미 있는 사용자 작업을 추적하여 동작 패턴을 이해하고, 문제를 디버깅하고, 대시보드에서 세션 재생을 필터링합니다.

### 기본 사용법

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

| 매개변수 | 유형 | 필수 | 설명 |
|---|---|---|---|
| `name` | `string` | 예 | 이벤트 이름 — 일관성을 위해 `snake_case` 사용 |
| `properties` | `object` | 아니요 | 이 특정 이벤트 발생에 연결된 키-값 쌍 |

### 예

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

### 대시보드에 이벤트가 표시되는 방식

사용자 정의 이벤트는 세션별로 저장되며 다음 두 위치에서 볼 수 있습니다.

1. **세션 재생 타임라인** — 이벤트는 재생 타임라인에 마커로 표시되므로 작업이 발생한 정확한 순간으로 이동할 수 있습니다.
2. **세션 보관 필터** — 다음을 기준으로 세션 목록을 필터링합니다.
   - **이벤트 이름** — 특정 이벤트(예: `purchase_completed`)가 포함된 모든 세션을 찾습니다.
   - **이벤트 속성** — 속성 키 및/또는 값으로 범위를 더욱 좁힙니다(예: `plan = pro`)
   - **이벤트 수** — 특정 개수의 맞춤 이벤트(예: 5개 이상의 이벤트)가 있는 세션 찾기

### 모범 사례




> [!TIP]
> - 일관된 이름 사용(`snake_case`, 예: `Button Clicked`가 아닌 `button_clicked`)
> - 속성 값을 단순하게 유지하십시오(문자열, 숫자, 부울) - 중첩된 객체를 피하십시오
> - 디버깅이나 분석에 중요한 작업에 집중하세요. 모든 것을 기록하지 마세요.
> - 속성은 이벤트별 컨텍스트를 위한 것입니다. 세션 수준 속성의 경우 대신 **메타데이터** 를 사용하세요.

---

## 메타데이터

사용자 또는 세션 컨텍스트를 설명하는 세션 수준 키-값 쌍을 연결합니다. 이벤트와 달리 메타데이터는 키당 한 번 설정되며 전체 세션에 적용됩니다.

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

메타데이터 값은 `string`, `number` 또는 `boolean`여야 합니다. 객체와 배열은 허용되지 않습니다.

### 메타데이터와 이벤트를 사용해야 하는 경우

| 사용 사례 | **메타데이터** 사용 | **이벤트** 사용 |
|---|---|---|
| 사용자의 구독 계획 | `setMetadata('plan', 'pro')` | |
| 사용자가 버튼을 클릭했습니다 | | `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B 테스트 변형 | `setMetadata('ab_variant', 'v2')` | |
| 구매 완료 | | `logEvent('purchase', { amount: 29 })` |
| 사용자의 역할 | `setMetadata('role', 'admin')` | |
| 온보딩 단계 도달 | | `logEvent('onboarding_step', { step: 3 })` |

**경험 법칙:** *사용자가 누구인지* 또는 *현재 상태*를 설명하는 경우 메타데이터를 사용하세요. *일어난 일*을 설명하는 경우 이벤트를 사용하세요.

## 개인 정보 보호 제어

모든 텍스트 입력은 기본적으로 마스크됩니다(`maskAllInputs: true`). 마스크된 필드는 재생 시 빈 입력으로 표시되며 값은 소스에서 캡처되지 않습니다. 비밀번호, 이메일, 전화번호 및 기타 민감한 입력 유형은 이 설정에 관계없이 항상 가려집니다.

### 차단 요소

재생에서 DOM 요소를 완전히 제외하려면(단색 자리 표시자로 표시됨) 다음 중 하나를 추가하세요.

- CSS 클래스: `rr-block`
- 데이터 속성: `data-rj-block` 또는 `data-rejourney-block`
- `blockSelector` 구성 옵션을 통한 사용자 정의 CSS 선택기

```html
<div class="rr-block">This element is fully blocked from replay</div>
<div data-rj-block>Also blocked</div>
```

### 마스킹 텍스트

요소의 텍스트 콘텐츠를 마스킹하려면(텍스트는 바뀌지만 요소의 모양은 계속 표시됨) 다음 중 하나를 추가하세요.

- CSS 클래스: `rr-mask`
- 데이터 속성: `data-rj-mask`, `data-rejourney-mask`, `data-private` 또는 `"password"`를 포함하는 모든 `data-testid`
- `maskTextSelector` 구성 옵션을 통한 사용자 정의 CSS 선택기

```html
<p class="rr-mask">Account balance: $5,000</p>
<span data-private>sensitive@email.com</span>
```

### 요소 무시

요소의 모양을 캡처하지만 모든 상호 작용 이벤트(클릭, 입력)를 억제하려면 다음을 추가하세요.

- CSS 클래스: `rr-ignore`
- 데이터 속성: `data-rj-ignore` 또는 `data-rejourney-ignore`

### 맞춤형 마스킹 기능

프로그래밍 방식 마스킹 논리의 경우 `maskInputFn` 또는 `maskTextFn`를 사용합니다.

```javascript
await Rejourney.init('pk_live_your_public_key', {
  maskInputFn: (value, element) => {
    // Mask only inputs inside a specific form
    if (element.closest('#payment-form')) return '***';
    return value;
  },
});
```

### 사용자 동의 및 GDPR




> [!IMPORTANT]
> **귀하는 데이터 컨트롤러입니다.** Rejourney는 귀하를 대신하여 데이터 프로세서 역할을 합니다. 귀하는 최종 사용자에게 세션 기록에 대한 정보를 제공하고 해당 데이터 처리에 대한 유효한 법적 근거(예: 동의 또는 적법한 이익)가 있는지 확인할 책임이 있습니다.

#### 당신이 해야 할 일

1. **개인정보 보호정책에 세션 녹화를 공개하세요.** 다음과 같은 언어를 포함합니다.

   > * "저희는 제품을 개선하고 마찰을 줄이는 데 도움이 되도록 Rejourney를 사용하여 당사 웹사이트에서 귀하의 활동에 대한 익명화 및 비익명화 세션 재생을 기록합니다. 세션 데이터에는 페이지 상호 작용, 브라우저 정보 및 대략적인 위치가 포함될 수 있습니다. 텍스트 입력 및 민감한 요소는 자동으로 마스킹되며 캡처되지 않습니다."*

2. **동의 후 게이트 녹음**(EEA 사용자에게 권장):

   ```javascript
   // Initialize early — this is safe and does not start recording
   await Rejourney.init('pk_live_your_public_key');

   // Call start() only after the user accepts your privacy policy / consent prompt
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **선택 해제를 존중합니다.** 사용자가 동의를 철회하는 경우 녹음을 중지하고 신원을 삭제합니다.

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### `setConsent`를 통한 세부적인 동의

더 세밀하게 제어하려면 `setConsent`를 사용하여 분석 및 재생을 독립적으로 전환하세요.

```javascript
// Disable visual replay but keep analytics
Rejourney.setConsent({ replay: false });

// Disable everything
Rejourney.setConsent({ analytics: false, replay: false });
```

`analytics: false` 및 `replay: false`를 함께 설정하면 세션이 중지되고 대기 중인 모든 데이터가 지워집니다. `replay: false`만 설정하면 rrweb 레코더가 중지되지만 이벤트 추적은 계속 실행됩니다.

#### 콘솔 로그 캡처

콘솔 로그 캡처는 기본적으로 비활성화되어 있습니다(`trackConsoleLogs: false`). 로깅 방식에 따라 콘솔 로그에 PII가 포함될 수 있으므로 필요한 경우에만 활성화하십시오.

```javascript
await Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: true });
```

#### 지리적 위치

IP 기반 지리적 위치(국가, 지역, 도시)가 기본적으로 수집됩니다. `collectGeoLocation`가 `false`인 경우 SDK는 백엔드에서 IP 지리적 위치 조회를 억제하는 플래그를 전달합니다. 해당 세션에 대해 위치 데이터가 저장되지 않습니다.

```javascript
await Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### 관찰 전용 모드(시각적 녹화 없음)

오류, 장기 작업, 네트워크 활동 및 분석 **없이** 기록 시각적 재생을 캡처하려면 `observeOnly: true`를 설정하십시오.

```javascript
await Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

활성화되면 모든 원격 측정이 수집되지만 rrweb 기록은 실행되지 않습니다. 세션은 재생 페이지에 표시되지 않지만 전체 분석, 오류 및 네트워크 데이터는 계속 캡처됩니다. 사용자가 시각적 녹화를 선택 해제했지만 여전히 관찰 가능성을 원하는 경우에 유용합니다.

> **메모:** 예를 들어 저장된 동의 기본 설정을 기반으로 사용자별로 조건부로 설정할 수 있습니다.
>
> ```javascript
> const noRecording = localStorage.getItem('rj_no_replay') === 'true';
> await Rejourney.init('pk_live_your_public_key', { observeOnly: noRecording });
> ```

#### 봇 감지

봇과 자동화된 브라우저는 기본적으로 무시됩니다(`ignoreBots: true`). Playwright, Puppeteer, Selenium 및 기타 웹 드라이버 기반 클라이언트는 억제됩니다. 자동화 세션을 기록하려면(예: 내부 도구 사용):

```javascript
await Rejourney.init('pk_live_your_public_key', { recordAutomation: true });
```

사용자 정의 봇 탐지 패턴을 제공하려면 다음을 수행하십시오.

```javascript
await Rejourney.init('pk_live_your_public_key', {
  botUserAgentPattern: /my-internal-bot/i,
});
```

#### 네트워크 요청 캡처

네트워크 요청(가져오기 및 XHR)은 기본적으로 가로채서 기록됩니다(`autoTrackNetwork: true`). 요청 및 응답 본문 크기는 기본적으로 **~ 아니다**(`networkCaptureSizes: false`)로 캡처됩니다. URL, 메소드, 상태 코드 및 기간은 항상 캡처됩니다.

특정 URL을 제외하려면:

```javascript
await Rejourney.init('pk_live_your_public_key', {
  networkIgnoreUrls: [
    '/api/health',
    /analytics\.example\.com/,
  ],
});
```

요청을 보내기 전에 필터링하거나 수정하려면 다음 안내를 따르세요.

```javascript
await Rejourney.init('pk_live_your_public_key', {
  beforeSendNetwork: (request) => {
    // Drop requests to internal services
    if (request.url.includes('internal.example.com')) return null;
    return request;
  },
});
```

## 구성 참조

| 옵션 | 유형 | 기본값 | 설명 |
|---|---|---|---|
| `autoStart` | `boolean` | `false` | `init()`가 완료된 후 자동으로 `start()` 호출 |
| `disableInDev` | `boolean` | `false` | `localhost` 및 `127.0.0.1`에서 녹음 억제 |
| `debug` | `boolean` | `false` | 브라우저 콘솔에 대한 자세한 SDK 로깅 활성화 |
| `enabled` | `boolean` | `true` | 마스터 킬 스위치 - 녹화를 방지하려면 `false`로 설정 |
| `observeOnly` | `boolean` | `false` | 시각적 재생 없이 분석/오류/네트워크 캡처 |
| `captureReplay` | `boolean` | `true` | rrweb 시각적 재생 캡처 활성화 |
| `allowedDomains` | `string[]` | `[]` | 특정 도메인으로 녹음을 제한합니다. 비어 있으면 모든 도메인이 허용됨을 의미합니다. `*.example.com` 와일드카드 지원 |
| `maxSessionDuration` | `number` | `1800000` | 최대 세션 길이(밀리초)(기본값: 30분) |
| `collectGeoLocation` | `boolean` | `true` | IP 유래 국가/지역/도시 수집 |
| `captureAttribution` | `boolean` | `true` | 세션 시작 시 UTM 매개변수, 리퍼러 및 항목 URL 캡처 |
| `ignoreBots` | `boolean` | `true` | 감지된 봇 및 웹 드라이버에 대한 녹화 억제 |
| `recordAutomation` | `boolean` | `false` | 극작가/인형사/셀레늄 세션 녹화 허용 |
| `autoTrackRoutes` | `boolean` | `true` | 기록 API를 통해 경로 변경 사항을 자동으로 추적합니다.
| `routeName` | `(location: Location) => string` | — | `window.location`에서 화면 이름을 파생시키는 사용자 정의 함수 |
| `autoTrackNetwork` | `boolean` | `true` | 가져오기/XHR 요청을 가로채서 기록 |
| `networkIgnoreUrls` | `(string \| RegExp)[]` | — | 네트워크 추적에서 제외할 URL |
| `networkCaptureSizes` | `boolean` | `false` | 네트워크 로그에 요청/응답 본문 크기 포함 |
| `trackConsoleLogs` | `boolean` | `false` | `console.log/warn/error` 출력 캡처 |
| `trackLongTasks` | `boolean` | `true` | 긴 작업(JS 스레드 블록 > 50ms) 감지 및 기록 |
| `trackResourceErrors` | `boolean` | `true` | 실패한 리소스 로드 캡처(이미지, 스크립트, 스타일시트) |
| `maskAllInputs` | `boolean` | `true` | 리플레이의 모든 텍스트 입력 값을 마스크합니다 |
| `blockClass` | `string \| RegExp` | `'rr-block'` | 요소의 재생을 완전히 차단하는 CSS 클래스 |
| `blockSelector` | `string` | `'[data-rj-block], [data-rejourney-block]'` | 요소 재생을 완전히 차단하는 CSS 선택기 |
| `ignoreClass` | `string \| RegExp` | `'rr-ignore'` | 요소의 상호 작용 이벤트를 무시하는 CSS 클래스 |
| `ignoreSelector` | `string` | `'[data-rj-ignore], [data-rejourney-ignore]'` | 상호작용 이벤트를 무시하는 CSS 선택기 |
| `maskTextClass` | `string \| RegExp` | `'rr-mask'` | 재생 시 텍스트 내용을 마스크하는 CSS 클래스 |
| `maskTextSelector` | `string` | `'[data-rj-mask], [data-rejourney-mask], [data-private], [data-testid*="password"]'` | 텍스트 내용을 마스크하는 CSS 선택기 |
| `maskInputFn` | `(value, element) => string` | — | 캡처 전에 입력 값을 변환하는 사용자 정의 함수 |
| `maskTextFn` | `(text, element) => string` | — | 캡처 전에 텍스트 내용을 변환하는 사용자 정의 기능 |
| `shouldRecord` | `(context: WebRecordingContext) => boolean` | — | 페이지 로드별 기록 여부를 결정하는 사용자 정의 기능 |
| `beforeSendEvent` | `(event) => event \| null` | — | 이벤트가 대기열에 추가되기 전에 필터링하거나 수정합니다. `null`를 반환하여 드롭 |
| `beforeSendNetwork` | `(request) => request \| null` | — | 대기열에 추가되기 전에 네트워크 항목을 필터링하거나 수정합니다. `null`를 반환하여 드롭 |
| `onAuthError` | `(error) => void` | — | SDK가 백엔드 인증에 실패할 때 호출됩니다. |

## 녹음 중지

`stop()`를 호출하여 세션을 종료하고, 보류 중인 이벤트를 모두 플러시하고, 모든 SDK 리스너를 정리합니다.

```javascript
import { Rejourney } from '@rejourneyco/browser';

await Rejourney.stop();
```

`stop()`는 여러 번 호출해도 안전합니다. 중지한 후 `start()`를 다시 호출하여 새 세션을 시작합니다.

## 세션 ID

현재 세션 ID에 액세스하여 Rejourney 세션을 자체 로그 또는 지원 도구와 연관시키십시오.

```javascript
const sessionId = Rejourney.getSessionId();
// e.g. pass to your error reporter
Sentry.setTag('rejourney_session', sessionId);
```

활성 세션이 없으면 `null`를 반환합니다.

## 상태 도우미

```typescript
Rejourney.isInitialized(): boolean  // true after init() has been called
Rejourney.isRecording(): boolean    // true if an active session exists
```
