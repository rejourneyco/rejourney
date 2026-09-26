import Foundation
import UIKit

private let responseLock = NSLock()
private var responses: [String] = []
private var hierarchyPending = false
private var queuedHierarchy: (session: String, payload: Data, timestamp: UInt64)?
// Unity sends a snapshot only when its content changes, so one arriving while an
// upload is in flight must not be dropped: keep the newest and send it next.
// Main thread only; uploads are route-bound to the snapshot's own session.
private func transmitHierarchy(_ session: String, _ payload: Data, _ timestamp: UInt64) {
    if hierarchyPending { queuedHierarchy = (session, payload, timestamp); return }
    hierarchyPending = true
    SegmentDispatcher.shared.transmitHierarchy(replayId: session, hierarchyPayload: payload, timestampMs: timestamp) { _ in
        DispatchQueue.main.async {
            hierarchyPending = false
            if let next = queuedHierarchy { queuedHierarchy = nil; transmitHierarchy(next.session, next.payload, next.timestamp) }
        }
    }
}
private var frameDispatchPending = false
private func reply(_ id: Int, _ value: [String: Any]) {
    var object = value; object["id"] = id
    guard let bytes = try? JSONSerialization.data(withJSONObject: object), let json = String(data: bytes, encoding: .utf8) else { return }
    responseLock.lock()
    if responses.count >= 256 { responses.removeFirst() }
    responses.append(json); responseLock.unlock()
}
@_cdecl("rj_unity_poll")
public func rjUnityPoll() -> UnsafeMutablePointer<CChar>? {
    responseLock.lock(); defer { responseLock.unlock() }
    guard !responses.isEmpty else { return nil }
    return strdup(responses.removeFirst())
}
@_cdecl("rj_unity_free")
public func rjUnityFree(_ pointer: UnsafeMutableRawPointer?) { free(pointer) }
@_cdecl("rj_unity_request")
public func rjUnityRequest(_ pointer: UnsafePointer<CChar>?) {
    guard let pointer, let data = String(cString: pointer).data(using: .utf8),
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = request["id"] as? Int, let command = request["command"] as? String else { return }
    Task { @MainActor in
        let payload = request["payload"] as? [String: Any] ?? [:]
        switch command {
        case "configure":
            let options = RejourneyOptions(
                apiURL: URL(string: payload["apiUrl"] as? String ?? "https://api.rejourney.co")!,
                enabled: payload["enabled"] as? Bool ?? true,
                observeOnly: payload["observeOnly"] as? Bool ?? false,
                captureFPS: payload["fps"] as? Int ?? 1,
                captureAnalytics: false,
                captureCrashes: payload["captureCrashes"] as? Bool ?? true,
                captureANR: payload["captureANR"] as? Bool ?? true,
                trackConsoleLogs: false,
                collectDeviceInfo: payload["collectDeviceInfo"] as? Bool ?? true,
                collectGeoLocation: payload["collectGeoLocation"] as? Bool ?? true, autoTrackNetwork: false, captureNativeSheets: false,
                detectRageTaps: false, debug: payload["debug"] as? Bool ?? false)
            Rejourney.configure(publicKey: payload["publicKey"] as? String ?? "", options: options)
            ReplayOrchestrator.shared.hierarchyCaptureEnabled = false
            TelemetryPipeline.shared.setExternalRuntimeMetadata(payload["runtime"] as? [String: Any] ?? [:])
            reply(id, ["success": true])
        case "start":
            let result = await Rejourney.start()
            var status = unityStatus(); status["success"] = result.success; status["error"] = result.error
            reply(id, status)
        case "status": reply(id, unityStatus())
        case "stop":
            await withCheckedContinuation { continuation in VisualCapture.shared.afterPendingFrames { continuation.resume() } }
            let result = await Rejourney.stop()
            // Existing uploadSuccess also accepts safely queued retries; do not call it server delivery.
            var delivery = SegmentDispatcher.shared.externalDeliveryStatus()
            if !result.success || !result.uploadSuccess {
                delivery["success"] = false; delivery["delivered"] = false
                delivery["error"] = "session_end_or_upload_failed"
            }
            reply(id, delivery)
        case "pause":
            let keepFatalRecovery = StabilityMonitor.shared.isMonitoring
            let paused = Rejourney.pause()
            // Unity pause suspends routine telemetry but retains fatal recovery.
            // Other SDKs keep their existing pause behavior in the shared core.
            if paused && keepFatalRecovery { StabilityMonitor.shared.activate() }
            reply(id, ["success": paused])
        case "resume": reply(id, ["success": Rejourney.resume()])
        case "flush":
            VisualCapture.shared.afterPendingFrames {
                TelemetryPipeline.shared.flushExternal { reply(id, SegmentDispatcher.shared.externalDeliveryStatus()) }
            }
        case "identify":
            let identity = payload["identity"] as? String ?? ""
            if identity.isEmpty { Rejourney.clearIdentity() } else { Rejourney.identify(identity) }
            reply(id, ["success": true])
        case "metadata":
            if let key = payload["key"] as? String { Rejourney.setMetadata(key, metadataValue(payload["value"])) }
            reply(id, ["success": true])
        case "screen": Rejourney.trackScreen(payload["name"] as? String ?? ""); reply(id, ["success": true])
        case "events":
            for event in request["payload"] as? [[String: Any]] ?? [] {
                guard let session = event["sessionId"] as? String else { continue }
                TelemetryPipeline.shared.recordExternalEvent(event, sessionId: session)
                if session == Rejourney.currentSessionId, event["type"] as? String == "screen_view", let name = event["screen"] as? String {
                    ReplayOrchestrator.shared.logScreenView(name)
                }
            }
            reply(id, ["success": true])
        case "hierarchy":
            if let sid = payload["sessionId"] as? String, sid == Rejourney.currentSessionId,
               let timestamp = payload["timestamp"] as? UInt64, let snapshot = payload["snapshot"],
               let data = try? JSONSerialization.data(withJSONObject: snapshot), let gzip = data.gzipCompress() {
                transmitHierarchy(sid, gzip, timestamp)
            }
            reply(id, ["success": true])
        default: reply(id, ["success": false, "error": "unknown_command"])
        }
    }
}
@MainActor private func unityStatus() -> [String: Any] {
    ["success": Rejourney.currentSessionId != nil, "sessionId": Rejourney.currentSessionId ?? "",
     "telemetryOnly": !ReplayOrchestrator.shared.visualCaptureEnabled,
     "fps": max(1, min(3, Int((1 / max(0.01, VisualCapture.shared.snapshotInterval)).rounded()))),
     "maskTextInputs": ReplayOrchestrator.shared.maskTextInputsByDefault,
     "maskImagesAndVideos": ReplayOrchestrator.shared.maskImagesAndVideosByDefault,
     "nativeFramesAccepted": VisualCapture.shared.framesCaptured,
     "nativeFramesSkippedBackpressure": VisualCapture.shared.skippedFramesBacklog]
}
@MainActor private func metadataValue(_ value: Any?) -> RejourneyMetadataValue {
    if let value = value as? String { return .string(value) }
    if let value = value as? NSNumber { return CFGetTypeID(value) == CFBooleanGetTypeID() ? .bool(value.boolValue) : .double(value.doubleValue) }
    if let value = value as? [String: Any] { return .object(value.mapValues(metadataValue)) }
    if let value = value as? [Any] { return .array(value.map(metadataValue)) }
    return .null
}
@_cdecl("rj_unity_frame")
public func rjUnityFrame(_ pointer: UnsafePointer<UInt8>?, _ count: Int32, _ sessionPointer: UnsafePointer<CChar>?, _ timestamp: Int64) {
    guard let pointer, let sessionPointer, count > 0, count <= 4 * 1024 * 1024, timestamp > 0 else { return }
    responseLock.lock()
    if frameDispatchPending { responseLock.unlock(); return }
    frameDispatchPending = true; responseLock.unlock()
    let owned = Data(bytes: pointer, count: Int(count)); let session = String(cString: sessionPointer)
    DispatchQueue.main.async {
        VisualCapture.shared.accept(owned, sessionId: session, timestamp: UInt64(timestamp))
        responseLock.lock(); frameDispatchPending = false; responseLock.unlock()
    }
}

@_cdecl("rj_unity_test_crash")
public func rjUnityTestCrash() { abort() }
@_cdecl("rj_unity_test_ui_stall")
public func rjUnityTestUiStall() { DispatchQueue.main.async { Thread.sleep(forTimeInterval: 7) } }
