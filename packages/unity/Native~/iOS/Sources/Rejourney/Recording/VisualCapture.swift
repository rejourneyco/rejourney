import Foundation
import UIKit

/// Unity supplies fully composed, already-masked JPEGs. There is deliberately
/// no UIView scan, screenshot timer, black-frame heuristic, or native mask cache.
///
/// Frames are bundled like the other SDKs (three by default), so one
/// presign/PUT/confirm round trip carries several frames. Each frame is also
/// written under rj_pending until its bundle is delivered or accepted by the
/// dispatcher's durable spool, so crash recovery keeps the final seconds.
final class VisualCapture {
    static let shared = VisualCapture()
    private(set) var captureGeneration = 0
    private(set) var framesCaptured = 0
    private(set) var skippedFramesBacklog = 0
    var skippedFramesThrottle = 0
    private(set) var skippedFramesDuplicate = 0
    var skippedFramesMapMoving = 0
    private(set) var snapshotInterval = 1.0
    private var active = false
    private var paused = false
    private var epoch: UInt64 = 0

    private struct Frame { let jpeg: Data; let timestamp: UInt64 }
    private struct Batch { let session: String; let epoch: UInt64; let frames: [Frame] }
    // Guarded by lock. At most maxInFlight bundles are handed to the dispatcher
    // at once; beyond maxBuffered, new frames are dropped as backlog.
    private let lock = NSLock()
    private var batchSize = 3
    private var buffer: [Frame] = []
    private var bufferSession: String?
    private var bufferEpoch: UInt64 = 0
    private var lastFrameHash: Int?
    private var inFlight = 0
    private let maxInFlight = 2
    private var maxBuffered: Int { batchSize * 3 }
    private let worker = DispatchQueue(label: "co.rejourney.unity.frames", qos: .utility)

    func configure(snapshotInterval: Double, jpegQuality: Double, uploadBatchSize: Int = 3) {
        self.snapshotInterval = snapshotInterval
        lock.lock(); batchSize = max(1, min(uploadBatchSize, 30)); lock.unlock()
    }
    func beginCapture(sessionOrigin: UInt64) {
        flushBufferToNetwork()
        lock.lock(); lastFrameHash = nil; lock.unlock()
        captureGeneration += 1; epoch = sessionOrigin; active = true; paused = false
    }
    func halt(expectedGeneration: Int = -1) {
        guard expectedGeneration < 0 || expectedGeneration == captureGeneration else { return }
        active = false; captureGeneration += 1
        flushBufferToNetwork()
    }
    func pauseForUser() { paused = true; captureGeneration += 1; flushBufferToNetwork() }
    func resumeFromUser() { paused = false; captureGeneration += 1 }

    func accept(_ jpeg: Data, sessionId: String, timestamp: UInt64) {
        guard active, !paused, UIApplication.shared.applicationState == .active,
              sessionId == ReplayOrchestrator.shared.replayId, timestamp >= epoch,
              jpeg.count > 2, jpeg.count <= 4 * 1024 * 1024 else { return }
        // Data.hashValue covers only the length and first 80 bytes; hash all of it.
        var hasher = Hasher()
        jpeg.withUnsafeBytes { hasher.combine(bytes: $0) }
        let hash = hasher.finalize()
        var batches: [Batch] = []
        lock.lock()
        if let session = bufferSession, session != sessionId, let previous = takeBatch(force: true) { batches.append(previous) }
        if hash == lastFrameHash {
            // A static scene still advances the time-based flush below.
            skippedFramesDuplicate += 1
        } else if buffer.count >= maxBuffered {
            skippedFramesBacklog += 1
        } else {
            lastFrameHash = hash
            if buffer.isEmpty { bufferSession = sessionId; bufferEpoch = epoch }
            buffer.append(Frame(jpeg: jpeg, timestamp: timestamp))
            persist(jpeg, timestamp: timestamp, sessionId: sessionId)
        }
        if let due = takeBatchIfDue(now: timestamp) { batches.append(due) }
        lock.unlock()
        batches.forEach(ship)
    }

    // MARK: Bundling (lock held)

    private func takeBatchIfDue(now: UInt64) -> Batch? {
        guard let first = buffer.first, inFlight < maxInFlight else { return nil }
        let waited = Double(now > first.timestamp ? now - first.timestamp : 0)
        guard buffer.count >= batchSize || waited >= Double(batchSize) * snapshotInterval * 1000 else { return nil }
        return takeBatch(force: false)
    }

    private func takeBatch(force: Bool) -> Batch? {
        guard !buffer.isEmpty, let session = bufferSession, force || inFlight < maxInFlight else { return nil }
        let batch = Batch(session: session, epoch: bufferEpoch, frames: buffer)
        buffer.removeAll(); bufferSession = nil; inFlight += 1
        return batch
    }

    /// Android-compatible format: [8-byte BE offset][4-byte BE size][jpeg] per frame, gzipped.
    private func ship(_ batch: Batch) {
        worker.async {
            var archive = Data()
            for frame in batch.frames {
                var offset = (frame.timestamp >= batch.epoch ? frame.timestamp - batch.epoch : 0).bigEndian
                var length = UInt32(frame.jpeg.count).bigEndian
                withUnsafeBytes(of: &offset) { archive.append(contentsOf: $0) }
                withUnsafeBytes(of: &length) { archive.append(contentsOf: $0) }
                archive.append(frame.jpeg)
            }
            guard let gzip = archive.gzipCompress(), let first = batch.frames.first, let last = batch.frames.last else {
                self.finish(batch, accepted: false); return
            }
            SegmentDispatcher.shared.transmitFrameBundle(for: batch.session, payload: gzip, startMs: first.timestamp,
                                                         endMs: last.timestamp, frameCount: batch.frames.count) { ok in
                self.finish(batch, accepted: ok)
            }
        }
    }

    /// `accepted` means delivered or durably queued for retry. Otherwise the
    /// dispatcher dropped the bundle, so its frame files remain for recovery.
    private func finish(_ batch: Batch, accepted: Bool) {
        if accepted {
            worker.async {
                guard let directory = Self.framesDirectory(batch.session) else { return }
                for frame in batch.frames { try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(frame.timestamp).jpeg")) }
            }
        }
        lock.lock()
        inFlight -= 1
        if accepted { framesCaptured += batch.frames.count }
        let next = takeBatchIfDue(now: buffer.last?.timestamp ?? 0)
        lock.unlock()
        if let next { ship(next) }
    }

    // MARK: Persistence and recovery

    private static func framesDirectory(_ sessionId: String) -> URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("rj_pending").appendingPathComponent(sessionId).appendingPathComponent("frames")
    }

    private func persist(_ jpeg: Data, timestamp: UInt64, sessionId: String) {
        worker.async { Self.write(jpeg, timestamp: timestamp, sessionId: sessionId) }
    }

    private static func write(_ jpeg: Data, timestamp: UInt64, sessionId: String) {
        guard let directory = framesDirectory(sessionId) else { return }
        let path = directory.appendingPathComponent("\(timestamp).jpeg")
        guard !FileManager.default.fileExists(atPath: path.path) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? jpeg.write(to: path, options: .atomic)
    }

    /// Recovery after a crash: ship the frames that never reached the durable spool.
    func uploadPendingFrames(sessionId: String, sessionEpoch: UInt64, completion: @escaping (Bool) -> Void) {
        worker.async {
            guard let directory = Self.framesDirectory(sessionId),
                  let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else {
                completion(true); return
            }
            let frames = files.compactMap { file -> Frame? in
                guard file.pathExtension == "jpeg", let timestamp = UInt64(file.deletingPathExtension().lastPathComponent),
                      timestamp > 0, let jpeg = try? Data(contentsOf: file) else { return nil }
                return Frame(jpeg: jpeg, timestamp: timestamp)
            }.sorted { $0.timestamp < $1.timestamp }
            guard !frames.isEmpty else { completion(true); return }
            var archive = Data()
            for frame in frames {
                var offset = (frame.timestamp >= sessionEpoch ? frame.timestamp - sessionEpoch : 0).bigEndian
                var length = UInt32(frame.jpeg.count).bigEndian
                withUnsafeBytes(of: &offset) { archive.append(contentsOf: $0) }
                withUnsafeBytes(of: &length) { archive.append(contentsOf: $0) }
                archive.append(frame.jpeg)
            }
            guard let gzip = archive.gzipCompress() else { completion(false); return }
            SegmentDispatcher.shared.transmitFrameBundle(for: sessionId, payload: gzip, startMs: frames[0].timestamp,
                                                         endMs: frames[frames.count - 1].timestamp, frameCount: frames.count) { ok in
                if ok { try? FileManager.default.removeItem(at: directory) }
                completion(ok)
            }
        }
    }

    /// Hand every buffered frame to the dispatcher now, regardless of batch size.
    func afterPendingFrames(_ completion: @escaping () -> Void) {
        flushBufferToNetwork()
        worker.async { DispatchQueue.main.async(execute: completion) }
    }
    func clearPendingFrames(sessionId: String) {
        worker.async { if let directory = Self.framesDirectory(sessionId) { try? FileManager.default.removeItem(at: directory) } }
    }
    /// Frames are persisted as they arrive; only the buffer's hand-off is pending.
    func flushToDisk() {}
    /// Crash handlers cannot wait for the worker. Write unshipped frames inline,
    /// and skip rather than deadlock if the crashing thread holds the lock.
    func flushToDiskForCrash() {
        guard lock.try() else { return }
        let frames = buffer, session = bufferSession
        lock.unlock()
        guard let session else { return }
        for frame in frames { Self.write(frame.jpeg, timestamp: frame.timestamp, sessionId: session) }
    }
    func flushBufferToNetwork() {
        lock.lock(); let batch = takeBatch(force: true); lock.unlock()
        if let batch { ship(batch) }
    }
    func waitForEncodingToComplete() { worker.sync {} }
    func registerRedaction(_ view: UIView) {}
    func unregisterRedaction(_ view: UIView) {}
    func invalidateMaskCache() {}
    func snapshotNow() {}
}
