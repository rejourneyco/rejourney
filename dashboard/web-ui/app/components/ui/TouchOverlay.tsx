import React, { useState, useMemo } from 'react';

export interface TouchPoint {
  x: number;
  y: number;
  timestamp: number;
  force?: number;
}

export interface TouchEvent {
  id: string;
  timestamp: number;
  gestureType: string;
  touches: TouchPoint[];
  targetLabel?: string;
  duration?: number;
  velocity?: { x: number; y: number };
  maxForce?: number;
  touchCount?: number;
}

interface TouchOverlayProps {
  events: TouchEvent[];
  deviceWidth: number;
  deviceHeight: number;
  currentTime: number; // in milliseconds (absolute)
  visibleWindowMs?: number;
}

interface RenderedTouch {
  id: string;
  x: number;
  y: number;
  gestureType: string;
  opacity: number;
  age: number;
  targetLabel?: string;
  force?: number;
  duration?: number;
  velocity?: { x: number; y: number };
  touchCount?: number;
  timestamp: number;
}

export const TouchOverlay: React.FC<TouchOverlayProps> = ({
  events,
  deviceWidth,
  deviceHeight,
  currentTime,
  visibleWindowMs = 800,
}) => {
  // We'll keep track of "active" touches to draw trails, etc.
  // For standard usage, we just render what we passed.

  const renderedTouches = useMemo(() => {
    const active: RenderedTouch[] = [];

    events.forEach((event) => {
      const eventAge = currentTime - event.timestamp;
      // Filter out events that are too old or in the future
      if (eventAge < 0 || eventAge > visibleWindowMs) return;

      const gestureType = (event.gestureType || 'tap').toLowerCase();

      // Customize fade times based on gesture
      let fadeTime = visibleWindowMs;
      if (gestureType.includes('tap')) fadeTime = 600;

      if (eventAge > fadeTime) return;

      const opacity = Math.max(0, 1 - (eventAge / fadeTime));

      // For each touch point in this event
      event.touches.forEach((touch, idx) => {
        active.push({
          id: `${event.id}-${idx}`,
          x: touch.x,
          y: touch.y,
          gestureType,
          opacity,
          age: eventAge,
          targetLabel: event.targetLabel,
          force: touch.force,
          touchCount: event.touchCount || event.touches.length,
          timestamp: event.timestamp,
        }); // end push
      });
    });

    // Sort by timestamp so newer touches interact/draw on top
    return active.sort((a, b) => a.timestamp - b.timestamp);
  }, [events, currentTime, visibleWindowMs]);

  // If no touches, render nothing
  if (renderedTouches.length === 0) return null;

  // Group touches by "trace" (heuristically matching nearby points could be complex, 
  // but here we just render them. For a true "trail", we might need persistent IDs from the backend.
  // Assuming 'id' in events might technically change per snapshot, 
  // but let's assume standard "event" based rendering is fine for now.)

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden rounded-[2rem]">
      <style>{`
        @keyframes ripple-effect {
          0% { transform: scale(0.5); opacity: 1; border-width: 4px; }
          100% { transform: scale(2.5); opacity: 0; border-width: 0px; }
        }
      `}</style>

      {renderedTouches.map((touch, index) => {
        // Aesthetic Configuration
        let baseColor = 'bg-amber-400';
        let ringColor = 'ring-amber-500/30';
        let size = 20;
        let showRipple = false;

        const gestureType = touch.gestureType.toLowerCase();
        const isRage = gestureType.includes('rage');
        const isTap = gestureType.includes('tap') || gestureType.includes('long_press');
        const isScroll = gestureType.includes('scroll');
        const isPan = gestureType.includes('pan') || gestureType.includes('drag');
        const isPinch = gestureType.includes('pinch');
        const isZoom = gestureType.includes('zoom');
        const isRotation = gestureType.includes('rotat');
        const isSwipe = gestureType.includes('swipe');
        const isTwoFinger = gestureType.includes('two_finger') || (touch.touchCount && touch.touchCount >= 2);

        if (isRage) {
          baseColor = 'bg-red-500';
          ringColor = 'ring-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.6)]';
          size = 32;
        } else if (isPinch || isZoom) {
          // Pinch/zoom gestures - teal color with distinctive styling
          baseColor = 'bg-teal-400';
          ringColor = 'ring-teal-400/40 shadow-[0_0_18px_rgba(45,212,191,0.5)]';
          size = 28;
          if (touch.age < 300) showRipple = true;
        } else if (isRotation) {
          // Rotation gestures - pink/magenta color
          baseColor = 'bg-pink-400';
          ringColor = 'ring-pink-400/40 shadow-[0_0_18px_rgba(236,72,153,0.5)]';
          size = 28;
          if (touch.age < 300) showRipple = true;
        } else if (isSwipe) {
          // Swipe gestures - cyan color with directional indicator
          baseColor = 'bg-cyan-400';
          ringColor = 'ring-cyan-400/40 shadow-[0_0_18px_rgba(34,211,238,0.5)]';
          size = 26;
          if (touch.age < 200) showRipple = true;
        } else if (isTap) {
          baseColor = 'bg-amber-400'; // Brand color
          ringColor = 'ring-amber-400/40 shadow-[0_0_15px_rgba(251,191,36,0.5)]';
          size = 24;
          // Only ripple if it's the start of the tap (young age)
          if (touch.age < 200) showRipple = true;
        } else if (isScroll || isPan) {
          baseColor = 'bg-slate-200';
          ringColor = 'ring-white/20';
          size = 12; // Smaller for trails
        } else if (isTwoFinger) {
          // Generic two-finger gesture - purple
          baseColor = 'bg-violet-400';
          ringColor = 'ring-violet-400/40 shadow-[0_0_15px_rgba(167,139,250,0.5)]';
          size = 26;
        }

        // Apply force multiplier
        if (touch.force) {
          size *= (0.8 + touch.force * 0.4);
        }

        // ========================================================================
        // Cross-Platform Coordinate Calculation (RN iOS & RN Android)
        // ========================================================================
        // Both platforms send coordinates in density-independent units:
        //   - iOS: Native UIKit points
        //   - Android: Raw pixels normalized to dp (divided by density)
        // deviceWidth/Height also uses matching units, so this percentage
        // calculation works correctly on both platforms.
        // ========================================================================
        const xPercent = (touch.x / deviceWidth) * 100;
        const yPercent = (touch.y / deviceHeight) * 100;

        return (
          <React.Fragment key={touch.id}>
            {/* Ripple Animation for Taps */}
            {showRipple && (
              <div
                className="absolute rounded-full border-amber-400 box-content"
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  marginTop: `-${size / 2}px`,
                  marginLeft: `-${size / 2}px`,
                  animation: 'ripple-effect 0.6s ease-out forwards',
                }}
              />
            )}

            {/* Main Touch Point */}
            <div
              className={`absolute rounded-full backdrop-blur-sm transition-all duration-75 
                ${baseColor} ${isTap ? 'ring-4' : 'ring-2'} ${ringColor}`}
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                width: `${size}px`,
                height: `${size}px`,
                transform: 'translate(-50%, -50%)',
                opacity: touch.opacity, // Fade out
              }}
            >
              {/* Center dot for precision */}
              <div className="absolute inset-0 m-auto w-1.5 h-1.5 bg-white rounded-full opacity-80" />
            </div>

            {/* Optional: Label for debugging or detailed view (could be toggleable, currently hidden for cleanliness or minimal) */}
            {/* 
            {touch.targetLabel && touch.age < 100 && (
               <div className="absolute text-[10px] text-white bg-black/50 px-1 rounded translate-y-4 translate-x-4" 
                    style={{ left: `${xPercent}%`, top: `${yPercent}%` }}>
                 {touch.targetLabel}
               </div>
            )} 
            */}
          </React.Fragment>
        );
      })}
    </div>
  );
};
