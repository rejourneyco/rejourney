<!-- AI_PROMPT_SECTION -->
**Cursor, Claude 또는 ChatGPT를 사용하시나요?** 통합 프롬프트를 복사하여 AI 어시스턴트에 붙여넣어 설정 코드를 자동 생성하세요.

<!-- /AI_PROMPT_SECTION -->

## 설치

### Swift Package Manager

**파일 → 패키지 종속성 추가** 를 통해 Xcode에 Rejourney 패키지를 추가하고 다음을 입력합니다.

```
https://github.com/rejourneyco/rejourney
```

또는 `Package.swift`에 직접 추가하세요.

```swift
dependencies: [
    .package(url: "https://github.com/rejourneyco/rejourney", from: "0.2.0")
],
targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "Rejourney", package: "rejourney")
        ]
    )
]
```

> [!NOTE]
> Rejourney에는 iOS 15.1 이상이 필요합니다.

## Swift 설정

`@main` 앱 구조체에서 Rejourney를 초기화하고 시작합니다.

```swift
import SwiftUI
import Rejourney

@main
struct MyApp: App {

    @MainActor
    init() {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

`UIApplicationDelegate`를 사용하는 경우 `application(_:didFinishLaunchingWithOptions:)`에서 `configure`를 호출합니다.

```swift
import UIKit
import Rejourney

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    @MainActor
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
        return true
    }
}
```

`start()`가 해결되는 즉시 녹화가 시작됩니다. 필요한 경우 결과를 확인할 수 있습니다.

```swift
let result = await Rejourney.start()
if result.success, let sessionId = result.sessionId {
    print("Recording started — session: \(sessionId)")
}
```

## 원격 녹화 설정

프로젝트 설정은 새로운 앱 빌드를 출시하지 않고도 Swift 기록 기본값을 제어할 수 있습니다. 지원되는 SDK 버전은 `start()`가 호출될 때 다음 설정을 읽습니다.

| 설정 | 행동 |
|---|---|
| 샘플링 속도 | 기본값은 `100%`입니다. 샘플링된 세션은 정상적으로 캡처됩니다. 샘플링된 세션은 재생 캡처, 네트워크 차단, 업로드 또는 기타 패키지 작업이 시작되기 전에 반환됩니다. |
| 최대 관찰 가능 기간 | 각 관찰 세션의 최대 길이를 제한합니다. |
| FPS 녹화 | 기본값은 `1 FPS`입니다. 프로젝트 관리자는 `1`, `2` 또는 `3 FPS`를 선택할 수 있습니다. 원격 구성을 사용할 수 없는 경우 SDK는 로컬/기본 캡처 동작으로 대체됩니다. |
| 텍스트 입력 개인정보 보호 | 모든 텍스트 입력을 마스킹하는 것이 기본값입니다. 보안 전용 모드는 비밀번호/보안 필드를 마스크된 상태로 유지하고 디버깅 재생에 다른 텍스트 입력이 표시되도록 허용합니다. |

## 화면 추적

Rejourney는 SwiftUI 탐색에 자동으로 연결되지 않으므로 사용자가 새 화면으로 이동할 때마다 `trackScreen`를 호출하세요.

### SwiftUI

`.onAppear` 또는 탐색 인식 수정자를 사용하십시오.

```swift
struct CountriesListView: View {
    var body: some View {
        List { /* ... */ }
            .onAppear {
                Rejourney.trackScreen("Countries List")
            }
    }
}
```

### UIKit

`viewDidAppear` 내에서 `trackScreen`를 호출합니다.

```swift
override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Rejourney.trackScreen("Checkout")
}
```

### NavigationPath / NavigationStack

탐색 경로를 관찰하고 변경 사항을 추적합니다.

```swift
@State private var path = NavigationPath()

NavigationStack(path: $path) {
    ContentView()
}
.onChange(of: path) { _ in
    // derive screen name from path and call trackScreen
    Rejourney.trackScreen(currentScreenName(from: path))
}
```

## 사용자 식별

대시보드에서 특정 사용자를 찾을 수 있도록 세션을 자신의 사용자 ID와 연결하세요.

```swift
import Rejourney

// After login
Rejourney.identify("user_abc123")

// On logout
Rejourney.clearIdentity()
```

> [!IMPORTANT]
> **은둔:** 내부 ID 또는 UUID를 사용합니다. PII(이메일, 전화)를 사용해야 하는 경우 전달하기 전에 해시하세요.

ID는 `UserDefaults`를 통해 앱을 시작할 때마다 유지됩니다. 모든 앱을 열 때마다가 아니라 로그인당 한 번만 `identify`를 호출하면 됩니다.

## 맞춤 이벤트

의미 있는 사용자 작업을 추적하여 동작을 이해하고, 문제를 디버깅하고, 대시보드에서 세션 재생을 필터링합니다.

### 기본 사용법

```swift
import Rejourney

// Simple event (name only)
Rejourney.logEvent("signup_completed")

// Event with properties
Rejourney.logEvent("button_tapped", properties: ["buttonName": "get_started"])
```

### API

```swift
Rejourney.logEvent(_ name: String, properties: [String: RejourneyMetadataValue] = [:])
```

| 매개변수 | 유형 | 필수 | 설명 |
|---|---|---|---|
| `name` | `String` | 예 | 이벤트 이름 — 일관성을 위해 `snake_case` 사용 |
| `properties` | `[String: RejourneyMetadataValue]` | 아니요 | 이 이벤트에 연결된 키-값 쌍 |

`RejourneyMetadataValue`는 Swift 리터럴을 직접 허용합니다. — 래핑이 필요하지 않습니다.

```swift
Rejourney.logEvent("purchase_completed", properties: [
    "plan":     "pro",       // String literal
    "amount":   29.99,       // Double literal
    "quantity": 1,           // Int literal
    "trial":    false        // Bool literal
])
```

### 예

```swift
// E-commerce
Rejourney.logEvent("purchase_completed", properties: [
    "plan": "pro",
    "amount": 29.99,
    "currency": "USD"
])

// Onboarding
Rejourney.logEvent("onboarding_step", properties: [
    "step": 3,
    "stepName": "profile_setup",
    "skipped": false
])

// Feature usage
Rejourney.logEvent("feature_used", properties: [
    "feature": "dark_mode",
    "enabled": true
])

// Errors / edge cases
Rejourney.logEvent("payment_failed", properties: [
    "errorCode": "card_declined",
    "retryCount": 2
])
```

### 대시보드에 이벤트가 표시되는 방식

사용자 정의 이벤트는 세션별로 저장되며 다음 두 위치에서 볼 수 있습니다.

1. **세션 재생 타임라인** — 이벤트는 재생 타임라인에 마커로 표시되므로 작업이 발생한 정확한 순간으로 이동할 수 있습니다.
2. **세션 보관 필터** — 다음을 기준으로 세션 목록을 필터링합니다.
   - **이벤트 이름** — 특정 이벤트(예: `purchase_completed`)가 포함된 모든 세션을 찾습니다.
   - **이벤트 수** — 특정 수의 사용자 정의 이벤트가 있는 세션 찾기

### 모범 사례




> [!TIP]
> - 일관된 이름 사용(`snake_case`, 예: `Button Tapped`가 아닌 `button_tapped`)
> - 속성 값을 단순하게 유지하십시오(문자열, 숫자, 부울) - 깊게 중첩된 객체를 피하십시오.
> - 디버깅이나 분석에 중요한 작업에 집중하세요. 모든 것을 기록하지 마세요.

## 개인 정보 보호 제어

텍스트 입력 및 카메라 뷰는 기본적으로 자동으로 마스크됩니다. 프로젝트 관리자는 지원되는 SDK 버전에 대한 프로젝트 설정에서 기본 텍스트 입력 마스킹 수준을 변경할 수 있습니다. 보안/비밀번호 필드, 카메라 보기 및 명시적 마스크는 보호된 상태로 유지됩니다.

민감한 추가 보기를 숨기려면 `mask` 및 `unmask` API를 사용하세요.

```swift
import UIKit
import Rejourney

// Mask a view — appears as a solid rectangle in replays
Rejourney.mask(balanceLabel)

// Remove masking if needed
Rejourney.unmask(balanceLabel)
```

SwiftUI의 경우 `UIViewRepresentable` 래퍼 또는 `introspect`를 통해 기본 `UIView`를 가져옵니다.

#### 기본 시트

기본 시트 캡처는 기본적으로 활성화됩니다(`captureNativeSheets: true`). 이를 통해 OS에서 캡처를 허용할 때 결제 승인 모달과 같은 앱 소유 기본 시트 및 대화 상자가 디버깅 재생에 나타날 수 있습니다. 기본적으로 텍스트 입력이 마스크되면 키보드/텍스트 입력 시스템 시트가 제외됩니다. 텍스트 입력 마스킹이 보안 필드로만 설정된 경우 키보드는 최선의 노력을 다할 뿐이며 iOS가 키보드를 보호된 시스템 표면 또는 원격 시스템 표면으로 렌더링할 수 있으므로 안정적으로 캡처할 수 없습니다. OS 공유 시트는 최선을 다한 것이며 시스템이 이를 보호된 표면이나 원격 표면으로 렌더링할 때 안정적으로 캡처할 수 없습니다.

시각적 재생을 기본 앱 창으로 제한하려면 기본 시트 캡처를 비활성화하세요.

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(captureNativeSheets: false)
)
```

### 사용자 동의 및 GDPR




> [!IMPORTANT]
> **귀하는 데이터 컨트롤러입니다.** Rejourney는 귀하를 대신하여 데이터 프로세서 역할을 합니다. 귀하는 최종 사용자에게 세션 기록에 대한 정보를 제공하고 해당 데이터 처리에 대한 유효한 법적 근거(예: 동의 또는 적법한 이익)가 있는지 확인할 책임이 있습니다.

#### 당신이 해야 할 일

1. **앱의 개인정보 보호정책에 세션 기록을 공개하세요.** 다음과 같은 언어를 포함합니다.

   > * "저희는 Rejourney를 사용하여 앱 내 활동의 익명화 및 비익명화 세션 재생을 기록하여 제품을 개선하고, 충돌 및 문제를 추적하고, 제품 마찰을 줄이는 데 도움을 줍니다. 세션 데이터에는 화면 상호 작용, 장치 정보 및 대략적인 위치가 포함될 수 있습니다. 텍스트 입력 및 민감한 UI 요소는 자동으로 마스크되고 캡처되지 않습니다."*

2. **동의 후 게이트 녹음**(EEA 사용자에게 권장):

   ```swift
   // Configure early — before consent is known
   Rejourney.configure(publicKey: "rj_your_public_key")

   // Call start() only after the user accepts your privacy policy
   func onUserConsented() {
       Task { @MainActor in
           await Rejourney.start()
       }
   }
   ```

3. **참여 거부를 존중하세요.** 사용자가 동의를 철회하는 경우 녹음을 중지하고 신원을 삭제합니다.

   ```swift
   func onUserOptedOut() {
       Task { @MainActor in
           await Rejourney.stop()
           Rejourney.clearIdentity()
       }
   }
   ```

#### 관찰 전용 모드(시각적 녹화 없음)

오류, 충돌, ANRs 및 네트워크 활동 **없이** 기록 시각적 재생을 캡처하려면 `observeOnly: true`를 설정합니다.

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(observeOnly: true)
)
```

활성화하면 모든 원격 측정이 수집되지만 스크린샷은 찍히지 않습니다. 세션은 재생 페이지에 표시되지 않지만 전체 분석, 오류, 네트워크 및 충돌 데이터는 계속 캡처됩니다. 사용자가 화면 녹화를 선택 해제했지만 여전히 오류 표시를 원하는 경우에 유용합니다.

> **메모:** 이는 저장된 기본 설정 또는 동의 플래그를 기반으로 사용자별로 조건부로 설정할 수 있습니다.
>
> ```swift
> let optedOut = UserDefaults.standard.bool(forKey: "noRecording")
> Rejourney.configure(
>     publicKey: "rj_your_public_key",
>     options: RejourneyOptions(observeOnly: optedOut)
> )
> ```

#### 네트워크 캡처

네트워크 요청 캡처(기본적으로 `autoTrackNetwork: true`)는 사용자 지정 `URLProtocol`를 통해 `URLSession` 트래픽을 가로챕니다. 네트워크 데이터를 수집하지 않으려면 비활성화하세요.

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(autoTrackNetwork: false)
)
```

#### 지리적 위치

IP 기반 지리적 위치(국가, 지역, 도시)가 기본적으로 수집됩니다. 조회를 완전히 억제하려면 비활성화하십시오.

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(collectGeoLocation: false)
)
```

## 구성 참조

모든 옵션은 `configure`에서 한 번 설정되며 `start`가 호출된 후에는 변경할 수 없습니다.

```swift
Rejourney.configure(
    publicKey: "rj_your_public_key",
    options: RejourneyOptions(
        apiURL:             URL(string: "https://api.rejourney.co")!,
        userId:             nil,
        enabled:            true,
        observeOnly:        false,
        captureFPS:         nil,
        captureQuality:     .medium,
        wifiOnly:           false,
        captureScreen:      true,
        captureAnalytics:   true,
        captureCrashes:     true,
        captureANR:         true,
        trackConsoleLogs:   true,
        collectGeoLocation: true,
        autoTrackNetwork:   true,
        captureNativeSheets: true,
        debug:              false
    )
)
```

| 옵션 | 유형 | 기본값 | 설명 |
|---|---|---|---|
| `apiURL` | `URL` | `https://api.rejourney.co` | 자체 호스팅 배포 재정의 |
| `userId` | `String?` | `nil` | 선택적 초기 내부 사용자 ID |
| `enabled` | `Bool` | `true` | 마스터 킬 스위치 — SDK를 완전히 비활성화하려면 `false`로 설정 |
| `observeOnly` | `Bool` | `false` | 원격 분석만 수집하고 시각적 기록은 사용하지 않음 |
| `captureFPS` | `Int?` | `nil` | 선택적 로컬 캡처 FPS 대체. 가능한 경우 원격 프로젝트 설정 녹화 FPS가 우선 적용됩니다 |
| `captureQuality` | `RejourneyCaptureQuality` | `.medium` | JPEG 캡처 품질(`.low`, `.medium`, `.high`) |
| `wifiOnly` | `Bool` | `false` | Wi-Fi에서만 세션 데이터 업로드 |
| `captureScreen` | `Bool` | `true` | 시각적 화면 캡처 활성화/비활성화 |
| `captureAnalytics` | `Bool` | `true` | 분석 이벤트 수집 활성화/비활성화 |
| `captureCrashes` | `Bool` | `true` | 충돌 보고 활성화/비활성화 |
| `captureANR` | `Bool` | `true` | ANR(앱이 응답하지 않음) 감지 활성화/비활성화 |
| `trackConsoleLogs` | `Bool` | `true` | 세션에 대한 콘솔 로그 캡처 |
| `collectGeoLocation` | `Bool` | `true` | IP 기반 위치정보 수집 |
| `autoTrackNetwork` | `Bool` | `true` | 네트워크 캡처에 대한 `URLSession` 요청 차단 |
| `captureNativeSheets` | `Bool` | `true` | iOS가 캡처를 허용하는 경우 시각적 재생에 앱 소유 기본 시트/대화 상자 창을 포함합니다. OS 공유 시트 및 키보드는 보호되거나 원격 표면일 수 있으며 안정적으로 캡처할 수 없습니다 |
| `debug` | `Bool` | `false` | 자세한 SDK 로그를 콘솔에 인쇄 |

## 녹음 중지

현재 세션을 중지하고 보류 중인 데이터를 플러시합니다.

```swift
let result = await Rejourney.stop()
print("Session \(result.sessionId ?? "unknown") ended — uploaded: \(result.uploadSuccess)")
```

비동기 컨텍스트가 아닌 경우 콜백 변형을 사용할 수 있습니다.

```swift
Rejourney.stop { result in
    print("Stopped: \(result.success)")
}
```

## 세션 ID

언제든지 현재 세션 ID에 액세스하여 자체 로그 또는 지원 도구와 연관시키십시오.

```swift
if let sessionId = Rejourney.currentSessionId {
    print("Rejourney session: \(sessionId)")
}
```
