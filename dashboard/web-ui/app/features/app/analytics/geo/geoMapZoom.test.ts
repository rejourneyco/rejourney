import { describe, expect, it, vi } from 'vitest';
import {
    configureGeoMapZoomSensitivity,
    getGeoMapWheelZoomDelta,
} from './geoMapZoom';

describe('geographic map zoom sensitivity', () => {
    it('makes a standard trackpad pinch comparable to one navigation-control step', () => {
        expect(getGeoMapWheelZoomDelta(100)).toBe(-1);
        expect(getGeoMapWheelZoomDelta(-100)).toBe(1);
    });

    it('keeps fine movement proportional and caps unusually large events', () => {
        expect(getGeoMapWheelZoomDelta(10)).toBe(-0.1);
        expect(getGeoMapWheelZoomDelta(2.5, 1)).toBe(-1);
        expect(getGeoMapWheelZoomDelta(1_000)).toBe(-1.15);
        expect(getGeoMapWheelZoomDelta(Number.NaN)).toBe(0);
    });

    it('increases Mapbox trackpad and mouse-wheel zoom rates', () => {
        const setZoomRate = vi.fn();
        const setWheelZoomRate = vi.fn();

        configureGeoMapZoomSensitivity({
            scrollZoom: { setZoomRate, setWheelZoomRate },
        });

        expect(setZoomRate).toHaveBeenCalledWith(1 / 35);
        expect(setWheelZoomRate).toHaveBeenCalledWith(1 / 100);
    });
});
