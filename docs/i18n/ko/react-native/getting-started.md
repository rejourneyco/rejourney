<!-- AI_PROMPT_SECTION -->
**Cursor, Claude 또는 ChatGPT를 사용하시나요?** 통합 프롬프트를 복사하여 AI 어시스턴트에 붙여넣어 설정 코드를 자동 생성하세요.

<!-- /AI_PROMPT_SECTION -->

## 설치

npm 또는 yarn를 사용하여 프로젝트에 Rejourney 패키지를 추가합니다.

```bash
npm install @rejourneyco/react-native
```

> [!NOTE]
> Rejourney에는 네이티브 코드가 필요하며 Expo Go와 호환되지 않습니다. 개발 빌드 사용:
> 
> ```bash
> npx expo run:ios
> npx expo run:android
> ```


## 3라인 설정

앱 상단(예: App.tsx 또는 index.js)에서 Rejourney를 초기화하고 시작합니다.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

Rejourney.init('pk_live_your_public_key');
Rejourney.start();
```

공급자 래핑이 필요하지 않습니다. 녹음이 즉시 시작됩니다.

## 원격 녹화 설정

프로젝트 설정은 새로운 앱 빌드를 출시하지 않고도 React Native 기록 기본값을 제어할 수 있습니다. 지원되는 SDK 버전은 세션 시작 시 원격 녹화 FPS 설정을 읽습니다. 기본값은 1FPS이고 프로젝트 관리자는 1, 2 또는 3FPS를 선택할 수 있습니다. 원격 구성을 사용할 수 없는 경우 SDK는 로컬/기본 캡처 동작으로 대체됩니다.

## 화면 추적

Rejourney는 자동으로 화면 변경 사항을 추적하므로 재생 중에 사용자가 앱에서 어디에 있는지 확인할 수 있습니다. 탐색 라이브러리와 일치하는 설정을 선택하십시오.

### Expo Router(자동)

**Expo Router** 를 사용하면 화면 추적이 즉시 작동합니다. 추가 코드가 필요하지 않습니다.




> [!TIP]
> **사용자 정의 화면 이름을 사용하시나요?** Expo Router를 사용하지만 자신만의 화면 이름을 수동으로 제공하려면 아래의 [사용자 정의 화면 이름](#custom-screen-names) 섹션을 참조하세요.

---

### React Navigation

**React Navigation**(`@react-navigation/native`)를 사용하는 경우 루트 `NavigationContainer`에서 `useNavigationTracking` 후크를 사용합니다.

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

### 사용자 정의 화면 이름

화면 이름을 수동으로 지정하려면(예: 분석 일관성을 위해 또는 위의 라이브러리를 사용하지 않는 경우) `trackScreen` 메서드를 사용하세요.

#### Expo Router 사용자의 경우:
Expo Router에서 사용자 정의 이름을 사용하려면 먼저 구성에서 자동 추적을 비활성화해야 합니다.

```javascript
Rejourney.init('pk_live_your_public_key', {
  autoTrackExpoRouter: false
});
```

#### 수동 추적 통화:
화면 변경이 발생할 때마다 `trackScreen`를 호출합니다.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

// Call this in your screen component or navigation listener
Rejourney.trackScreen('Checkout Page');
```

## 사용자 식별

세션을 내부 사용자 ID와 연결하여 대시보드에서 특정 사용자를 필터링하고 검색하세요.

```javascript
import { Rejourney } from '@rejourneyco/react-native';

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

### 메타데이터와 이벤트를 사용해야 하는 경우

| 사용 사례 | **메타데이터** 사용 | **이벤트** 사용 |
|---|---|---|
| 사용자의 구독 계획 |  `setMetadata('plan', 'pro')` | |
| 사용자가 버튼을 클릭했습니다 | |  `logEvent('button_clicked', { buttonName: 'signup' })` |
| A/B 테스트 변형 |  `setMetadata('ab_variant', 'v2')` | |
| 구매 완료 | |  `logEvent('purchase', { amount: 29 })` |
| 사용자의 역할 |  `setMetadata('role', 'admin')` | |
| 온보딩 단계 도달 | |  `logEvent('onboarding_step', { step: 3 })` |

**경험 법칙:** *사용자가 누구인지* 또는 *현재 상태*를 설명하는 경우 메타데이터를 사용하세요. *일어난 일*을 설명하는 경우 이벤트를 사용하세요.

## 개인 정보 보호 제어

텍스트 입력 및 카메라 뷰는 기본적으로 자동으로 마스크됩니다. 프로젝트 관리자는 지원되는 SDK 버전에 대해 프로젝트 설정에서 기본 텍스트 입력 마스킹 수준을 변경할 수 있습니다. 이전 SDK 버전은 해당 원격 설정을 무시하고 기존 마스킹 동작을 유지합니다. 보안/비밀번호 필드, 카메라 보기 및 명시적 마스크는 보호된 상태로 유지됩니다.

추가적인 민감한 UI를 수동으로 숨기려면 `Mask` 구성 요소에 구성 요소를 래핑합니다.

```javascript
import { Mask } from '@rejourneyco/react-native';

<Mask>
  <Text>Account balance: $5,000</Text>
</Mask>
```

마스크된 콘텐츠는 리플레이에서 단색 직사각형으로 표시되며 소스에서 캡처되지 않습니다.

### 사용자 동의 및 GDPR




> [!IMPORTANT]
> **귀하는 데이터 컨트롤러입니다.** Rejourney는 귀하를 대신하여 데이터 프로세서 역할을 합니다. 귀하는 최종 사용자에게 세션 기록에 대한 정보를 제공하고 해당 데이터 처리에 대한 유효한 법적 근거(예: 동의 또는 적법한 이익)가 있는지 확인할 책임이 있습니다.

#### 당신이 해야 할 일

1. **앱의 개인정보 보호정책에 세션 기록을 공개하세요.** 다음과 같은 언어를 포함합니다.

   > * "저희는 Rejourney를 사용하여 앱 내 활동의 익명화 및 비익명화 세션 재생을 기록하여 제품을 개선하고, 충돌 및 문제를 추적하고, 제품 마찰을 줄이는 데 도움을 줍니다. 세션 데이터에는 화면 상호 작용, 장치 정보 및 대략적인 위치가 포함될 수 있습니다. 텍스트 입력 및 민감한 UI 요소는 자동으로 마스크되고 캡처되지 않습니다."*

2. **동의 후 게이트 녹음**(EEA 사용자에게 권장):

   ```javascript
   // Only start recording after the user accepts your privacy policy / consent prompt
   Rejourney.init('pk_live_your_public_key');

   // Call this after consent is confirmed
   function onUserConsented() {
     Rejourney.start();
   }
   ```

3. **참여 거부를 존중하세요.** 사용자가 동의를 철회하는 경우 녹음을 중지하고 데이터를 삭제합니다.

   ```javascript
   Rejourney.stop();
   Rejourney.clearUserIdentity();
   ```

#### 콘솔 로그 캡처

콘솔 로그 캡처는 기본적으로 활성화됩니다(`trackConsoleLogs: true`). 콘솔 로그에는 앱의 로깅 방식에 따라 PII가 포함될 수 있습니다. 민감한 데이터가 로그에 나타날 수 있는 경우 비활성화하십시오.

```javascript
Rejourney.init('pk_live_your_public_key', { trackConsoleLogs: false });
```

#### 지리적 위치

IP 기반 지리적 위치(국가, 지역, 도시)가 기본적으로 수집됩니다. `collectGeoLocation`가 `false`인 경우 SDK는 백엔드에서 IP 지리적 위치 조회를 억제하는 플래그를 기본 계층에 전달합니다. 해당 세션에 대해서는 위치 데이터가 저장되지 않습니다. 위치 데이터가 필요하지 않거나 EEA 사용자에 대한 데이터 수집을 최소화하려면 이 기능을 비활성화하세요.

```javascript
Rejourney.init('pk_live_your_public_key', { collectGeoLocation: false });
```

#### 기본 시트

지원되는 SDK 버전의 경우 기본 시트 캡처가 기본적으로 활성화됩니다(`captureNativeSheets: true`). 이를 통해 OS에서 캡처를 허용할 때 결제 승인 모달과 같은 앱 소유 기본 시트 및 대화 상자가 디버깅 재생에 나타날 수 있습니다. 기본적으로 텍스트 입력이 마스크되면 키보드/텍스트 입력 시스템 시트가 제외됩니다. 텍스트 입력 마스킹이 보안 필드로만 설정된 경우 키보드는 최선의 노력을 다할 뿐이며 특히 OS가 키보드를 보호된 표면 또는 원격 표면으로 렌더링하는 경우 안정적으로 캡처할 수 없습니다. OS 공유 시트는 최선을 다한 것이며 시스템이 이를 보호된 표면이나 원격 표면으로 렌더링할 때 안정적으로 캡처할 수 없습니다.

시각적 재생을 기본 앱 창으로 제한하려면 기본 시트 캡처를 비활성화하세요.

```javascript
Rejourney.init('pk_live_your_public_key', { captureNativeSheets: false });
```

#### 관찰 전용 모드(시각적 녹화 없음)

오류, 충돌, ANRs 및 네트워크 활동 **없이** 기록 시각적 재생을 캡처하려면 `observeOnly: true`를 설정합니다.

```javascript
Rejourney.init('pk_live_your_public_key', { observeOnly: true });
```

활성화하면 모든 원격 측정이 수집되지만 스크린샷은 찍히지 않습니다. 세션은 리플레이 페이지에 표시되지 않지만 전체 분석/오류/네트워크/충돌 데이터가 있습니다. 재생이 없습니다. 이는 사용자가 화면 녹화를 선택 해제했지만 여전히 오류 표시를 원하는 경우에 유용합니다.

> **메모:** 이는 예를 들어 저장된 기본 설정 또는 동의 플래그를 기반으로 사용자별로 조건부로 설정할 수 있습니다.
>
> ```javascript
> const userOptedOutOfRecording = await getUserPreference('noRecording');
> Rejourney.init('pk_live_your_public_key', { observeOnly: userOptedOutOfRecording });
> ```
