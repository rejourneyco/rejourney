# Rejourney

<div align="center">
  <img src="https://rejourney.co/rejourneyIcon-removebg-preview.png" alt="Rejourney Logo" width="120" />
</div>

  <strong>Lightweight session replay and observability for React Native</strong>
  <br />
  Mobile-first focus with pixel-perfect video capture and real-time incident detection.
  <br />
  <br />
  <a href="https://rejourney.co"><strong>Explore the Website »</strong></a>
</div>

<br />

<div align="center">
  <a href="https://reactnative.dev"><img src="https://img.shields.io/badge/React%20Native-61DAFB?logo=react&logoColor=black" alt="React Native" /></a>
  <a href="https://expo.dev"><img src="https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white" alt="Expo" /></a>
</div>

<br />

## Features

### Pixel Perfect Session Replay
![Session Replay](https://rejourney.co/images/session-replay-preview.png)
True FPS video playback capturing every interaction. Works with maps, advanced graphics, and every view.

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
Visualize user engagement with precision. See where they tap, swipe, and scroll to optimize UI placement.

### Global Stability
![Geo Intelligence](https://rejourney.co/images/geo-intelligence.png)
Monitor performance and stability across different regions. Spot infrastructure issues before they affect your global audience.

### Growth Engines
![Growth Engines](https://rejourney.co/images/growth-engines.png)
Track user retention and loyalty segments. Understand how releases impact your power users versus bounce rates.

### Team Alerts
![Team Alerts](https://rejourney.co/images/team-alerts.png)
Smart email notifications for crashes, ANRs, and error spikes. Role-based access for engineering teams.

## Our Documentation

Full integration guides and API reference: https://rejourney.co/docs/reactnative/overview

### Self-Hosting

- Single Docker-file self-hosting: https://rejourney.co/docs/selfhosted
- Enterprise-grade K3s hosting (architecture docs): https://rejourney.co/docs/architecture/distributed-vs-single-node

## Contributing

Want to contribute to Rejourney? See our Contributing Guide: https://rejourney.co/docs/community/contributing

## Benchmarks

Rejourney is designed to be **invisible to the eye**. We capture frames only during moments of stillness using our Heuristic Engine, ensuring zero UI stutter even during heavy usage.

**Device:** iPhone 15 Pro (iOS 26)  
**Environment:** Expo SDK 54, React Native New Architecture  
**Test App:** [Merch App](https://merchcampus.com)
**Test App Conditions:** 46 posts (and post images) flat list, posting images via camera, Mapbox View, 124 API Calls, 10 pages, 31 subcomponets on home page, 31 interactions (pan, scroll, zoom, etc), and privacy masking for camera + text input for posting.

| Metric | Avg (ms) | Max (ms) | Min (ms) |
| :--- | :---: | :---: | :---: |
| **frame_total** | **17.5** | 66.0 | 0.01 |
| **screenshot_ui** | 22.8 | 65.8 | 8.4 |
| **render_draw** | 12.8 | 25.2 | 7.2 |
| **view_scan** | 5.1 | 28.3 | 0.69 |
| **view_serialize** | 1.5 | 3.6 | 0.16 |
| **downscale** | 58.6 | 400.7 | 9.4 |
| **encode_h264** | 85.5 | 1989.1 | 0.34 |

*Note: frame_total indicates main thread time.*

## Engineering

Engineering decisions and architecture: https://rejourney.co/engineering

## License

Client-side components (SDKs, CLIs) are licensed under Apache 2.0. Server-side components (backend, dashboard) are licensed under SSPL 1.0. See [LICENSE-APACHE](LICENSE-APACHE) and [LICENSE-SSPL](LICENSE-SSPL) for details.
