// @ts-ignore: mapbox-gl default export typing can vary across versions
import mapboxgl from "mapbox-gl";

import { getMapboxToken } from "~/shared/config/runtimeEnv";

export function isMapboxConfigured(): boolean {
  return Boolean(getMapboxToken());
}

export function disableMapboxTelemetry(): void {
  const mapbox = mapboxgl as any;
  if (mapbox && typeof mapbox.setTelemetryEnabled === "function") {
    mapbox.setTelemetryEnabled(false);
  }
}
