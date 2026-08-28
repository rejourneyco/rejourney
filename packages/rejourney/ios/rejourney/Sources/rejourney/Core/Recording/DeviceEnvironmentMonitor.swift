/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import UIKit
import QuartzCore
import os

/// Permissionless session-quality context driven by lifecycle reads and OS
/// callbacks only. No timer or display-link is installed by this monitor.
final class DeviceEnvironmentMonitor: NSObject {
    private static let memoryBucketMiB = 128
    private static let maxMemoryBucketMiB = 8192

    private let lock = NSLock()
    private var active = false
    private var observers: [NSObjectProtocol] = []
    private var memoryPressureSource: DispatchSourceMemoryPressure?
    private let memoryPressureQueue = DispatchQueue(label: "co.rejourney.device-memory-pressure", qos: .utility)
    private var batteryMonitoringWasEnabled = false
    private var orientationNotificationsWereEnabled = false

    private var sessionObserved = false
    private var batteryObserved = false
    private var lowPowerModeSampled = false
    private var thermalObserved = false
    private var memoryObserved = false
    private var uiEnvironmentObserved = false

    private var currentBattery: [String: Any] = [:]
    private var batteryLevelStart: Int?
    private var batteryLevelEnd: Int?
    private var batteryPowerClassStart: String?
    private var batteryStateStart: String?
    private var batteryStateEnd: String?
    private var chargingStateChanged = false
    private var lowPowerModeObserved = false

    private var thermalStateStart: String?
    private var thermalStatePeak: String?
    private var thermalStateEnd: String?
    private var thermalThrottledDurationMs: UInt64 = 0
    private var thermalThrottledSince: CFTimeInterval?

    private var memoryPressureCurrent = "normal"
    private var memoryPressurePeak = "normal"
    private var memoryPressureEventCount = 0
    private var memoryHeadroomStart: Int?
    private var memoryHeadroomMin: Int?
    private var memoryHeadroomEnd: Int?

    private var fontScaleBucket: String?
    private var uiStyle: String?
    private var layoutDirection: String?
    private var orientationStart: String?
    private var orientationEnd: String?
    private var lastOrientation: String?
    private var orientationChangeCount = 0
    private var displayMaxRefreshRateHz: Int?

    func start(resetSession: Bool) {
        if resetSession { resetSessionState() }
        lock.lock()
        sessionObserved = true
        active = true
        lock.unlock()

        let startOnMain = { [weak self] in
            guard let self, self.isActive else { return }
            self.installObserversOnMain()
            self.sampleBoundaryOnMain(countOrientationChange: false)
        }
        if Thread.isMainThread { startOnMain() } else { DispatchQueue.main.async(execute: startOnMain) }
        installMemoryPressureSource()
    }

    /// Drop cached values when a new session has device collection disabled.
    func clearSession() {
        pause()
        resetSessionState()
    }

    func pause() {
        guard isActive else { return }
        let sampleEndBoundary = { [weak self] in
            guard let self, self.isActive else { return }
            self.sampleBoundaryOnMain(countOrientationChange: false)
        }
        if Thread.isMainThread {
            sampleEndBoundary()
        } else {
            // Pause/finalize happens once per lifecycle boundary. Waiting for
            // this main-thread read preserves the exact active-session end
            // without adding work to steady-state capture or event paths.
            DispatchQueue.main.sync(execute: sampleEndBoundary)
        }

        lock.lock()
        guard active else {
            lock.unlock()
            return
        }
        let now = CACurrentMediaTime()
        accumulateThermalDurationLocked(now: now)
        thermalThrottledSince = nil
        active = false
        lock.unlock()

        let stopOnMain: () -> Void = { [weak self] in
            self?.removeObserversOnMain()
        }
        if Thread.isMainThread { stopOnMain() } else { DispatchQueue.main.async(execute: stopOnMain) }
        memoryPressureSource?.cancel()
        memoryPressureSource = nil
    }

    func currentSnapshot() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        guard sessionObserved else { return [:] }
        var result = currentBattery
        if let thermalStateEnd { result["thermalState"] = thermalStateEnd }
        if memoryObserved { result["memoryPressure"] = memoryPressureCurrent }
        if let memoryHeadroomEnd { result["memoryHeadroomMbBucket"] = memoryHeadroomEnd }
        if let fontScaleBucket { result["fontScaleBucket"] = fontScaleBucket }
        if let uiStyle { result["uiStyle"] = uiStyle }
        if let layoutDirection { result["layoutDirection"] = layoutDirection }
        if let orientationEnd { result["orientation"] = orientationEnd }
        if let displayMaxRefreshRateHz { result["displayMaxRefreshRateHz"] = displayMaxRefreshRateHz }
        return result
    }

    /// Compatibility accessor for getDeviceInfo calls outside recording.
    func currentBatterySnapshot() -> [String: Any] {
        lock.lock()
        let monitoring = active
        let cached = currentBattery
        lock.unlock()
        if monitoring || !cached.isEmpty { return cached }
        if Thread.isMainThread { return readBatteryOnMain(restoreMonitoring: true) }
        return DispatchQueue.main.sync { self.readBatteryOnMain(restoreMonitoring: true) }
    }

    func sessionSummary() -> [String: Any] {
        lock.lock()
        let observed = sessionObserved
        lock.unlock()
        guard observed else { return [:] }

        if isActive {
            if Thread.isMainThread {
                sampleBoundaryOnMain(countOrientationChange: false)
            } else {
                // Finalization is an explicit, once-per-session boundary. A
                // main-thread read here keeps battery/UI end fields exact and
                // does not add work to steady-state event or frame paths.
                DispatchQueue.main.sync {
                    if self.isActive {
                        self.sampleBoundaryOnMain(countOrientationChange: false)
                    }
                }
            }
        }

        lock.lock()
        if active {
            let now = CACurrentMediaTime()
            accumulateThermalDurationLocked(now: now)
            thermalThrottledSince = thermalStateEnd.map(isMateriallyThrottled) == true ? now : nil
        }
        defer { lock.unlock() }

        var result: [String: Any] = [:]
        if thermalObserved { result["thermalThrottledDurationMs"] = thermalThrottledDurationMs }
        if memoryObserved {
            result["memoryPressurePeak"] = memoryPressurePeak
            result["memoryPressureEventCount"] = memoryPressureEventCount
        }
        if uiEnvironmentObserved { result["orientationChangeCount"] = orientationChangeCount }
        if batteryObserved { result["chargingStateChanged"] = chargingStateChanged }
        if lowPowerModeSampled { result["lowPowerModeObserved"] = lowPowerModeObserved }
        if let thermalStateStart { result["thermalStateStart"] = thermalStateStart }
        if let thermalStatePeak { result["thermalStatePeak"] = thermalStatePeak }
        if let thermalStateEnd { result["thermalStateEnd"] = thermalStateEnd }
        if let memoryHeadroomStart { result["memoryHeadroomMbBucketStart"] = memoryHeadroomStart }
        if let memoryHeadroomMin { result["memoryHeadroomMbBucketMin"] = memoryHeadroomMin }
        if let memoryHeadroomEnd { result["memoryHeadroomMbBucketEnd"] = memoryHeadroomEnd }
        if let fontScaleBucket { result["fontScaleBucket"] = fontScaleBucket }
        if let uiStyle { result["uiStyle"] = uiStyle }
        if let layoutDirection { result["layoutDirection"] = layoutDirection }
        if let orientationStart { result["orientationStart"] = orientationStart }
        if let orientationEnd { result["orientationEnd"] = orientationEnd }
        if let displayMaxRefreshRateHz { result["displayMaxRefreshRateHz"] = displayMaxRefreshRateHz }
        if let batteryLevelStart { result["batteryLevelStartPercent"] = batteryLevelStart }
        if let batteryLevelEnd { result["batteryLevelEndPercent"] = batteryLevelEnd }
        if let batteryLevelStart, let batteryLevelEnd {
            result["batteryDeltaPercent"] = batteryLevelEnd - batteryLevelStart
        }
        if let batteryStateStart { result["batteryStateStart"] = batteryStateStart }
        if let batteryStateEnd { result["batteryStateEnd"] = batteryStateEnd }
        return result
    }

    private var isActive: Bool {
        lock.lock()
        defer { lock.unlock() }
        return active
    }

    private func resetSessionState() {
        lock.lock()
        defer { lock.unlock() }
        sessionObserved = false
        batteryObserved = false
        lowPowerModeSampled = false
        thermalObserved = false
        memoryObserved = false
        uiEnvironmentObserved = false
        currentBattery = [:]
        batteryLevelStart = nil
        batteryLevelEnd = nil
        batteryPowerClassStart = nil
        batteryStateStart = nil
        batteryStateEnd = nil
        chargingStateChanged = false
        lowPowerModeObserved = false
        thermalStateStart = nil
        thermalStatePeak = nil
        thermalStateEnd = nil
        thermalThrottledDurationMs = 0
        thermalThrottledSince = nil
        memoryPressureCurrent = "normal"
        memoryPressurePeak = "normal"
        memoryPressureEventCount = 0
        memoryHeadroomStart = nil
        memoryHeadroomMin = nil
        memoryHeadroomEnd = nil
        fontScaleBucket = nil
        uiStyle = nil
        layoutDirection = nil
        orientationStart = nil
        orientationEnd = nil
        lastOrientation = nil
        orientationChangeCount = 0
        displayMaxRefreshRateHz = nil
    }

    private func installObserversOnMain() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard observers.isEmpty else { return }

        let device = UIDevice.current
        batteryMonitoringWasEnabled = device.isBatteryMonitoringEnabled
        if !batteryMonitoringWasEnabled { device.isBatteryMonitoringEnabled = true }
        orientationNotificationsWereEnabled = device.isGeneratingDeviceOrientationNotifications
        if !orientationNotificationsWereEnabled { device.beginGeneratingDeviceOrientationNotifications() }

        let center = NotificationCenter.default
        let names: [Notification.Name] = [
            UIDevice.batteryLevelDidChangeNotification,
            UIDevice.batteryStateDidChangeNotification,
            Notification.Name.NSProcessInfoPowerStateDidChange
        ]
        for name in names {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self, self.isActive else { return }
                self.updateBattery(self.readBatteryOnMain(restoreMonitoring: false))
            })
        }
        observers.append(center.addObserver(
            forName: ProcessInfo.thermalStateDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.isActive else { return }
            self.updateThermal(self.thermalStateName(ProcessInfo.processInfo.thermalState))
        })
        observers.append(center.addObserver(
            forName: UIContentSizeCategory.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.isActive else { return }
            self.updateUiEnvironment(self.readUiEnvironmentOnMain(), countOrientationChange: false)
        })
        observers.append(center.addObserver(
            forName: UIDevice.orientationDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.isActive else { return }
            DispatchQueue.main.async {
                guard self.isActive else { return }
                self.updateUiEnvironment(self.readUiEnvironmentOnMain(), countOrientationChange: true)
            }
        })
        observers.append(center.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.isActive else { return }
            self.sampleBoundaryOnMain(countOrientationChange: false)
        })
    }

    private func removeObserversOnMain() {
        dispatchPrecondition(condition: .onQueue(.main))
        let center = NotificationCenter.default
        observers.forEach { center.removeObserver($0) }
        observers.removeAll()
        if !batteryMonitoringWasEnabled { UIDevice.current.isBatteryMonitoringEnabled = false }
        if !orientationNotificationsWereEnabled { UIDevice.current.endGeneratingDeviceOrientationNotifications() }
        batteryMonitoringWasEnabled = false
        orientationNotificationsWereEnabled = false
    }

    private func installMemoryPressureSource() {
        guard memoryPressureSource == nil else { return }
        let source = DispatchSource.makeMemoryPressureSource(eventMask: .all, queue: memoryPressureQueue)
        memoryPressureSource = source
        source.setEventHandler { [weak self] in
            guard let self, self.isActive, let event = self.memoryPressureSource?.data else { return }
            if event.contains(.critical) {
                self.updateMemoryPressure("critical")
            } else if event.contains(.warning) {
                self.updateMemoryPressure("warning")
            } else if event.contains(.normal) {
                self.updateMemoryPressure("normal")
            }
        }
        source.resume()
    }

    private func sampleBoundaryOnMain(countOrientationChange: Bool) {
        dispatchPrecondition(condition: .onQueue(.main))
        updateBattery(readBatteryOnMain(restoreMonitoring: false))
        updateThermal(thermalStateName(ProcessInfo.processInfo.thermalState))
        updateMemoryHeadroom(readMemoryHeadroomBucket())
        updateUiEnvironment(readUiEnvironmentOnMain(), countOrientationChange: countOrientationChange)
    }

    private func readBatteryOnMain(restoreMonitoring: Bool) -> [String: Any] {
        dispatchPrecondition(condition: .onQueue(.main))
        let device = UIDevice.current
        let wasEnabled = device.isBatteryMonitoringEnabled
        if !wasEnabled { device.isBatteryMonitoringEnabled = true }
        defer {
            if restoreMonitoring, !wasEnabled { device.isBatteryMonitoringEnabled = false }
        }

        let state: String
        switch device.batteryState {
        case .charging: state = "charging"
        case .full: state = "full"
        case .unplugged: state = "unplugged"
        case .unknown: fallthrough
        @unknown default: state = "unknown"
        }
        var snapshot: [String: Any] = [
            "batteryState": state,
            "lowPowerModeEnabled": ProcessInfo.processInfo.isLowPowerModeEnabled
        ]
        if device.batteryLevel >= 0 {
            snapshot["batteryLevelPercent"] = min(100, max(0, Int((device.batteryLevel * 100).rounded())))
        }
        return snapshot
    }

    private func updateBattery(_ snapshot: [String: Any]) {
        guard !snapshot.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        currentBattery = snapshot
        if let level = (snapshot["batteryLevelPercent"] as? NSNumber)?.intValue {
            batteryObserved = true
            let bounded = min(100, max(0, level))
            if batteryLevelStart == nil { batteryLevelStart = bounded }
            batteryLevelEnd = bounded
        }
        if let state = snapshot["batteryState"] as? String {
            if state != "unknown" { batteryObserved = true }
            if batteryStateStart == nil { batteryStateStart = state }
            batteryStateEnd = state
            let powerClass: String?
            switch state {
            case "charging", "full": powerClass = "plugged"
            case "unplugged": powerClass = "unplugged"
            default: powerClass = nil
            }
            if batteryPowerClassStart == nil, let powerClass { batteryPowerClassStart = powerClass }
            if let powerClass, let batteryPowerClassStart, powerClass != batteryPowerClassStart {
                chargingStateChanged = true
            }
        }
        if snapshot["lowPowerModeEnabled"] is Bool { lowPowerModeSampled = true }
        if snapshot["lowPowerModeEnabled"] as? Bool == true { lowPowerModeObserved = true }
    }

    private func updateThermal(_ state: String) {
        lock.lock()
        defer { lock.unlock() }
        thermalObserved = true
        let now = CACurrentMediaTime()
        accumulateThermalDurationLocked(now: now)
        if thermalStateStart == nil { thermalStateStart = state }
        thermalStateEnd = state
        if thermalStatePeak == nil || thermalRank(state) > thermalRank(thermalStatePeak!) {
            thermalStatePeak = state
        }
        thermalThrottledSince = active && isMateriallyThrottled(state) ? now : nil
    }

    private func accumulateThermalDurationLocked(now: CFTimeInterval) {
        guard let started = thermalThrottledSince else { return }
        thermalThrottledDurationMs += UInt64(max(0, (now - started) * 1000))
    }

    private func updateMemoryPressure(_ pressure: String) {
        lock.lock()
        memoryObserved = true
        memoryPressureCurrent = pressure
        if pressure != "normal" { memoryPressureEventCount += 1 }
        if memoryPressureRank(pressure) > memoryPressureRank(memoryPressurePeak) {
            memoryPressurePeak = pressure
        }
        lock.unlock()
        updateMemoryHeadroom(readMemoryHeadroomBucket())
    }

    private func readMemoryHeadroomBucket() -> Int? {
        let bytes = os_proc_available_memory()
        guard bytes > 0 else { return nil }
        let mib = Int(bytes / (1024 * 1024))
        return min(Self.maxMemoryBucketMiB, (mib / Self.memoryBucketMiB) * Self.memoryBucketMiB)
    }

    private func updateMemoryHeadroom(_ bucket: Int?) {
        guard let bucket else { return }
        lock.lock()
        defer { lock.unlock() }
        memoryObserved = true
        if memoryHeadroomStart == nil { memoryHeadroomStart = bucket }
        memoryHeadroomEnd = bucket
        memoryHeadroomMin = memoryHeadroomMin.map { min($0, bucket) } ?? bucket
    }

    private struct UiEnvironment {
        let fontScaleBucket: String
        let uiStyle: String
        let layoutDirection: String
        let orientation: String
        let maxRefreshRateHz: Int
    }

    private func readUiEnvironmentOnMain() -> UiEnvironment {
        dispatchPrecondition(condition: .onQueue(.main))
        let category = UIApplication.shared.preferredContentSizeCategory
        let fontBucket: String
        switch category {
        case .extraSmall, .small: fontBucket = "compact"
        case .medium, .large: fontBucket = "standard"
        case .extraLarge, .extraExtraLarge, .extraExtraExtraLarge: fontBucket = "large"
        case .accessibilityMedium, .accessibilityLarge, .accessibilityExtraLarge,
             .accessibilityExtraExtraLarge, .accessibilityExtraExtraExtraLarge: fontBucket = "accessibility"
        default: fontBucket = "standard"
        }
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: { $0.isKeyWindow })
        let style: String
        switch window?.traitCollection.userInterfaceStyle {
        case .dark: style = "dark"
        case .light: style = "light"
        default: style = "unspecified"
        }
        let direction = UIView.userInterfaceLayoutDirection(for: window?.semanticContentAttribute ?? .unspecified) == .rightToLeft ? "rtl" : "ltr"
        let orientation: String
        switch window?.windowScene?.interfaceOrientation {
        case .portrait, .portraitUpsideDown: orientation = "portrait"
        case .landscapeLeft, .landscapeRight: orientation = "landscape"
        default: orientation = "unknown"
        }
        let refreshRate = window?.windowScene?.screen.maximumFramesPerSecond ?? UIScreen.main.maximumFramesPerSecond
        return UiEnvironment(
            fontScaleBucket: fontBucket,
            uiStyle: style,
            layoutDirection: direction,
            orientation: orientation,
            maxRefreshRateHz: refreshRate
        )
    }

    private func updateUiEnvironment(_ sample: UiEnvironment, countOrientationChange: Bool) {
        lock.lock()
        defer { lock.unlock() }
        uiEnvironmentObserved = true
        fontScaleBucket = sample.fontScaleBucket
        uiStyle = sample.uiStyle
        layoutDirection = sample.layoutDirection
        if orientationStart == nil { orientationStart = sample.orientation }
        if countOrientationChange,
           let lastOrientation,
           lastOrientation != "unknown", sample.orientation != "unknown",
           lastOrientation != sample.orientation {
            orientationChangeCount += 1
        }
        lastOrientation = sample.orientation
        orientationEnd = sample.orientation
        displayMaxRefreshRateHz = sample.maxRefreshRateHz
    }

    private func thermalStateName(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    private func thermalRank(_ state: String) -> Int {
        switch state {
        case "nominal": return 0
        case "fair": return 1
        case "serious": return 2
        case "critical": return 3
        default: return -1
        }
    }

    private func isMateriallyThrottled(_ state: String) -> Bool { thermalRank(state) >= 2 }

    private func memoryPressureRank(_ state: String) -> Int {
        switch state {
        case "normal": return 0
        case "warning": return 1
        case "critical": return 2
        default: return -1
        }
    }
}
