# Unity SDK

The 0.1.0 implementation is under validation. See the package verification report before production adoption.


## Install and configure

Install `co.rejourney.unity-0.1.0.tgz` through UPM. The archive includes an iOS
XCFramework and Android AAR. UPM resolves Newtonsoft JSON and Mono.Cecil. Keep
`Rejourney.Runtime` in assemblies that call the public API. Optional uGUI and
Input System assemblies activate through package version defines; remove their
folders if those integrations are not desired.

Use Project Settings → Rejourney to prepare local configuration. That page
writes `ProjectSettings/Rejourney.local.json`; ignore it in version control and
copy the configuration into your app bootstrap explicitly. The page never
starts a session. The example instead accepts an ignored
`Assets/Resources/RejourneyLocal.json`:

```json
{"publicProjectKey":"YOUR_CLOUD_PUBLIC_KEY","apiUrl":"https://api.rejourney.co"}
```

Call `Init` once on the Unity thread. After consent, await `StartAsync` and inspect
`StartResult.State`: Recording, TelemetryOnly, Disabled, AuthenticationFailed,
Unsupported or Error. No SDK operation requires an account credential.
`Init` with another project while active fails; await `StopAsync` first. Calls
before initialization are safe. Native recovery remains bound to its original
project and endpoint and cannot use a replacement project's upload token.

Use `SetUserIdentity`, `ClearUserIdentity`, `SetMetadata`, `AddSessionTag`,
`LogFeedback`, `LogEvent`, `TrackScreen`, `CaptureException`, and
`LogNetworkRequest` as needed. Developer-supplied event properties, identities,
feedback and logs must contain no sensitive input. Automatic UI capture does not
read field text into events. `RejourneyScreen` tracks panels; active scene changes
are automatic. Add `RejourneyTarget` only with static, non-sensitive identifiers.

`PauseAsync` preserves the foreground session and records a gap. `ResumeAsync`
continues it. Background intervals of 60 seconds or more roll over the session.
`FlushAsync` and `StopAsync` distinguish Delivered from Queued and Failed.
Queued requires a durable native retry entry; it is not a server acknowledgment.
A failed or timed-out drain may still have work in flight. Events not yet sealed
in the native spool are lost on abrupt process death.

## Privacy and capture

Replay defaults to 1 FPS, a 960-pixel maximum dimension and JPEG quality 50.
The cloud governs 1–3 FPS, text masking and media masking. Password fields are
always masked. uGUI/InputField, TMP_InputField and UI Toolkit TextField geometry
is collected before GPU readback. Add `RejourneyMask` to sensitive UI subtrees or
world objects, or call `Mask(gameObject)` / `Unmask(gameObject)`.

Unresolvable geometry, excessive mask counts, and an all-media cloud policy
suppress frames. The all-media policy currently suppresses the entire Unity
viewport because arbitrary game-rendered media cannot be safely classified.
This is visible in privacy-drop diagnostics. A black scene is valid footage.

Coordinates use a top-left origin in the Unity viewport, in pixels. Semantic
snapshots include viewport size, mask rectangles, and at most 128 explicitly
registered targets. They omit arbitrary scene text. GPU and encode queues have
one job in flight; native frame and hierarchy delivery each have one pending
job. Backpressure drops are separate from capture failures. A synchronous
readback fallback is limited to 480 pixels and reported as degraded.

Pause around system keyboards, payment/ad/native plugin overlays, and other
surfaces outside Unity's rendered frame. XR and arbitrary native overlays are
outside this release's capture guarantee.

## Automatic HTTP coverage

Player compilation rewrites ordinary UnityWebRequest.SendWebRequest and
Dispose calls, plus the three HttpClient constructors. Coroutines, async state
machines and nested classes are included. The original operation, custom
handler, cancellation, certificate behavior and disposal ownership are retained.
HttpClient timing ends when its handler returns the response; response byte
counts use Content-Length when available. Request/response bodies and headers
are not collected. URLs omit credentials, query values and fragments. The
configured Rejourney API host is excluded; SDK native transport is not woven.

Reports are in `Library/Rejourney/NetworkReports`. Instrumentation failures fail
the player build. `[RejourneyNetworkExclude]` excludes assemblies/classes/methods;
`REJOURNEY_DISABLE_AUTO_NETWORK` disables weaving for the build. Precompiled DLLs,
reflection-created calls, native libraries, WebSockets, multiplayer transports,
and Unity engine assemblies are outside automatic coverage. Use
`LogNetworkRequest` for those paths. Never weaken TLS or replace game handlers
just to enable telemetry.

## Native builds and stripping

Consumers use the included binaries. Maintainers run `Tools~/build-native.sh`
with Xcode and Unity Android Build Support installed. Xcode processing keeps
Swift runtime embedding and linker settings; the AAR build processor adds the
explicit AndroidX/OkHttp/coroutine dependencies. Android UI work always uses the
main looper, including under GameActivity. IL2CPP preservation lives in link.xml.

Keep symbols from your own release builds. The SDK reports managed stacks and
native facts available from platform recovery or a signal marker. It does not
provide full native symbolication. Use deliberate native probes only from
Development builds and without an attached debugger.
