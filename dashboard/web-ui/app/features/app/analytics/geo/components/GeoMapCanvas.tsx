import React from 'react';
import MapGL, { Marker, NavigationControl, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getMapboxToken } from '~/shared/config/runtimeEnv';

const MAPBOX_TOKEN = getMapboxToken();

type LatencyTier = 'excellent' | 'good' | 'degraded' | 'critical' | 'unknown';

interface MarkerStyle {
  fill: string;
  solid: string;
  ring: string;
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

export const GeoMapCanvas: React.FC<{ markers: GeoMapMarker[] }> = ({ markers }) => {
  const [hoveredMarkerId, setHoveredMarkerId] = React.useState<string | null>(null);

  const hoveredMarker = React.useMemo(
    () => (hoveredMarkerId ? markers.find((marker) => marker.id === hoveredMarkerId) || null : null),
    [markers, hoveredMarkerId],
  );

  return (
    <>
      <div className="relative h-[560px] w-full overflow-hidden bg-white">
        <MapGL
          mapboxAccessToken={MAPBOX_TOKEN}
          reuseMaps
          initialViewState={{
            longitude: 8,
            latitude: 20,
            zoom: 1.45,
            pitch: 18,
            bearing: 0,
          }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/light-v11"
          projection={{ name: 'globe' }}
          dragPan
          dragRotate
          scrollZoom
          touchZoomRotate
          doubleClickZoom
          keyboard
          cursor="grab"
          onError={(event: any) => console.error('[Mapbox] error:', event)}
        >
          <NavigationControl position="bottom-right" showCompass showZoom />

          {markers.map((marker) => {
            const isHovered = marker.id === hoveredMarkerId;
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
                    width: `${marker.markerSize}px`,
                    height: `${marker.markerSize}px`,
                    transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                    backgroundColor: marker.style.fill,
                    border: '1.5px solid rgba(15, 23, 42, 0.38)',
                    boxShadow: isHovered
                      ? `0 0 0 2px ${marker.style.ring}, 0 3px 8px rgba(15,23,42,0.24)`
                      : '0 1px 3px rgba(15,23,42,0.24)',
                  }}
                  aria-label={`${marker.city}, ${marker.country}: ${marker.uniqueUsers.toLocaleString()} unique users, ${marker.sessions.toLocaleString()} sessions, ${formatLatency(marker.avgLatencyMs)} avg latency`}
                  onMouseEnter={() => setHoveredMarkerId(marker.id)}
                  onMouseLeave={() => setHoveredMarkerId((prev) => (prev === marker.id ? null : prev))}
                />
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
