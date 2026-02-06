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

/** A connected trail of pan/scroll points for SVG rendering */
interface GestureTrail {
  points: { x: number; y: number; opacity: number; age: number }[];
  newestOpacity: number;
}

export const TouchOverlay: React.FC<TouchOverlayProps> = ({
  events,
  deviceWidth,
  deviceHeight,
  currentTime,
  visibleWindowMs = 600,
}) => {
  const trailWindowMs = 600; // Longer window for trails so the line is visible

  const { renderedTouches, gestureTrails } = useMemo(() => {
    const active: RenderedTouch[] = [];
    // Collect movement points sorted by time for trail rendering
    const movementPoints: { x: number; y: number; timestamp: number; opacity: number; age: number; targetLabel?: string }[] = [];

    events.forEach((event) => {
      const eventAge = currentTime - event.timestamp;
      if (eventAge < 0) return;

      const gestureType = (event.gestureType || 'tap').toLowerCase();
      const isDeadTap = (event as any).frustrationKind === 'dead_tap' || gestureType === 'dead_tap';
      const isRageTap = (event as any).frustrationKind === 'rage_tap' || gestureType === 'rage_tap';
      const isScroll = gestureType.includes('scroll');
      const isPan = gestureType.includes('pan') || gestureType.includes('drag');

      // Use longer fade for movement trails, normal for discrete events
      const isMovement = isScroll || isPan;
      const fadeTime = isMovement ? trailWindowMs : visibleWindowMs;

      if (eventAge > fadeTime) return;
      const opacity = Math.max(0, 1 - (eventAge / fadeTime));

      if (isMovement) {
        // Collect movement points for trail rendering instead of individual dots
        event.touches.forEach((touch) => {
          movementPoints.push({
            x: touch.x,
            y: touch.y,
            timestamp: event.timestamp,
            opacity,
            age: eventAge,
            targetLabel: event.targetLabel,
          });
        });
      } else {
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
            isScroll: false,
            isPan: false,
          });
        });
      }
    });

    // Build connected trails from movement points
    // Group points that are close in time (<250ms gap) into continuous trails
    movementPoints.sort((a, b) => a.timestamp - b.timestamp);
    const trails: GestureTrail[] = [];
    let currentTrail: GestureTrail | null = null;

    for (const pt of movementPoints) {
      if (!currentTrail || (pt.timestamp - (currentTrail.points[currentTrail.points.length - 1] as any).timestamp) > 250) {
        // Start a new trail if gap too large
        currentTrail = { points: [], newestOpacity: 0 };
        trails.push(currentTrail);
      }
      currentTrail.points.push({ ...pt, timestamp: pt.timestamp } as any);
      currentTrail.newestOpacity = Math.max(currentTrail.newestOpacity, pt.opacity);
    }

    return {
      renderedTouches: active.sort((a, b) => a.age - b.age),
      gestureTrails: trails.filter(t => t.points.length >= 1),
    };
  }, [events, currentTime, visibleWindowMs, trailWindowMs]);

  if (renderedTouches.length === 0 && gestureTrails.length === 0) return null;

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

      {/* Gesture trails rendered as SVG paths */}
      {gestureTrails.length > 0 && (
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${deviceWidth} ${deviceHeight}`} preserveAspectRatio="none">
          <defs>
            <filter id="trail-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {gestureTrails.map((trail, trailIdx) => {
            if (trail.points.length === 1) {
              // Single point — render as a small circle
              const pt = trail.points[0];
              return (
                <circle
                  key={`trail-${trailIdx}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={5}
                  fill="rgba(99, 102, 241, 0.7)"
                  opacity={pt.opacity * 0.8}
                  filter="url(#trail-glow)"
                />
              );
            }

            // Build a smooth path through the points
            const pathParts: string[] = [];
            pathParts.push(`M ${trail.points[0].x} ${trail.points[0].y}`);

            for (let i = 1; i < trail.points.length; i++) {
              const prev = trail.points[i - 1];
              const curr = trail.points[i];
              // Use quadratic bezier for smooth curves through midpoints
              if (i < trail.points.length - 1) {
                const next = trail.points[i + 1];
                const cpX = curr.x;
                const cpY = curr.y;
                const endX = (curr.x + next.x) / 2;
                const endY = (curr.y + next.y) / 2;
                pathParts.push(`Q ${cpX} ${cpY} ${endX} ${endY}`);
              } else {
                pathParts.push(`L ${curr.x} ${curr.y}`);
              }
            }

            const pathD = pathParts.join(' ');
            const newestPt = trail.points[trail.points.length - 1];
            const oldestPt = trail.points[0];

            return (
              <React.Fragment key={`trail-${trailIdx}`}>
                {/* Trail stroke — fading from old to new */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="rgba(99, 102, 241, 0.6)"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={trail.newestOpacity * 0.7}
                  filter="url(#trail-glow)"
                />
                {/* Brighter thin inner line */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="rgba(165, 180, 252, 0.9)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={trail.newestOpacity * 0.9}
                />
                {/* Head dot at newest position */}
                <circle
                  cx={newestPt.x}
                  cy={newestPt.y}
                  r={6}
                  fill="rgba(99, 102, 241, 0.9)"
                  opacity={newestPt.opacity}
                  filter="url(#trail-glow)"
                />
                {/* Faded tail dot at oldest position */}
                <circle
                  cx={oldestPt.x}
                  cy={oldestPt.y}
                  r={3}
                  fill="rgba(99, 102, 241, 0.5)"
                  opacity={oldestPt.opacity * 0.4}
                />
              </React.Fragment>
            );
          })}
        </svg>
      )}

      {/* Discrete touch events (taps, rage taps, dead taps) */}
      {renderedTouches.map((touch) => {
        const xPercent = (touch.x / deviceWidth) * 100;
        const yPercent = (touch.y / deviceHeight) * 100;

        if (touch.isRageTap) {
          return (
            <React.Fragment key={touch.id}>
              {/* Shockwave Layer */}
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
              className="absolute rounded-full border-2 border-stone-400/50 bg-stone-400/15 backdrop-blur-[1px]"
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
