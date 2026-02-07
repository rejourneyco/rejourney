<div align="center">
  <h1>
    <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney Logo" width="40" style="vertical-align: middle;" />
    Rejourney
  </h1>

  <img src="https://rejourney.co/images/session-replay-preview.png" alt="Rejourney Session Replay" width="100%" />

  <p>
    <strong>Lightweight session replay and observability for React Native</strong>
    <br />
    Mobile-first focus with pixel-perfect video capture and real-time incident detection.
  </p>
  
  <p>
    <a href="https://rejourney.co"><strong>Explore the Website »</strong></a>
  </p>
  
  <p>
    <a href="https://reactnative.dev"><img src="https://img.shields.io/badge/React%20Native-61DAFB?logo=react&logoColor=black" alt="React Native" /></a>
    <a href="https://expo.dev"><img src="https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white" alt="Expo" /></a>
  </p>
</div>

## Features

### Pixel Perfect Capture
True FPS video playback capturing every rendered pixel. Unlike competitors, we capture everything—including Mapbox (Metal), custom shaders, and GPU-accelerated views.

### Live Incident Stream
![Issues Feed](https://rejourney.co/images/issues-feed.png)

See crashes, errors, and rage taps as they happen in real-time with instant crash reporting.

### Error/ANR/Crash Detection
![ANR Issues](https://rejourney.co/images/anr-issues.png)

Automatic detection of Application Not Responding events with full thread dumps and main thread analysis.

### Journey Mapping
![User Journeys](https://rejourney.co/images/user-journeys.png)

Visualize how users navigate your app. Identify high-friction drop-off points and optimize conversion funnels.

### Interaction Heat Maps
![Heatmaps](https://rejourney.co/heatmaps-demo.png)

**Visualize user engagement with precision.** See where they tap, swipe, and scroll to optimize UI placement.

### Global Stability
![Geo Intelligence](https://rejourney.co/images/geo-intelligence.png)

Monitor performance and stability across different regions. Spot infrastructure issues before they affect your global audience.

### Growth Engines
![Growth Engines](https://rejourney.co/images/growth-engines.png)
Track user retention and loyalty segments. Understand how releases impact your power users versus bounce rates.

### Team Alerts
![Team Alerts](https://rejourney.co/images/team-alerts.png)
Smart email notifications for crashes, ANRs, and error spikes. Role-based access for engineering teams.

## Documentation

Full integration guides and API reference: https://rejourney.co/docs/reactnative/overview

### Self-Hosting

- Single Docker-file self-hosting: https://rejourney.co/docs/selfhosted
- Enterprise-grade K3s hosting (architecture docs): https://rejourney.co/docs/architecture/distributed-vs-single-node

## Contributing

Want to contribute to Rejourney? See our Contributing Guide: https://rejourney.co/docs/community/contributing

## Benchmarks

Rejourney is designed to be **invisible to the eye**. We utilize an **Async Capture Pipeline** combined with **Run Loop Gating**, ensuring the SDK automatically pauses during interactions (touches/scrolls) to maintain 100% UI responsiveness.

**Device:** iPhone 15 Pro (iOS 18)  
**Environment:** Expo SDK 54, React Native New Architecture (Concurrent Mode)  
**Test App:** [Merch App](https://merchcampus.com) (Production build with Mapbox Metal + Firebase)  
**Test Workload:** 46 complex feed items, Mapbox GL View, 124 API calls, 31 subcomponents, active gesture tracking, and real-time privacy redaction.

| Metric | Avg (ms) | Max (ms) | Min (ms) | Thread |
| :--- | :---: | :---: | :---: | :---: |
| **Main: UIKit + Metal Capture** | **12.4** | 28.2 | 8.1 | Main |
| **BG: Async Image Processing** | 42.5 | 88.0 | 32.4 | Background |
| **BG: Tar+Gzip Compression** | 14.2 | 32.5 | 9.6 | Background |
| **BG: Upload Handshake** | 0.8 | 2.4 | 0.3 | Background |
| **Total Main Thread Impact** | **12.4** | 28.2 | 8.1 | Main |

*Note: Total Main Thread Impact is the only work that blocks your app's rendering.*

## Engineering

Engineering decisions and architecture: https://rejourney.co/engineering

## License

Client-side components (SDKs, CLIs) are licensed under Apache 2.0. Server-side components (backend, dashboard) are licensed under SSPL 1.0. See [LICENSE-APACHE](LICENSE-APACHE) and [LICENSE-SSPL](LICENSE-SSPL) for details.
