//
//  MediaMaskingTestView.swift
//  CountriesSwiftUI
//
//  Created by Rejourney on 6/1/26.
//

import AVFoundation
import SwiftUI
import UIKit

struct MediaMaskingTestView: View {

    @State private var showPaywall = false
    @State private var videoURL: URL?
    @State private var videoError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    mediaCard(title: "Generated image", subtitle: "UIImageView-backed image content") {
                        DemoImageUIView()
                            .frame(height: 210)
                    }

                    mediaCard(title: "Generated video", subtitle: "AVPlayerLayer-backed moving content") {
                        ZStack {
                            if let videoURL {
                                LoopingDemoVideoView(url: videoURL)
                            } else {
                                ProgressView(videoError ?? "Preparing video")
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        }
                        .frame(height: 210)
                    }

                    Button {
                        RejourneyExample.logEvent("media_paywall_opened")
                        showPaywall = true
                    } label: {
                        Label("Show Paywall", systemImage: "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
                .padding(18)
            }
            .navigationTitle("Media Test")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await prepareVideo()
            }
            .onAppear {
                RejourneyExample.trackScreen("Media Masking Test")
            }
            .sheet(isPresented: $showPaywall) {
                DemoPaywallSheet()
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private func mediaCard<Content: View>(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            content()
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(.black.opacity(0.08), lineWidth: 1)
                }
        }
        .padding(14)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    @MainActor
    private func prepareVideo() async {
        guard videoURL == nil else { return }

        do {
            let url = try await Task.detached(priority: .userInitiated) {
                try DemoVideoFactory.shared.videoURL()
            }.value
            videoURL = url
        } catch {
            videoError = "Video unavailable"
        }
    }
}

private struct DemoImageUIView: UIViewRepresentable {
    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView(image: DemoImageFactory.image())
        view.contentMode = .scaleAspectFill
        view.clipsToBounds = true
        view.accessibilityLabel = "Generated image masking sample"
        return view
    }

    func updateUIView(_ uiView: UIImageView, context: Context) {}
}

private enum DemoImageFactory {
    static func image() -> UIImage {
        let size = CGSize(width: 900, height: 560)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1

        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cgContext = context.cgContext
            let rect = CGRect(origin: .zero, size: size)
            let colors = [
                UIColor(red: 0.07, green: 0.16, blue: 0.29, alpha: 1).cgColor,
                UIColor(red: 0.03, green: 0.52, blue: 0.58, alpha: 1).cgColor,
                UIColor(red: 0.96, green: 0.67, blue: 0.28, alpha: 1).cgColor
            ] as CFArray
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 0.55, 1])!
            cgContext.drawLinearGradient(
                gradient,
                start: CGPoint(x: rect.minX, y: rect.minY),
                end: CGPoint(x: rect.maxX, y: rect.maxY),
                options: []
            )

            UIColor.white.withAlphaComponent(0.9).setFill()
            UIBezierPath(ovalIn: CGRect(x: 94, y: 80, width: 190, height: 190)).fill()
            UIColor(red: 0.10, green: 0.12, blue: 0.20, alpha: 0.86).setFill()
            UIBezierPath(roundedRect: CGRect(x: 340, y: 112, width: 390, height: 74), cornerRadius: 18).fill()
            UIBezierPath(roundedRect: CGRect(x: 340, y: 220, width: 300, height: 38), cornerRadius: 14).fill()
            UIBezierPath(roundedRect: CGRect(x: 340, y: 284, width: 220, height: 38), cornerRadius: 14).fill()

            let mountainPath = UIBezierPath()
            mountainPath.move(to: CGPoint(x: 0, y: 560))
            mountainPath.addLine(to: CGPoint(x: 210, y: 310))
            mountainPath.addLine(to: CGPoint(x: 360, y: 410))
            mountainPath.addLine(to: CGPoint(x: 530, y: 250))
            mountainPath.addLine(to: CGPoint(x: 900, y: 560))
            mountainPath.close()
            UIColor.white.withAlphaComponent(0.28).setFill()
            mountainPath.fill()
        }
    }
}

private struct LoopingDemoVideoView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> LoopingPlayerUIView {
        let view = LoopingPlayerUIView()
        view.configure(url: url)
        return view
    }

    func updateUIView(_ uiView: LoopingPlayerUIView, context: Context) {
        uiView.configure(url: url)
        uiView.play()
    }

    static func dismantleUIView(_ uiView: LoopingPlayerUIView, coordinator: ()) {
        uiView.pause()
    }
}

private final class LoopingPlayerUIView: UIView {
    private var currentURL: URL?
    private var queuePlayer: AVQueuePlayer?
    private var playerLooper: AVPlayerLooper?

    override static var layerClass: AnyClass {
        AVPlayerLayer.self
    }

    private var playerLayer: AVPlayerLayer {
        layer as! AVPlayerLayer
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        playerLayer.videoGravity = .resizeAspectFill
        backgroundColor = .black
        accessibilityLabel = "Generated video masking sample"
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(url: URL) {
        guard currentURL != url else { return }
        currentURL = url

        let item = AVPlayerItem(url: url)
        let player = AVQueuePlayer()
        let looper = AVPlayerLooper(player: player, templateItem: item)
        player.isMuted = true
        player.actionAtItemEnd = .none

        queuePlayer = player
        playerLooper = looper
        playerLayer.player = player
        player.play()
    }

    func play() {
        queuePlayer?.play()
    }

    func pause() {
        queuePlayer?.pause()
    }
}

private final class DemoVideoFactory {
    static let shared = DemoVideoFactory()

    private let outputURL: URL

    private init() {
        outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("rejourney-media-mask-demo-v2")
            .appendingPathExtension("mp4")
    }

    func videoURL() throws -> URL {
        if FileManager.default.fileExists(atPath: outputURL.path) {
            return outputURL
        }

        try? FileManager.default.removeItem(at: outputURL)

        let width = 640
        let height = 360
        let fps: Int32 = 30
        let frameCount = 120

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height
        ])
        input.expectsMediaDataInRealTime = false

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height
            ]
        )

        guard writer.canAdd(input) else {
            throw DemoVideoError.cannotAddInput
        }
        writer.add(input)

        guard writer.startWriting() else {
            throw writer.error ?? DemoVideoError.writerFailed
        }
        writer.startSession(atSourceTime: .zero)

        for frame in 0..<frameCount {
            while !input.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.01)
            }

            guard let buffer = makeFrame(width: width, height: height, frame: frame, frameCount: frameCount) else {
                throw DemoVideoError.frameFailed
            }

            let time = CMTime(value: CMTimeValue(frame), timescale: fps)
            guard adaptor.append(buffer, withPresentationTime: time) else {
                throw writer.error ?? DemoVideoError.writerFailed
            }
        }

        input.markAsFinished()

        let semaphore = DispatchSemaphore(value: 0)
        writer.finishWriting {
            semaphore.signal()
        }
        semaphore.wait()

        guard writer.status == .completed else {
            throw writer.error ?? DemoVideoError.writerFailed
        }
        return outputURL
    }

    private func makeFrame(width: Int, height: Int, frame: Int, frameCount: Int) -> CVPixelBuffer? {
        var pixelBuffer: CVPixelBuffer?
        let attributes: [String: Any] = [
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ]

        guard CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32BGRA,
            attributes as CFDictionary,
            &pixelBuffer
        ) == kCVReturnSuccess, let pixelBuffer else {
            return nil
        }

        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            return nil
        }

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            return nil
        }

        let phase = CGFloat(frame) / CGFloat(max(1, frameCount - 1))
        let colors = [
            UIColor(red: 0.05 + 0.16 * phase, green: 0.12, blue: 0.36, alpha: 1).cgColor,
            UIColor(red: 0.92, green: 0.33 + 0.26 * phase, blue: 0.29, alpha: 1).cgColor
        ] as CFArray
        let gradient = CGGradient(colorsSpace: colorSpace, colors: colors, locations: [0, 1])!
        context.drawLinearGradient(
            gradient,
            start: CGPoint(x: 0, y: 0),
            end: CGPoint(x: CGFloat(width), y: CGFloat(height)),
            options: []
        )

        let orbitRadius = CGFloat(92)
        let center = CGPoint(x: CGFloat(width) * 0.5, y: CGFloat(height) * 0.52)
        let angle = phase * .pi * 2
        let movingCenter = CGPoint(
            x: center.x + cos(angle) * orbitRadius,
            y: center.y + sin(angle) * orbitRadius * 0.55
        )

        context.setFillColor(UIColor.white.withAlphaComponent(0.22).cgColor)
        context.fillEllipse(in: CGRect(x: 86, y: 54, width: 132, height: 132))
        context.setFillColor(UIColor.white.withAlphaComponent(0.88).cgColor)
        context.fillEllipse(in: CGRect(x: movingCenter.x - 38, y: movingCenter.y - 38, width: 76, height: 76))
        context.setFillColor(UIColor.black.withAlphaComponent(0.28).cgColor)
        context.fill(CGRect(x: 80, y: 276, width: 480, height: 18))
        context.fill(CGRect(x: 80, y: 306, width: 350, height: 18))

        return pixelBuffer
    }
}

private enum DemoVideoError: Error {
    case cannotAddInput
    case frameFailed
    case writerFailed
}

private struct DemoPaywallSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 18) {
            Capsule()
                .fill(.secondary.opacity(0.3))
                .frame(width: 42, height: 5)
                .padding(.top, 6)

            VStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 42, weight: .semibold))
                    .foregroundStyle(.yellow)
                Text("Upgrade to Pro")
                    .font(.largeTitle.weight(.bold))
                Text("Unlock saved routes, advanced maps, and priority country insights.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 10) {
                planRow(title: "Monthly", price: "$9.99", detail: "Flexible access")
                planRow(title: "Annual", price: "$79.99", detail: "Best value")
            }

            Button {
                RejourneyExample.logEvent("media_paywall_cta_tapped")
                dismiss()
            } label: {
                Text("Start Pro")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            Button("Maybe Later") {
                RejourneyExample.logEvent("media_paywall_dismissed")
                dismiss()
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(24)
    }

    private func planRow(title: String, price: String, detail: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(price)
                .font(.title3.weight(.bold))
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(.secondary.opacity(0.2), lineWidth: 1)
        }
    }
}
