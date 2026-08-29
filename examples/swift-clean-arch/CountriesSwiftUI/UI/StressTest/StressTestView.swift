//
//  StressTestView.swift
//  CountriesSwiftUI
//
//  Stress screens for manual SDK testing (matrix cases S6 and S7).
//
//  Map, video and media masking already have their own tabs here. What was
//  missing were the two cases that strain the capture path without any media
//  API involved: a long scroll over many decoded images, and a view tree deep
//  and wide enough to exercise the hierarchy scanner's depth cap and time
//  budget.
//
//  Images are generated on device rather than downloaded, so the screen is
//  deterministic, offline-safe, and carries no licensing question.
//

import SwiftUI
import UIKit
import Rejourney

struct StressTestView: View {
    @State private var pauseStatus = "Recording active"

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink {
                        StressImageScrollView()
                    } label: {
                        Label("S6 · Image scroll", systemImage: "photo.stack")
                    }

                    NavigationLink {
                        StressDenseView()
                    } label: {
                        Label("S7 · Dense view tree", systemImage: "square.grid.4x3.fill")
                    }
                } header: {
                    Text("Capture stress")
                } footer: {
                    Text("Map, video and media masking have their own tabs. "
                         + "These cover scroll depth and hierarchy depth.")
                }

                Section {
                    Text(pauseStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("rejourney-pause-status")

                    Button {
                        let succeeded = Rejourney.pause()
                        pauseStatus = succeeded ? "SDK paused · interact now" : "Pause unavailable"
                    } label: {
                        Label("Pause SDK", systemImage: "pause.circle")
                    }
                    .accessibilityIdentifier("pause-rejourney-sdk")

                    Button {
                        let succeeded = Rejourney.resume()
                        pauseStatus = succeeded ? "SDK resumed · same session" : "Resume unavailable"
                    } label: {
                        Label("Resume SDK", systemImage: "play.circle")
                    }
                    .accessibilityIdentifier("resume-rejourney-sdk")

                    Button {
                        pauseStatus = "SDK stopping · awaiting final upload"
                        Task { @MainActor in
                            let result = await Rejourney.stop()
                            pauseStatus = result.success && result.uploadSuccess
                                ? "SDK stopped · flushed"
                                : "SDK stop completed · upload pending"
                        }
                    } label: {
                        Label("Stop & Flush SDK", systemImage: "stop.circle")
                    }
                    .accessibilityIdentifier("stop-rejourney-sdk")
                } header: {
                    Text("Beta SDK Pause")
                } footer: {
                    Text("Repeat pause or resume to validate idempotence. Stop & Flush closes the matrix session cleanly.")
                }
            }
            .navigationTitle("Stress")
        }
    }
}

/// S6. Many decoded images in a long scroll. Watch `framesSkippedBacklog`:
/// if it climbs, JPEG encoding is not keeping up with capture.
private struct StressImageScrollView: View {
    private let count = 60

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(0..<count, id: \.self) { index in
                    VStack(alignment: .leading, spacing: 6) {
                        Image(uiImage: StressImageFactory.image(seed: index))
                            .resizable()
                            .aspectRatio(16.0 / 9.0, contentMode: .fill)
                            .frame(height: 180)
                            .clipped()
                            .cornerRadius(10)

                        Text("Item \(index + 1) of \(count)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                }
            }
            .padding(.vertical, 12)
        }
        .navigationTitle("S6 · Image scroll")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// S7. A deep, wide view tree. The hierarchy scanner caps depth at 24 and
/// bails out after 16ms; this screen should produce `truncated` or `bailout`
/// markers on the captured tree rather than blocking the main thread.
private struct StressDenseView: View {
    private let rows = 40
    private let columns = 6
    private let nesting = 14

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(0..<rows, id: \.self) { row in
                    HStack(spacing: 2) {
                        ForEach(0..<columns, id: \.self) { column in
                            NestedBox(depth: nesting) {
                                Text("\(row).\(column)")
                                    .font(.system(size: 9))
                                    .frame(maxWidth: .infinity, minHeight: 40)
                                    .background(
                                        Color(
                                            hue: Double((row * columns + column) % 20) / 20.0,
                                            saturation: 0.25,
                                            brightness: 0.95
                                        )
                                    )
                            }
                        }
                    }
                }
            }
            .padding(6)
        }
        .navigationTitle("S7 · Dense tree")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Wraps its content in `depth` nested containers, so a single cell contributes
/// many levels to the view hierarchy.
private struct NestedBox<Content: View>: View {
    let depth: Int
    @ViewBuilder var content: () -> Content

    var body: some View {
        nested(level: depth)
    }

    @ViewBuilder
    private func nested(level: Int) -> some View {
        if level <= 0 {
            content()
        } else {
            AnyView(
                nested(level: level - 1)
                    .padding(0.5)
                    .background(Color.primary.opacity(0.02))
            )
        }
    }
}

/// Deterministic on-device image generation. Each seed produces a distinct
/// image, so the SDK's frame deduplication sees genuine changes while
/// scrolling rather than one repeated picture.
private enum StressImageFactory {
    static func image(seed: Int) -> UIImage {
        let size = CGSize(width: 640, height: 360)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1

        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cgContext = context.cgContext
            let hue = Double(seed % 24) / 24.0

            cgContext.setFillColor(
                UIColor(hue: hue, saturation: 0.55, brightness: 0.9, alpha: 1).cgColor
            )
            cgContext.fill(CGRect(origin: .zero, size: size))

            for i in 0..<14 {
                let inset = CGFloat(i) * 11
                cgContext.setStrokeColor(
                    UIColor(
                        hue: (hue + Double(i) / 40.0).truncatingRemainder(dividingBy: 1),
                        saturation: 0.7,
                        brightness: 0.75,
                        alpha: 0.8
                    ).cgColor
                )
                cgContext.setLineWidth(3)
                cgContext.strokeEllipse(
                    in: CGRect(origin: .zero, size: size).insetBy(dx: inset, dy: inset / 2)
                )
            }

            let label = "STRESS \(seed)" as NSString
            label.draw(
                at: CGPoint(x: 18, y: 16),
                withAttributes: [
                    .font: UIFont.boldSystemFont(ofSize: 30),
                    .foregroundColor: UIColor.white
                ]
            )
        }
    }
}
