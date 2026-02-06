import React, { useMemo } from 'react';

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
  eventId: string;
  x: number;
  y: number;
  gestureType: string;
  opacity: number;
  age: number;
  isDeadTap: boolean;
  isRageTap: boolean;
  isScroll: boolean;
  isPan: boolean;
}

export const TouchOverlay: React.FC<TouchOverlayProps> = ({
  events,
  deviceWidth,
  deviceHeight,
  currentTime,
  visibleWindowMs = 600,
}) => {
  const renderedTouches = useMemo(() => {
    const active: RenderedTouch[] = [];

    // Grouping events by ID to handle trails if needed, 
    // but for now we just render all samples in the visible window
    events.forEach((event) => {
      const eventAge = currentTime - event.timestamp;
      if (eventAge < 0 || eventAge > visibleWindowMs) return;

      const gestureType = (event.gestureType || 'tap').toLowerCase();
      const isDeadTap = (event as any).frustrationKind === 'dead_tap' || gestureType === 'dead_tap';
      const isRageTap = (event as any).frustrationKind === 'rage_tap' || gestureType === 'rage_tap';
      const isScroll = gestureType.includes('scroll');
      const isPan = gestureType.includes('pan') || gestureType.includes('drag');

      // Adjust fade time based on gesture
      let fadeTime = visibleWindowMs;
      if (isScroll || isPan) fadeTime = 400; // Shorter trails for movement

      if (eventAge > fadeTime) return;
      const opacity = Math.max(0, 1 - (eventAge / fadeTime));

      event.touches.forEach((touch, idx) => {
        active.push({
          id: `${event.id}-${idx}`,
          eventId: event.id,
          x: touch.x,
          y: touch.y,
          gestureType,
          opacity,
          age: eventAge,
          isDeadTap,
          isRageTap,
          isScroll,
          isPan,
        });
      });
    });

    return active.sort((a, b) => a.age - b.age); // Render newest on top
  }, [events, currentTime, visibleWindowMs]);

  if (renderedTouches.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden rounded-[2.5rem]">
      <style>{`
        @keyframes shockwave {
          0% { transform: translate(-50%, -50%) scale(0.8); opacity: 0.8; border-width: 4px; }
          100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; border-width: 1px; }
        }
        @keyframes pulse-glow {
          0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 20px rgba(99, 102, 241, 0.6); }
          50% { transform: translate(-50%, -50%) scale(1.1); box-shadow: 0 0 35px rgba(99, 102, 241, 0.9); }
        }
      `}</style>

      {renderedTouches.map((touch) => {
        const xPercent = (touch.x / deviceWidth) * 100;
        const yPercent = (touch.y / deviceHeight) * 100;

        // Base Styling based on "Luminescent Fluid" concept
        if (touch.isRageTap) {
          return (
            <React.Fragment key={touch.id}>
              {/* Shockwave Layer 1 */}
              <div
                className="absolute rounded-full border-rose-500/50"
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  width: '60px',
                  height: '60px',
                  animation: 'shockwave 0.6s ease-out infinite',
                }}
              />
              {/* Inner Core */}
              <div
                className="absolute rounded-full bg-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.8)]"
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  width: '24px',
                  height: '24px',
                  transform: 'translate(-50%, -50%)',
                  opacity: touch.opacity,
                }}
              />
            </React.Fragment>
          );
        }

        if (touch.isDeadTap) {
          return (
            <div
              key={touch.id}
              className="absolute rounded-full border-2 border-indigo-400/40 bg-indigo-400/10 backdrop-blur-[1px]"
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                width: '32px',
                height: '32px',
                transform: 'translate(-50%, -50%)',
                opacity: touch.opacity,
              }}
            />
          );
        }

        if (touch.isScroll || touch.isPan) {
          // Movement Trail Sample
          return (
            <div
              key={touch.id}
              className="absolute rounded-full bg-indigo-500/80 blur-[2px]"
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                width: '12px',
                height: '12px',
                transform: 'translate(-50%, -50%)',
                opacity: touch.opacity * 0.6,
                boxShadow: '0 0 10px rgba(99, 102, 241, 0.4)',
              }}
            />
          );
        }

        // Standard Tap - Glowing Orb
        return (
          <div
            key={touch.id}
            className="absolute rounded-full bg-indigo-500"
            style={{
              left: `${xPercent}%`,
              top: `${yPercent}%`,
              width: '22px',
              height: '22px',
              transform: 'translate(-50%, -50%)',
              opacity: touch.opacity,
              animation: touch.age < 100 ? 'pulse-glow 0.4s ease-out' : 'none',
              boxShadow: `
                0 0 15px rgba(99, 102, 241, 0.7),
                inset 0 0 8px rgba(255, 255, 255, 0.5)
              `,
            }}
          />
        );
      })}
    </div>
  );
};
