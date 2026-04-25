import React from 'react';
import MapGL, { Marker, NavigationControl, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '~/shared/config/runtimeEnv';

const MAPBOX_TOKEN = getMapboxToken();
const GEO_MAP_STYLE = 'mapbox://styles/mapbox/standard';
const GEO_MAP_CONFIG = {
  basemap: {
    lightPreset: 'day',
    show3dObjects: false,
    showAdminBoundaries: true,
    showPedestrianRoads: false,
    showPointOfInterestLabels: false,
    showTransitLabels: true,
    colorGreenspace: '#8fe39d',
    colorWater: '#58c9f5',
    colorLand: '#c8efbf',
    colorRoads: '#f2a0b6',
    colorMotorways: '#ef8ba4',
    colorTrunks: '#e9a06f',
  },
};

function applyGeoMapConfig(map: any): void {
  if (!map || typeof map.setConfigProperty !== 'function') return;

  Object.entries(GEO_MAP_CONFIG.basemap).forEach(([property, value]) => {
    map.setConfigProperty('basemap', property, value);
  });
}

function getMapInstance(mapRef: React.MutableRefObject<any>) {
  return mapRef.current?.getMap?.() ?? mapRef.current;
}

function getWeightedMapCenter(markers: GeoMapMarker[]) {
  const validMarkers = markers.filter((marker) => Number.isFinite(marker.lng) && Number.isFinite(marker.lat));
  if (validMarkers.length === 0) {
    return { longitude: -28, latitude: 22 };
  }

  let weightedSin = 0;
  let weightedCos = 0;
  let weightedLat = 0;
  let totalWeight = 0;

  validMarkers.forEach((marker) => {
    const weight = Math.max(marker.sessions, marker.uniqueUsers, 1);
    const radians = (marker.lng * Math.PI) / 180;
    weightedSin += Math.sin(radians) * weight;
    weightedCos += Math.cos(radians) * weight;
    weightedLat += marker.lat * weight;
    totalWeight += weight;
  });

  const longitude = (Math.atan2(weightedSin / totalWeight, weightedCos / totalWeight) * 180) / Math.PI;
  const latitude = Math.max(-38, Math.min(52, weightedLat / totalWeight));
  return { longitude, latitude };
}

type LatencyTier = 'excellent' | 'good' | 'degraded' | 'critical' | 'unknown';

interface MarkerStyle {
  fill: string;
  solid: string;
  ring: string;
  face: 'happy' | 'neutral' | 'angry';
}

export interface GeoMapMarker {
  id: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  sessions: number;
  uniqueUsers: number;
  avgLatencyMs?: number;
  latencyTier: LatencyTier;
  markerSize: number;
  style: MarkerStyle;
}

function formatLatency(value?: number): string {
  if (!value || Number.isNaN(value)) return 'N/A';
  return `${Math.round(value)}ms`;
}

function getZoomMarkerSize(baseSize: number, zoom: number): number {
  const zoomScale = 1 + Math.max(0, zoom - 1.25) * 0.34;
  return Math.round(Math.max(18, Math.min(56, baseSize * zoomScale)));
}

function renderLatencyFace(face: MarkerStyle['face']) {
  const mouthStyle: React.CSSProperties =
    face === 'happy'
      ? {
          left: '29%',
          top: '47%',
          width: '42%',
          height: '26%',
          borderBottom: '2px solid rgba(3, 7, 18, 0.86)',
          borderRadius: '0 0 999px 999px',
        }
      : face === 'angry'
        ? {
            left: '32%',
            top: '62%',
            width: '36%',
            height: '18%',
            borderTop: '2px solid rgba(3, 7, 18, 0.86)',
            borderRadius: '999px 999px 0 0',
          }
        : {
            left: '32%',
            top: '59%',
            width: '36%',
            height: '2px',
            backgroundColor: 'rgba(3, 7, 18, 0.82)',
            borderRadius: '999px',
          };

  return (
    <span className="pointer-events-none absolute inset-0 block">
      <span
        className="absolute rounded-full bg-slate-950"
        style={{ left: '29%', top: '33%', width: '10%', height: '10%' }}
      />
      <span
        className="absolute rounded-full bg-slate-950"
        style={{ right: '29%', top: '33%', width: '10%', height: '10%' }}
      />
      {face === 'angry' && (
        <>
          <span
            className="absolute bg-slate-950"
            style={{ left: '24%', top: '25%', width: '19%', height: '2px', transform: 'rotate(24deg)' }}
          />
          <span
            className="absolute bg-slate-950"
            style={{ right: '24%', top: '25%', width: '19%', height: '2px', transform: 'rotate(-24deg)' }}
          />
        </>
      )}
      <span className="absolute block" style={mouthStyle} />
    </span>
  );
}

export const GeoMapCanvas: React.FC<{ markers: GeoMapMarker[] }> = ({ markers }) => {
  const [hoveredMarkerId, setHoveredMarkerId] = React.useState<string | null>(null);
  const [mapZoom, setMapZoom] = React.useState(1.34);
  const mapRef = React.useRef<any>(null);
  const isHoverPausedRef = React.useRef(false);
  const isInteractionPausedRef = React.useRef(false);
  const resumeRotationTimerRef = React.useRef<number | null>(null);

  const initialViewState = React.useMemo(() => {
    const center = getWeightedMapCenter(markers);
    return {
      longitude: center.longitude,
      latitude: center.latitude,
      zoom: 1.34,
      pitch: 14,
      bearing: 0,
    };
  }, [markers]);

  const hoveredMarker = React.useMemo(
    () => (hoveredMarkerId ? markers.find((marker) => marker.id === hoveredMarkerId) || null : null),
    [markers, hoveredMarkerId],
  );

  React.useEffect(() => {
    let animationFrame = 0;
    let previousTime = performance.now();

    const rotateGlobe = (time: number) => {
      const map = getMapInstance(mapRef);
      if (!map || isHoverPausedRef.current || isInteractionPausedRef.current) return;

      const center = map.getCenter();
      const deltaSeconds = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      map.setCenter([center.lng + deltaSeconds * 1.8, center.lat]);
    };

    const tick = (time: number) => {
      rotateGlobe(time);
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (resumeRotationTimerRef.current) {
        window.clearTimeout(resumeRotationTimerRef.current);
      }
    };
  }, []);

  const pauseRotationBriefly = () => {
    isInteractionPausedRef.current = true;
    if (resumeRotationTimerRef.current) {
      window.clearTimeout(resumeRotationTimerRef.current);
    }
    resumeRotationTimerRef.current = window.setTimeout(() => {
      isInteractionPausedRef.current = false;
      resumeRotationTimerRef.current = null;
    }, 2400);
  };

  const setHoverPaused = (isPaused: boolean) => {
    isHoverPausedRef.current = isPaused;
  };

  return (
    <>
      <div
        className="relative h-[560px] w-full overflow-hidden bg-[#05070d]"
        onMouseEnter={() => setHoverPaused(true)}
        onMouseLeave={() => setHoverPaused(false)}
        onFocus={() => setHoverPaused(true)}
        onBlur={() => setHoverPaused(false)}
      >
        <MapGL
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          reuseMaps
          initialViewState={initialViewState}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          mapStyle={GEO_MAP_STYLE}
          projection={{ name: 'globe' }}
          dragPan
          dragRotate
          scrollZoom
          touchZoomRotate
          doubleClickZoom
          keyboard
          cursor="grab"
          onDragStart={pauseRotationBriefly}
          onZoomStart={pauseRotationBriefly}
          onRotateStart={pauseRotationBriefly}
          onZoom={(event: any) => setMapZoom(event.viewState.zoom)}
          onLoad={(event: any) => {
            mapRef.current = event.target;
            applyGeoMapConfig(event.target);
          }}
          onError={(event: any) => console.error('[Mapbox] error:', event)}
        >
          <NavigationControl position="bottom-right" showCompass showZoom />

          {markers.map((marker) => {
            const isHovered = marker.id === hoveredMarkerId;
            const markerSize = getZoomMarkerSize(marker.markerSize, mapZoom);
            return (
              <Marker
                key={marker.id}
                longitude={marker.lng}
                latitude={marker.lat}
                anchor="center"
              >
                <button
                  type="button"
                  className="relative rounded-full transition-transform duration-150"
                  style={{
                    width: `${markerSize}px`,
                    height: `${markerSize}px`,
                    transform: isHovered ? 'scale(1.18)' : 'scale(1)',
                    background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.82) 0, ${marker.style.fill} 27%, ${marker.style.solid} 100%)`,
                    border: '1.5px solid rgba(8, 13, 23, 0.62)',
                    opacity: isHovered ? 1 : 0.9,
                    boxShadow: isHovered
                      ? `0 0 0 3px rgba(255,255,255,0.86), 0 0 0 6px ${marker.style.ring}, 0 0 20px ${marker.style.ring}, 0 5px 14px rgba(2,6,23,0.32)`
                      : `0 0 0 2px rgba(255,255,255,0.78), 0 0 0 4px ${marker.style.ring}, 0 3px 10px rgba(2,6,23,0.22)`,
                  }}
                  aria-label={`${marker.city}, ${marker.country}: ${marker.uniqueUsers.toLocaleString()} unique users, ${marker.sessions.toLocaleString()} sessions, ${formatLatency(marker.avgLatencyMs)} avg latency`}
                  onMouseEnter={() => setHoveredMarkerId(marker.id)}
                  onMouseLeave={() => setHoveredMarkerId((prev) => (prev === marker.id ? null : prev))}
                >
                  {renderLatencyFace(marker.style.face)}
                </button>
              </Marker>
            );
          })}

          {hoveredMarker && (
            <Popup
              longitude={hoveredMarker.lng}
              latitude={hoveredMarker.lat}
              closeButton={false}
              closeOnClick={false}
              anchor="bottom"
              offset={14}
              className="geo-hover-popup"
            >
              <div className="border-2 border-black bg-white px-2.5 py-2 text-[11px] text-slate-700 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] backdrop-blur-[2px]">
                <div className="mb-0.5 font-semibold text-slate-900">
                  {hoveredMarker.city}, {hoveredMarker.country}
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <span>{hoveredMarker.uniqueUsers.toLocaleString()} unique users</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>{hoveredMarker.sessions.toLocaleString()} sessions</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span style={{ color: hoveredMarker.style.solid }}>{formatLatency(hoveredMarker.avgLatencyMs)}</span>
                </div>
              </div>
            </Popup>
          )}
        </MapGL>
      </div>

      <style>{`
        .geo-hover-popup .mapboxgl-popup-content {
          background: transparent !important;
          box-shadow: none !important;
          padding: 0 !important;
          pointer-events: none !important;
        }
        .geo-hover-popup .mapboxgl-popup-tip {
          border-top-color: rgba(255, 255, 255, 0.92) !important;
        }
      `}</style>
    </>
  );
};

export default GeoMapCanvas;
