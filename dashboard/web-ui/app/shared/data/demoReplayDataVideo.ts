/**
 * Auto-generated demo replay fixture for the custom video demo session.
 */

export const demoReplayFixture = {
  "sessionId": "session_1779280282320_047794570aa44c92896290d6677ce0d1",
  "networkRequests": [
    {
      "id": "net_001",
      "method": "POST",
      "url": "https://api.rejourney.co/v1/sessions/initialize",
      "status": 200,
      "type": "xhr",
      "startTime": 1779280282330,
      "durationMs": 45,
      "requestSize": 1240,
      "responseSize": 850
    },
    {
      "id": "net_002",
      "method": "GET",
      "url": "https://api.burstcreatine.com/v2/products/sku/CG-001",
      "status": 200,
      "type": "xhr",
      "startTime": 1779280282430,
      "durationMs": 130,
      "requestSize": 0,
      "responseSize": 4120
    },
    {
      "id": "net_003",
      "method": "GET",
      "url": "https://api.burstcreatine.com/v2/inventory/sku/CG-001/stock",
      "status": 200,
      "type": "xhr",
      "startTime": 1779280282710,
      "durationMs": 115,
      "requestSize": 0,
      "responseSize": 512
    },
    {
      "id": "net_004",
      "method": "POST",
      "url": "https://api.rejourney.co/v1/events/batch",
      "status": 200,
      "type": "xhr",
      "startTime": 1779280283130,
      "durationMs": 62,
      "requestSize": 2400,
      "responseSize": 180
    },
    {
      "id": "net_005",
      "method": "POST",
      "url": "https://www.google-analytics.com/g/collect?v=2&tid=G-123456",
      "status": 204,
      "type": "fetch",
      "startTime": 1779280283135,
      "durationMs": 40,
      "requestSize": 890,
      "responseSize": 0
    },
    {
      "id": "net_006",
      "method": "GET",
      "url": "https://api.burstcreatine.com/v2/products/related?category=gummies&limit=4",
      "status": 200,
      "type": "xhr",
      "startTime": 1779280288730,
      "durationMs": 310,
      "requestSize": 0,
      "responseSize": 12840
    },
    {
      "id": "net_007",
      "method": "POST",
      "url": "https://api.rejourney.co/v1/metrics/flush",
      "status": 200,
      "type": "xhr",
      "startTime": 1779280291230,
      "durationMs": 55,
      "requestSize": 3120,
      "responseSize": 124
    }
  ],
  "startTime": 1779280282320,
  "endTime": 1779280292520,
  "durationSeconds": 10,
  "deviceInfo": {
    "model": "Chrome on macOS",
    "manufacturer": "Apple",
    "os": "macOS",
    "osVersion": "15.5",
    "browser": "Chrome",
    "browserVersion": "126.0.0.0",
    "screenWidth": 1920,
    "screenHeight": 1080,
    "pixelRatio": 1,
    "appVersion": "web-2026.06.1",
    "sdkVersion": "1.1.0",
    "locale": "en-US",
    "timezone": "America/New_York"
  },
  "geoLocation": {
    "country": "United States",
    "countryCode": "US",
    "region": "New York",
    "city": "New York",
    "latitude": 40.7128,
    "longitude": -74.006,
    "timezone": "America/New_York"
  },
  "events": [
    {
      "timestamp": 1779280282340,
      "message": "[Rejourney] Info: Initializing Rejourney SDK version 1.1.0 (production mode)",
      "level": "info",
      "type": "log",
      "id": "evt_log_001"
    },
    {
      "timestamp": 1779280282360,
      "message": "[Rejourney] Debug: Detected client locale: en-US, timezone: America/New_York",
      "level": "log",
      "type": "log",
      "id": "evt_log_002"
    },
    {
      "timestamp": 1779280282400,
      "message": "[Rejourney] Info: Tracking page view: /products/creatine-gummies",
      "level": "info",
      "type": "log",
      "id": "evt_log_003"
    },
    {
      "timestamp": 1779280282440,
      "message": "[Burst] Debug: Loading product details for sku=CG-001 (Creatine Gummies)",
      "level": "log",
      "type": "log",
      "id": "evt_log_004"
    },
    {
      "timestamp": 1779280282500,
      "message": "[Burst] Debug: Initializing image gallery zoom hooks...",
      "level": "log",
      "type": "log",
      "id": "evt_log_005"
    },
    {
      "timestamp": 1779280282560,
      "message": "[Burst] Info: Image assets loaded successfully: [thumb1.jpg, thumb2.jpg, main_product.jpg]",
      "level": "info",
      "type": "log",
      "id": "evt_log_006"
    },
    {
      "timestamp": 1779280282700,
      "message": "[InventoryManager] Info: Fetching stock levels for CG-001...",
      "level": "info",
      "type": "log",
      "id": "evt_log_007"
    },
    {
      "timestamp": 1779280282840,
      "message": "[InventoryManager] Debug: Stock level retrieved: 142 items remaining in regional warehouse NY-1",
      "level": "log",
      "type": "log",
      "id": "evt_log_008"
    },
    {
      "timestamp": 1779280283120,
      "message": "[Analytics] Info: Pixel event fired: ViewContent (Creatine Gummies)",
      "level": "info",
      "type": "log",
      "id": "evt_log_009"
    },
    {
      "timestamp": 1779280283420,
      "message": "[Burst] Debug: Swipe gesture detected on product image gallery carousel",
      "level": "log",
      "type": "log",
      "id": "evt_log_010"
    },
    {
      "timestamp": 1779280283670,
      "message": "[Burst] Debug: Active image carousel index changed to 1 (main product shot)",
      "level": "log",
      "type": "log",
      "id": "evt_log_011"
    },
    {
      "timestamp": 1779280284437,
      "y": 520,
      "type": "touch",
      "x": 620,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 520,
          "x": 620,
          "timestamp": 1779280284437
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v001"
    },
    {
      "timestamp": 1779280284445,
      "message": "[ZoomViewer] Error: Failed to initialize zoom viewer on target element #product-zoom-container. Container element is non-scrollable and lacks active gesture bounds.",
      "level": "error",
      "type": "error",
      "id": "evt_err_001"
    },
    {
      "timestamp": 1779280284470,
      "y": 525,
      "type": "touch",
      "x": 625,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 525,
          "x": 625,
          "timestamp": 1779280284470
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v002"
    },
    {
      "timestamp": 1779280284503,
      "y": 530,
      "type": "touch",
      "x": 630,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 530,
          "x": 630,
          "timestamp": 1779280284503
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v003"
    },
    {
      "timestamp": 1779280284537,
      "y": 535,
      "type": "touch",
      "x": 635,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 535,
          "x": 635,
          "timestamp": 1779280284537
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v004"
    },
    {
      "timestamp": 1779280284570,
      "message": "[Burst] Warn: Zoom library (medium-zoom) unresponsive or missing required gesture bounds wrapper.",
      "level": "warn",
      "type": "log",
      "id": "evt_log_012"
    },
    {
      "timestamp": 1779280284603,
      "y": 540,
      "type": "touch",
      "x": 640,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 540,
          "x": 640,
          "timestamp": 1779280284603
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v005"
    },
    {
      "timestamp": 1779280285653,
      "y": 520,
      "type": "touch",
      "x": 620,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 520,
          "x": 620,
          "timestamp": 1779280285653
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v006"
    },
    {
      "timestamp": 1779280285660,
      "message": "[ZoomViewer] Error: Double tap zoom event triggered but zoom target canvas was uninitialized.",
      "level": "error",
      "type": "error",
      "id": "evt_err_002"
    },
    {
      "timestamp": 1779280285787,
      "y": 525,
      "type": "touch",
      "x": 625,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 525,
          "x": 625,
          "timestamp": 1779280285787
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v007"
    },
    {
      "timestamp": 1779280286353,
      "y": 520,
      "type": "touch",
      "x": 620,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 520,
          "x": 620,
          "timestamp": 1779280286353
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v008"
    },
    {
      "timestamp": 1779280286360,
      "message": "[ZoomViewer] Error: Touch zoom event failed: event listener not bound to product image view node.",
      "level": "error",
      "type": "error",
      "id": "evt_err_003"
    },
    {
      "timestamp": 1779280286487,
      "y": 525,
      "type": "touch",
      "x": 625,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 525,
          "x": 625,
          "timestamp": 1779280286487
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v009"
    },
    {
      "timestamp": 1779280286587,
      "y": 530,
      "type": "touch",
      "x": 630,
      "gestureType": "dead_tap",
      "touches": [
        {
          "y": 530,
          "x": 630,
          "timestamp": 1779280286587
        }
      ],
      "label": "Product Image Zoom",
      "id": "evt_v010"
    },
    {
      "timestamp": 1779280287420,
      "message": "[Analytics] Info: Tracking custom event: ZoomFrictionDetected on component ProductZoomGrid",
      "level": "info",
      "type": "log",
      "id": "evt_log_013"
    },
    {
      "timestamp": 1779280287920,
      "message": "[Burst] Warn: User scrolling repeatedly without active selection or cart updates. Visual engagement decaying.",
      "level": "warn",
      "type": "log",
      "id": "evt_log_014"
    },
    {
      "timestamp": 1779280288720,
      "message": "[Burst] Debug: Requesting updated recommendations list for related Gummies Category...",
      "level": "log",
      "type": "log",
      "id": "evt_log_015"
    },
    {
      "timestamp": 1779280289520,
      "message": "[Burst] Info: Recommendations successfully refreshed",
      "level": "info",
      "type": "log",
      "id": "evt_log_016"
    },
    {
      "timestamp": 1779280291220,
      "message": "[Rejourney] Debug: Flushing collected metrics batch (16 events, 3 errors)...",
      "level": "log",
      "type": "log",
      "id": "evt_log_017"
    },
    {
      "timestamp": 1779280291820,
      "message": "[Burst] Info: Session exited: user abandoned product detail page.",
      "level": "info",
      "type": "log",
      "id": "evt_log_018"
    }
  ],
  "screenshotFrames": [
    {
      "timestamp": 1779280282320,
      "file": "frame_0001.jpg",
      "index": 0
    },
    {
      "timestamp": 1779280282420,
      "file": "frame_0002.jpg",
      "index": 1
    },
    {
      "timestamp": 1779280282520,
      "file": "frame_0003.jpg",
      "index": 2
    },
    {
      "timestamp": 1779280282620,
      "file": "frame_0004.jpg",
      "index": 3
    },
    {
      "timestamp": 1779280282720,
      "file": "frame_0005.jpg",
      "index": 4
    },
    {
      "timestamp": 1779280282820,
      "file": "frame_0006.jpg",
      "index": 5
    },
    {
      "timestamp": 1779280282920,
      "file": "frame_0007.jpg",
      "index": 6
    },
    {
      "timestamp": 1779280283020,
      "file": "frame_0008.jpg",
      "index": 7
    },
    {
      "timestamp": 1779280283120,
      "file": "frame_0009.jpg",
      "index": 8
    },
    {
      "timestamp": 1779280283220,
      "file": "frame_0010.jpg",
      "index": 9
    },
    {
      "timestamp": 1779280283320,
      "file": "frame_0011.jpg",
      "index": 10
    },
    {
      "timestamp": 1779280283420,
      "file": "frame_0012.jpg",
      "index": 11
    },
    {
      "timestamp": 1779280283520,
      "file": "frame_0013.jpg",
      "index": 12
    },
    {
      "timestamp": 1779280283620,
      "file": "frame_0014.jpg",
      "index": 13
    },
    {
      "timestamp": 1779280283720,
      "file": "frame_0015.jpg",
      "index": 14
    },
    {
      "timestamp": 1779280283820,
      "file": "frame_0016.jpg",
      "index": 15
    },
    {
      "timestamp": 1779280283920,
      "file": "frame_0017.jpg",
      "index": 16
    },
    {
      "timestamp": 1779280284020,
      "file": "frame_0018.jpg",
      "index": 17
    },
    {
      "timestamp": 1779280284120,
      "file": "frame_0019.jpg",
      "index": 18
    },
    {
      "timestamp": 1779280284220,
      "file": "frame_0020.jpg",
      "index": 19
    },
    {
      "timestamp": 1779280284320,
      "file": "frame_0021.jpg",
      "index": 20
    },
    {
      "timestamp": 1779280284420,
      "file": "frame_0022.jpg",
      "index": 21
    },
    {
      "timestamp": 1779280284520,
      "file": "frame_0023.jpg",
      "index": 22
    },
    {
      "timestamp": 1779280284620,
      "file": "frame_0024.jpg",
      "index": 23
    },
    {
      "timestamp": 1779280284720,
      "file": "frame_0025.jpg",
      "index": 24
    },
    {
      "timestamp": 1779280284820,
      "file": "frame_0026.jpg",
      "index": 25
    },
    {
      "timestamp": 1779280284920,
      "file": "frame_0027.jpg",
      "index": 26
    },
    {
      "timestamp": 1779280285020,
      "file": "frame_0028.jpg",
      "index": 27
    },
    {
      "timestamp": 1779280285120,
      "file": "frame_0029.jpg",
      "index": 28
    },
    {
      "timestamp": 1779280285220,
      "file": "frame_0030.jpg",
      "index": 29
    },
    {
      "timestamp": 1779280285320,
      "file": "frame_0031.jpg",
      "index": 30
    },
    {
      "timestamp": 1779280285420,
      "file": "frame_0032.jpg",
      "index": 31
    },
    {
      "timestamp": 1779280285520,
      "file": "frame_0033.jpg",
      "index": 32
    },
    {
      "timestamp": 1779280285620,
      "file": "frame_0034.jpg",
      "index": 33
    },
    {
      "timestamp": 1779280285720,
      "file": "frame_0035.jpg",
      "index": 34
    },
    {
      "timestamp": 1779280285820,
      "file": "frame_0036.jpg",
      "index": 35
    },
    {
      "timestamp": 1779280285920,
      "file": "frame_0037.jpg",
      "index": 36
    },
    {
      "timestamp": 1779280286020,
      "file": "frame_0038.jpg",
      "index": 37
    },
    {
      "timestamp": 1779280286120,
      "file": "frame_0039.jpg",
      "index": 38
    },
    {
      "timestamp": 1779280286220,
      "file": "frame_0040.jpg",
      "index": 39
    },
    {
      "timestamp": 1779280286320,
      "file": "frame_0041.jpg",
      "index": 40
    },
    {
      "timestamp": 1779280286420,
      "file": "frame_0042.jpg",
      "index": 41
    },
    {
      "timestamp": 1779280286520,
      "file": "frame_0043.jpg",
      "index": 42
    },
    {
      "timestamp": 1779280286620,
      "file": "frame_0044.jpg",
      "index": 43
    },
    {
      "timestamp": 1779280286720,
      "file": "frame_0045.jpg",
      "index": 44
    },
    {
      "timestamp": 1779280286820,
      "file": "frame_0046.jpg",
      "index": 45
    },
    {
      "timestamp": 1779280286920,
      "file": "frame_0047.jpg",
      "index": 46
    },
    {
      "timestamp": 1779280287020,
      "file": "frame_0048.jpg",
      "index": 47
    },
    {
      "timestamp": 1779280287120,
      "file": "frame_0049.jpg",
      "index": 48
    },
    {
      "timestamp": 1779280287220,
      "file": "frame_0050.jpg",
      "index": 49
    },
    {
      "timestamp": 1779280287320,
      "file": "frame_0051.jpg",
      "index": 50
    },
    {
      "timestamp": 1779280287420,
      "file": "frame_0052.jpg",
      "index": 51
    },
    {
      "timestamp": 1779280287520,
      "file": "frame_0053.jpg",
      "index": 52
    },
    {
      "timestamp": 1779280287620,
      "file": "frame_0054.jpg",
      "index": 53
    },
    {
      "timestamp": 1779280287720,
      "file": "frame_0055.jpg",
      "index": 54
    },
    {
      "timestamp": 1779280287820,
      "file": "frame_0056.jpg",
      "index": 55
    },
    {
      "timestamp": 1779280287920,
      "file": "frame_0057.jpg",
      "index": 56
    },
    {
      "timestamp": 1779280288020,
      "file": "frame_0058.jpg",
      "index": 57
    },
    {
      "timestamp": 1779280288120,
      "file": "frame_0059.jpg",
      "index": 58
    },
    {
      "timestamp": 1779280288220,
      "file": "frame_0060.jpg",
      "index": 59
    },
    {
      "timestamp": 1779280288320,
      "file": "frame_0061.jpg",
      "index": 60
    },
    {
      "timestamp": 1779280288420,
      "file": "frame_0062.jpg",
      "index": 61
    },
    {
      "timestamp": 1779280288520,
      "file": "frame_0063.jpg",
      "index": 62
    },
    {
      "timestamp": 1779280288620,
      "file": "frame_0064.jpg",
      "index": 63
    },
    {
      "timestamp": 1779280288720,
      "file": "frame_0065.jpg",
      "index": 64
    },
    {
      "timestamp": 1779280288820,
      "file": "frame_0066.jpg",
      "index": 65
    },
    {
      "timestamp": 1779280288920,
      "file": "frame_0067.jpg",
      "index": 66
    },
    {
      "timestamp": 1779280289020,
      "file": "frame_0068.jpg",
      "index": 67
    },
    {
      "timestamp": 1779280289120,
      "file": "frame_0069.jpg",
      "index": 68
    },
    {
      "timestamp": 1779280289220,
      "file": "frame_0070.jpg",
      "index": 69
    },
    {
      "timestamp": 1779280289320,
      "file": "frame_0071.jpg",
      "index": 70
    },
    {
      "timestamp": 1779280289420,
      "file": "frame_0072.jpg",
      "index": 71
    },
    {
      "timestamp": 1779280289520,
      "file": "frame_0073.jpg",
      "index": 72
    },
    {
      "timestamp": 1779280289620,
      "file": "frame_0074.jpg",
      "index": 73
    },
    {
      "timestamp": 1779280289720,
      "file": "frame_0075.jpg",
      "index": 74
    },
    {
      "timestamp": 1779280289820,
      "file": "frame_0076.jpg",
      "index": 75
    },
    {
      "timestamp": 1779280289920,
      "file": "frame_0077.jpg",
      "index": 76
    },
    {
      "timestamp": 1779280290020,
      "file": "frame_0078.jpg",
      "index": 77
    },
    {
      "timestamp": 1779280290120,
      "file": "frame_0079.jpg",
      "index": 78
    },
    {
      "timestamp": 1779280290220,
      "file": "frame_0080.jpg",
      "index": 79
    },
    {
      "timestamp": 1779280290320,
      "file": "frame_0081.jpg",
      "index": 80
    },
    {
      "timestamp": 1779280290420,
      "file": "frame_0082.jpg",
      "index": 81
    },
    {
      "timestamp": 1779280290520,
      "file": "frame_0083.jpg",
      "index": 82
    },
    {
      "timestamp": 1779280290620,
      "file": "frame_0084.jpg",
      "index": 83
    },
    {
      "timestamp": 1779280290720,
      "file": "frame_0085.jpg",
      "index": 84
    },
    {
      "timestamp": 1779280290820,
      "file": "frame_0086.jpg",
      "index": 85
    },
    {
      "timestamp": 1779280290920,
      "file": "frame_0087.jpg",
      "index": 86
    },
    {
      "timestamp": 1779280291020,
      "file": "frame_0088.jpg",
      "index": 87
    },
    {
      "timestamp": 1779280291120,
      "file": "frame_0089.jpg",
      "index": 88
    },
    {
      "timestamp": 1779280291220,
      "file": "frame_0090.jpg",
      "index": 89
    },
    {
      "timestamp": 1779280291320,
      "file": "frame_0091.jpg",
      "index": 90
    },
    {
      "timestamp": 1779280291420,
      "file": "frame_0092.jpg",
      "index": 91
    },
    {
      "timestamp": 1779280291520,
      "file": "frame_0093.jpg",
      "index": 92
    },
    {
      "timestamp": 1779280291620,
      "file": "frame_0094.jpg",
      "index": 93
    },
    {
      "timestamp": 1779280291720,
      "file": "frame_0095.jpg",
      "index": 94
    },
    {
      "timestamp": 1779280291820,
      "file": "frame_0096.jpg",
      "index": 95
    },
    {
      "timestamp": 1779280291920,
      "file": "frame_0097.jpg",
      "index": 96
    },
    {
      "timestamp": 1779280292020,
      "file": "frame_0098.jpg",
      "index": 97
    },
    {
      "timestamp": 1779280292120,
      "file": "frame_0099.jpg",
      "index": 98
    },
    {
      "timestamp": 1779280292220,
      "file": "frame_0100.jpg",
      "index": 99
    },
    {
      "timestamp": 1779280292320,
      "file": "frame_0101.jpg",
      "index": 100
    },
    {
      "timestamp": 1779280292420,
      "file": "frame_0102.jpg",
      "index": 101
    },
    {
      "timestamp": 1779280292520,
      "file": "frame_0103.jpg",
      "index": 102
    }
  ],
  "screenshotFramesStatus": "ready",
  "screenshotFramesProcessedSegments": 1,
  "screenshotFramesTotalSegments": 1,
  "screensVisited": [
    "Product Detail"
  ],
  "stats": {
    "duration": "0:10",
    "durationMinutes": "0.17",
    "eventCount": 31,
    "frameCount": 103,
    "screenshotSegmentCount": 1,
    "totalSizeBytes": 1582900,
    "eventsSizeBytes": 1500,
    "screenshotSizeBytes": 1581700,
    "hierarchySizeBytes": 0,
    "networkSizeBytes": 23902,
    "totalSizeKB": "1569.2",
    "kbPerMinute": "9415",
    "eventsSizeKB": "1.5",
    "screenshotSizeKB": "1544.6",
    "hierarchySizeKB": "0.0",
    "networkSizeKB": "23.3",
    "networkStats": {
      "total": 7,
      "successful": 7,
      "failed": 0,
      "avgDuration": 108,
      "totalBytes": 23902
    }
  },
  "metrics": {
    "totalEvents": 31,
    "touchCount": 10,
    "scrollCount": 0,
    "gestureCount": 0,
    "inputCount": 0,
    "navigationCount": 1,
    "errorCount": 3,
    "rageTapCount": 0,
    "deadTapCount": 10,
    "apiSuccessCount": 7,
    "apiErrorCount": 0,
    "apiTotalCount": 7,
    "screensVisited": [
      "Product Detail"
    ],
    "uniqueScreensCount": 1,
    "interactionScore": 75,
    "explorationScore": 80,
    "uxScore": 100,
    "customEventCount": 1
  }
};
