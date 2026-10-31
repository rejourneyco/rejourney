import React from 'react';
// @ts-ignore: react-map-gl typing can fail under current tsconfig
import MapGL, { Marker, NavigationControl, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { disableMapboxTelemetry } from '~/shared/integrations/mapbox';

/**
 * The Mapbox map components, split from the geo route so the page renders and
 * starts its data requests without waiting for the large mapbox-gl chunk.
 * Rendered through React.lazy; children receive the components to draw with.
 */
export interface GeoMapKitComponents {
    MapGL: typeof MapGL;
    Marker: typeof Marker;
    NavigationControl: typeof NavigationControl;
    Popup: typeof Popup;
}

const GEO_MAP_KIT: GeoMapKitComponents = { MapGL, Marker, NavigationControl, Popup };

export default function GeoMapKit({ children }: { children: (kit: GeoMapKitComponents) => React.ReactNode }) {
    React.useEffect(() => {
        disableMapboxTelemetry();
    }, []);
    return <>{children(GEO_MAP_KIT)}</>;
}
