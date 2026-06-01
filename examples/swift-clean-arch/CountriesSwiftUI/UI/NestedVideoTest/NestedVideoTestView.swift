//
//  NestedVideoTestView.swift
//  CountriesSwiftUI
//
//  Created by Rejourney on 6/1/26.
//

import AVFoundation
import SwiftUI
import UIKit

struct NestedVideoTestView: View {

    @State private var isPlaying = false
    @State private var showsPoster = true

    private let videoURL = NestedVideoResources.url(named: "brew-nested-video-demo", fileExtension: "mp4")
    private let posterURL = NestedVideoResources.url(named: "brew-video-poster", fileExtension: "png")

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Nested Video Button")
                            .font(.title2.weight(.bold))
                        Text("Native AVPlayerLayer with UIImageView poster")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    nestedContainer {
                        Button {
                            togglePlayback()
                        } label: {
                            ZStack {
                                if let videoURL {
                                    NativeNestedVideoPlayer(url: videoURL, isPlaying: isPlaying)
                                } else {
                                    missingMediaView("Missing video")
                                }

                                if showsPoster {
                                    NativePosterImage(url: posterURL)
                                        .transition(.opacity)
                                }

                                videoControlOverlay
                            }
                            .frame(height: 220)
                            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .simultaneousGesture(
                            LongPressGesture(minimumDuration: 0.25).onEnded { _ in
                                playFromPoster()
                            }
                        )
                    }
                }
                .padding(18)
            }
            .navigationTitle("Nested Video")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                RejourneyExample.trackScreen("Nested Video Test")
            }
        }
    }

    private var videoControlOverlay: some View {
        VStack {
            Spacer()
            HStack(spacing: 9) {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 14, weight: .bold))
                Text(isPlaying ? "Pause Video" : "Play Video")
                    .font(.headline)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.black.opacity(0.52), in: Capsule())
            .padding(.bottom, 18)
        }
    }

    private func nestedContainer<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 10) {
            HStack {
                Label("Tap or long press", systemImage: "hand.tap")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
            }

            ZStack {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(Color(red: 0.95, green: 0.91, blue: 0.86))
                VStack {
                    HStack {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(.white.opacity(0.78))
                            .frame(width: 104, height: 18)
                        Spacer()
                    }
                    Spacer()
                }
                .padding(20)

                content()
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(.black.opacity(0.12), lineWidth: 1)
                    }
                    .padding(18)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.08), radius: 14, y: 8)
    }

    private func missingMediaView(_ text: String) -> some View {
        ZStack {
            Color.black
            Text(text)
                .font(.headline)
                .foregroundStyle(.white)
        }
    }

    private func togglePlayback() {
        withAnimation(.easeInOut(duration: 0.18)) {
            showsPoster = false
            isPlaying.toggle()
        }
        RejourneyExample.logEvent(isPlaying ? "nested_video_played" : "nested_video_paused")
    }

    private func playFromPoster() {
        withAnimation(.easeInOut(duration: 0.18)) {
            showsPoster = false
            isPlaying = true
        }
        RejourneyExample.logEvent("nested_video_long_pressed")
    }
}

private enum NestedVideoResources {
    static func url(named name: String, fileExtension: String) -> URL? {
        let subdirectory = "Media"

        #if SWIFT_PACKAGE
        if let url = Bundle.module.url(forResource: name, withExtension: fileExtension, subdirectory: subdirectory) {
            return url
        }
        #endif

        let bundles = [Bundle.main, Bundle(for: NestedVideoResourceToken.self)]
        for bundle in bundles {
            if let url = bundle.url(forResource: name, withExtension: fileExtension, subdirectory: subdirectory) {
                return url
            }
            if let url = bundle.url(forResource: name, withExtension: fileExtension) {
                return url
            }
        }
        return nil
    }
}

private final class NestedVideoResourceToken {}

private struct NativePosterImage: UIViewRepresentable {
    let url: URL?

    func makeUIView(context: Context) -> UIImageView {
        let imageView = UIImageView()
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.backgroundColor = UIColor(red: 0.95, green: 0.91, blue: 0.86, alpha: 1)
        imageView.accessibilityLabel = "Native nested video poster"
        updateImage(imageView)
        return imageView
    }

    func updateUIView(_ uiView: UIImageView, context: Context) {
        updateImage(uiView)
    }

    private func updateImage(_ imageView: UIImageView) {
        guard let url else {
            imageView.image = nil
            return
        }
        imageView.image = UIImage(contentsOfFile: url.path)
    }
}

private struct NativeNestedVideoPlayer: UIViewRepresentable {
    let url: URL
    let isPlaying: Bool

    func makeUIView(context: Context) -> NativeNestedVideoPlayerView {
        let view = NativeNestedVideoPlayerView()
        view.configure(url: url)
        view.setPlaying(isPlaying)
        return view
    }

    func updateUIView(_ uiView: NativeNestedVideoPlayerView, context: Context) {
        uiView.configure(url: url)
        uiView.setPlaying(isPlaying)
    }

    static func dismantleUIView(_ uiView: NativeNestedVideoPlayerView, coordinator: ()) {
        uiView.setPlaying(false)
    }
}

private final class NativeNestedVideoPlayerView: UIView {
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
        backgroundColor = .black
        clipsToBounds = true
        playerLayer.videoGravity = .resizeAspectFill
        accessibilityLabel = "Native nested video player"
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
        player.actionAtItemEnd = .none
        player.isMuted = true

        queuePlayer = player
        playerLooper = looper
        playerLayer.player = player
    }

    func setPlaying(_ playing: Bool) {
        if playing {
            queuePlayer?.play()
        } else {
            queuePlayer?.pause()
        }
    }
}
