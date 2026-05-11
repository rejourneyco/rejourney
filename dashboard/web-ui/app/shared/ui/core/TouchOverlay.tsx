import React, { useId, useMemo } from 'react';

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
  frustrationKind?: string;
}

export interface NetworkOverlayEvent {
  id: string;
  timestamp: number;
  method?: string;
  statusCode?: number;
  success?: boolean;
  duration?: number;
  urlPath?: string;
}

interface TouchOverlayProps {
  events: TouchEvent[];
  networkEvents?: NetworkOverlayEvent[];
  deviceWidth: number;
  deviceHeight: number;
  currentTime: number; // in milliseconds (absolute)
  visibleWindowMs?: number;
}

type GestureKind =
  | 'tap'
  | 'longPress'
  | 'deadTap'
  | 'rageTap'
  | 'scroll'
  | 'swipe'
  | 'pan'
  | 'pinch'
  | 'rotate'
  | 'unknown';

interface GestureStyle {
  accent: string;
  soft: string;
  faint: string;
  light: string;
  shadow: string;
}

interface TimedPoint {
  x: number;
  y: number;
  timestamp: number;
  force?: number;
}

interface RenderedPress {
  id: string;
  x: number;
  y: number;
  kind: GestureKind;
  opacity: number;
  progress: number;
  age: number;
  force: number;
  rotate: number;
}

interface MovementSeed extends TimedPoint {
  eventId: string;
  kind: GestureKind;
  targetKey: string;
}

interface MovementGroup {
  id: string;
  kind: GestureKind;
  targetKey: string;
  points: MovementSeed[];
}

interface MotionTrail {
  id: string;
  kind: GestureKind;
  points: TimedPoint[];
  head: TimedPoint;
  tail: TimedPoint;
  opacity: number;
  progress: number;
  distance: number;
  dx: number;
  dy: number;
  strokeWidth: number;
}

interface RenderedNetwork {
  id: string;
  opacity: number;
  progress: number;
  color: string;
  trackColor: string;
  lane: number;
  isSettling: boolean;
}

const GESTURE_STYLES: Record<GestureKind, GestureStyle> = {
  tap: {
    accent: '#0891b2',
    soft: 'rgba(8, 145, 178, 0.38)',
    faint: 'rgba(8, 145, 178, 0.2)',
    light: '#67e8f9',
    shadow: 'rgba(8, 47, 73, 0.34)',
  },
  longPress: {
    accent: '#2563eb',
    soft: 'rgba(37, 99, 235, 0.34)',
    faint: 'rgba(37, 99, 235, 0.18)',
    light: '#93c5fd',
    shadow: 'rgba(30, 64, 175, 0.32)',
  },
  deadTap: {
    accent: '#64748b',
    soft: 'rgba(100, 116, 139, 0.3)',
    faint: 'rgba(100, 116, 139, 0.16)',
    light: '#cbd5e1',
    shadow: 'rgba(15, 23, 42, 0.24)',
  },
  rageTap: {
    accent: '#e11d48',
    soft: 'rgba(225, 29, 72, 0.36)',
    faint: 'rgba(225, 29, 72, 0.18)',
    light: '#fb7185',
    shadow: 'rgba(159, 18, 57, 0.36)',
  },
  scroll: {
    accent: '#d97706',
    soft: 'rgba(217, 119, 6, 0.36)',
    faint: 'rgba(217, 119, 6, 0.18)',
    light: '#fbbf24',
    shadow: 'rgba(146, 64, 14, 0.34)',
  },
  swipe: {
    accent: '#059669',
    soft: 'rgba(5, 150, 105, 0.34)',
    faint: 'rgba(5, 150, 105, 0.17)',
    light: '#34d399',
    shadow: 'rgba(4, 120, 87, 0.32)',
  },
  pan: {
    accent: '#7c3aed',
    soft: 'rgba(124, 58, 237, 0.34)',
    faint: 'rgba(124, 58, 237, 0.17)',
    light: '#a78bfa',
    shadow: 'rgba(91, 33, 182, 0.34)',
  },
  pinch: {
    accent: '#0d9488',
    soft: 'rgba(13, 148, 136, 0.34)',
    faint: 'rgba(13, 148, 136, 0.17)',
    light: '#5eead4',
    shadow: 'rgba(15, 118, 110, 0.3)',
  },
  rotate: {
    accent: '#db2777',
    soft: 'rgba(219, 39, 119, 0.34)',
    faint: 'rgba(219, 39, 119, 0.17)',
    light: '#f472b6',
    shadow: 'rgba(157, 23, 77, 0.32)',
  },
  unknown: {
    accent: '#475569',
    soft: 'rgba(71, 85, 105, 0.3)',
    faint: 'rgba(71, 85, 105, 0.16)',
    light: '#94a3b8',
    shadow: 'rgba(15, 23, 42, 0.24)',
  },
};

const MOTION_KINDS = new Set<GestureKind>(['scroll', 'swipe', 'pan', 'pinch', 'rotate']);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

const normalizeGestureKind = (gestureType: string, frustrationKind?: string): GestureKind => {
  const normalized = `${gestureType || ''} ${frustrationKind || ''}`.toLowerCase();
  if (normalized.includes('dead')) return 'deadTap';
  if (normalized.includes('rage')) return 'rageTap';
  if (normalized.includes('pinch') || normalized.includes('zoom')) return 'pinch';
  if (normalized.includes('rotat')) return 'rotate';
  if (normalized.includes('scroll')) return 'scroll';
  if (normalized.includes('swipe') || normalized.includes('fling')) return 'swipe';
  if (normalized.includes('pan') || normalized.includes('drag')) return 'pan';
  if (normalized.includes('long')) return 'longPress';
  if (normalized.includes('tap') || normalized.includes('click') || normalized.includes('press')) return 'tap';
  return 'unknown';
};

const dominantMovementKind = (points: MovementSeed[]): GestureKind => {
  if (points.some((point) => point.kind === 'pinch')) return 'pinch';
  if (points.some((point) => point.kind === 'rotate')) return 'rotate';
  if (points.some((point) => point.kind === 'swipe')) return 'swipe';
  if (points.some((point) => point.kind === 'scroll')) return 'scroll';
  if (points.some((point) => point.kind === 'pan')) return 'pan';
  return points[0]?.kind || 'unknown';
};

const normalizedPointsForEvent = (
  event: TouchEvent,
  deviceWidth: number,
  deviceHeight: number
): TimedPoint[] => {
  return event.touches
    .map((touch) => {
      const x = isFiniteNumber(touch.x) ? touch.x : 0;
      const y = isFiniteNumber(touch.y) ? touch.y : 0;
      return {
        x: clamp(x, 0, deviceWidth),
        y: clamp(y, 0, deviceHeight),
        timestamp: isFiniteNumber(touch.timestamp) ? touch.timestamp : event.timestamp,
        force: touch.force,
      };
    })
    .filter((touch) => touch.x >= 0 && touch.y >= 0 && touch.x <= deviceWidth && touch.y <= deviceHeight)
    .sort((a, b) => a.timestamp - b.timestamp);
};

const buildSmoothPath = (points: TimedPoint[]): string => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length; index++) {
    const current = points[index];
    if (index < points.length - 1) {
      const next = points[index + 1];
      parts.push(`Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`);
    } else {
      parts.push(`L ${current.x} ${current.y}`);
    }
  }
  return parts.join(' ');
};

const interpolatePoint = (points: TimedPoint[], timestamp: number): TimedPoint | null => {
  if (points.length === 0) return null;
  if (timestamp <= points[0].timestamp) return points[0];
  const last = points[points.length - 1];
  if (timestamp >= last.timestamp) return last;

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const next = points[index];
    if (timestamp <= next.timestamp) {
      const span = Math.max(1, next.timestamp - previous.timestamp);
      const progress = clamp((timestamp - previous.timestamp) / span, 0, 1);
      return {
        x: previous.x + (next.x - previous.x) * progress,
        y: previous.y + (next.y - previous.y) * progress,
        timestamp,
        force: next.force ?? previous.force,
      };
    }
  }

  return last;
};

const movementTrailWindow = (kind: GestureKind, visibleWindowMs: number): number => {
  if (kind === 'swipe') return Math.max(520, visibleWindowMs * 0.78);
  if (kind === 'scroll') return Math.max(720, visibleWindowMs * 0.95);
  if (kind === 'pan') return Math.max(900, visibleWindowMs * 1.1);
  return Math.max(760, visibleWindowMs);
};

const arrowPoints = (trail: MotionTrail): string => {
  const length = Math.max(1, Math.hypot(trail.dx, trail.dy));
  const ux = trail.dx / length;
  const uy = trail.dy / length;
  const px = -uy;
  const py = ux;
  const size = trail.kind === 'swipe' ? 18 : 13;
  const wing = size * 0.54;
  const x1 = trail.head.x;
  const y1 = trail.head.y;
  const x2 = x1 - ux * size + px * wing;
  const y2 = y1 - uy * size + py * wing;
  const x3 = x1 - ux * size - px * wing;
  const y3 = y1 - uy * size - py * wing;
  return `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
};

export const TouchOverlay: React.FC<TouchOverlayProps> = ({
  events,
  networkEvents = [],
  deviceWidth,
  deviceHeight,
  currentTime,
  visibleWindowMs = 850,
}) => {
  const rawOverlayId = useId();
  const overlayId = useMemo(() => rawOverlayId.replace(/:/g, ''), [rawOverlayId]);
  const trailFilterId = `${overlayId}-trail-glow`;

  const { renderedPresses, motionTrails, renderedNetwork } = useMemo(() => {
    const presses: RenderedPress[] = [];
    const movementSeeds: MovementSeed[] = [];

    events.forEach((event) => {
      const points = normalizedPointsForEvent(event, deviceWidth, deviceHeight);
      if (points.length === 0) return;

      const kind = normalizeGestureKind(event.gestureType, event.frustrationKind);
      const targetKey = (event.targetLabel || 'surface').toLowerCase();

      if (MOTION_KINDS.has(kind)) {
        points.forEach((point) => {
          movementSeeds.push({
            ...point,
            eventId: event.id,
            kind,
            targetKey,
          });
        });
        return;
      }

      const windowMs = kind === 'longPress'
        ? Math.max(1200, event.duration || 0)
        : kind === 'rageTap'
          ? 920
          : kind === 'deadTap'
            ? 900
            : visibleWindowMs;

      points.forEach((point, index) => {
        const age = currentTime - point.timestamp;
        if (age < -40 || age > windowMs) return;

        const seed = hashString(`${event.id}-${index}`);
        const progress = clamp(age / windowMs, 0, 1);
        presses.push({
          id: `${event.id}-${index}`,
          x: point.x,
          y: point.y,
          kind,
          age,
          progress,
          force: clamp((point.force || event.maxForce || 0.35) + 0.35, 0.35, 1),
          opacity: kind === 'longPress'
            ? clamp(1 - progress * 0.45, 0, 1)
            : clamp(1 - progress * 0.72, 0, 1),
          rotate: (seed % 18) - 9,
        });
      });
    });

    movementSeeds.sort((a, b) => a.timestamp - b.timestamp);

    const movementGroups: MovementGroup[] = [];
    let currentGroup: MovementGroup | null = null;

    movementSeeds.forEach((point) => {
      const previous = currentGroup?.points[currentGroup.points.length - 1];
      const gap = previous ? point.timestamp - previous.timestamp : Infinity;
      const sameTarget = !previous || point.targetKey === previous.targetKey;
      const canContinue = currentGroup && gap <= 340 && sameTarget;

      if (!canContinue) {
        currentGroup = {
          id: `motion-${point.eventId}-${point.timestamp}`,
          kind: point.kind,
          targetKey: point.targetKey,
          points: [],
        };
        movementGroups.push(currentGroup);
      }

      const group = currentGroup;
      if (!group) return;
      group.points.push(point);
      group.kind = dominantMovementKind(group.points);
    });

    const trails: MotionTrail[] = [];
    movementGroups.forEach((group, groupIndex) => {
      if (group.points.length === 0) return;

      const firstPoint = group.points[0];
      const lastPoint = group.points[group.points.length - 1];
      const endTime = lastPoint.timestamp;
      const afterglowMs = group.kind === 'scroll' ? 720 : group.kind === 'swipe' ? 520 : 820;

      if (currentTime < firstPoint.timestamp - 50 || currentTime > endTime + afterglowMs) return;

      const activeTime = Math.min(currentTime, endTime);
      const head = interpolatePoint(group.points, activeTime) || lastPoint;
      const trailWindow = movementTrailWindow(group.kind, visibleWindowMs);
      const windowStart = activeTime - trailWindow;
      const trailPoints: TimedPoint[] = group.points.filter((point) => point.timestamp >= windowStart && point.timestamp <= activeTime);
      const previousPoint = group.points.find((point, index) => {
        const next = group.points[index + 1];
        return point.timestamp < windowStart && (!next || next.timestamp >= windowStart);
      });

      if (previousPoint) {
        trailPoints.unshift(previousPoint);
      }

      const lastTrailPoint = trailPoints[trailPoints.length - 1];
      if (!lastTrailPoint || Math.abs(lastTrailPoint.x - head.x) > 0.5 || Math.abs(lastTrailPoint.y - head.y) > 0.5) {
        trailPoints.push(head);
      }

      if (trailPoints.length === 0) {
        trailPoints.push(head);
      }

      const tail = trailPoints[0];
      const dx = head.x - tail.x;
      const dy = head.y - tail.y;
      const distance = Math.hypot(dx, dy);
      const fadeOut = currentTime <= endTime ? 1 : clamp(1 - (currentTime - endTime) / afterglowMs, 0, 1);
      const fadeIn = clamp((currentTime - firstPoint.timestamp) / 120, 0, 1);

      trails.push({
        id: `${group.id}-${groupIndex}`,
        kind: group.kind,
        points: trailPoints,
        head,
        tail,
        opacity: fadeOut * fadeIn,
        progress: clamp((activeTime - firstPoint.timestamp) / Math.max(1, endTime - firstPoint.timestamp), 0, 1),
        distance,
        dx,
        dy,
        strokeWidth: group.kind === 'scroll' ? 9 : group.kind === 'swipe' ? 8 : 7,
      });
    });

    const network = networkEvents
      .map((event, index) => {
        const duration = clamp(event.duration || 620, 160, 2400);
        const age = currentTime - event.timestamp;
        const settleMs = event.success === false ? 900 : 620;
        if (age < -40 || age > duration + settleMs) return null;

        const isSettling = age > duration;
        const progress = isSettling ? 1 : clamp(age / duration, 0, 1);
        const settleOpacity = isSettling ? clamp(1 - (age - duration) / settleMs, 0, 1) : 1;
        const color = isSettling
          ? event.success === false
            ? '#ef4444'
            : '#10b981'
          : '#38bdf8';

        return {
          id: event.id || `network-${event.timestamp}-${index}`,
          opacity: settleOpacity,
          progress,
          color,
          trackColor: event.success === false ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.22)',
          lane: index,
          isSettling,
        } satisfies RenderedNetwork;
      })
      .filter((event): event is RenderedNetwork => event !== null)
      .slice(-4)
      .map((event, index) => ({ ...event, lane: index }));

    return {
      renderedPresses: presses.sort((a, b) => a.age - b.age),
      motionTrails: trails,
      renderedNetwork: network,
    };
  }, [currentTime, deviceHeight, deviceWidth, events, networkEvents, visibleWindowMs]);

  if (renderedPresses.length === 0 && motionTrails.length === 0 && renderedNetwork.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden rounded-[2.5rem]">
      <style>{`
        @keyframes replay-fingertip-breathe {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(0.92); }
        }
        @keyframes replay-network-bead {
          0% { transform: translateX(-2px) scale(0.8); opacity: 0.35; }
          45% { opacity: 1; }
          100% { transform: translateX(8px) scale(1); opacity: 0.35; }
        }
      `}</style>

      {motionTrails.length > 0 && (
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${deviceWidth} ${deviceHeight}`} preserveAspectRatio="none">
          <defs>
            <filter id={trailFilterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {motionTrails.map((trail) => {
            const style = GESTURE_STYLES[trail.kind];
            const pathD = buildSmoothPath(trail.points);
            const needsArrow = (trail.kind === 'swipe' || trail.kind === 'pan') && trail.distance > 18;
            const isScroll = trail.kind === 'scroll';
            const isPan = trail.kind === 'pan';

            return (
              <React.Fragment key={trail.id}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={style.shadow}
                  strokeWidth={trail.strokeWidth + 8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={trail.opacity * 0.46}
                  filter={`url(#${trailFilterId})`}
                />
                {isScroll && (
                  <>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={style.faint}
                      strokeWidth={trail.strokeWidth + 18}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="2 18"
                      opacity={trail.opacity * 0.58}
                    />
                    <path
                      d={pathD}
                      fill="none"
                      stroke={style.soft}
                      strokeWidth={trail.strokeWidth + 7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="16 12"
                      opacity={trail.opacity * 0.54}
                    />
                  </>
                )}
                <path
                  d={pathD}
                  fill="none"
                  stroke={style.accent}
                  strokeWidth={trail.strokeWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={trail.opacity}
                  filter={`url(#${trailFilterId})`}
                />
                <path
                  d={pathD}
                  fill="none"
                  stroke={style.light}
                  strokeWidth={Math.max(1.5, trail.strokeWidth * 0.38)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={trail.opacity * 0.58}
                />
                {needsArrow && (
                  <polygon
                    points={arrowPoints(trail)}
                    fill={style.light}
                    opacity={trail.opacity * (trail.kind === 'swipe' ? 0.96 : 0.76)}
                    filter={`url(#${trailFilterId})`}
                  />
                )}
                <circle
                  cx={trail.head.x}
                  cy={trail.head.y}
                  r={isScroll ? 9.4 : isPan ? 9.8 : 8.8}
                  fill={style.accent}
                  opacity={trail.opacity}
                  filter={`url(#${trailFilterId})`}
                />
                <circle
                  cx={trail.head.x}
                  cy={trail.head.y}
                  r={isPan ? 3.4 : 2.7}
                  fill="rgba(255,255,255,0.9)"
                  opacity={trail.opacity * 0.92}
                />
              </React.Fragment>
            );
          })}
        </svg>
      )}

      {renderedPresses.map((press) => {
        const style = GESTURE_STYLES[press.kind];
        const xPercent = (press.x / deviceWidth) * 100;
        const yPercent = (press.y / deviceHeight) * 100;
        const rippleScale = 0.65 + press.progress * (press.kind === 'rageTap' ? 2.4 : 1.55);
        const coreScale = press.kind === 'longPress'
          ? 0.92 + Math.sin(press.progress * Math.PI) * 0.08
          : 1 - press.progress * 0.18;
        const coreSize = press.kind === 'rageTap' ? 30 : press.kind === 'deadTap' ? 28 : 24 + press.force * 5;

        if (press.kind === 'deadTap') {
          return (
            <div key={press.id}>
              <div
                className="absolute rounded-full border-2 backdrop-blur-[1px]"
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  width: 42,
                  height: 42,
                  borderColor: style.accent,
                  backgroundColor: style.faint,
                  opacity: press.opacity * 0.9,
                  transform: `translate(-50%, -50%) scale(${0.95 + press.progress * 0.2})`,
                  boxShadow: `0 10px 26px ${style.shadow}`,
                }}
              />
              <div
                className="absolute h-[2px] w-9 rounded-full"
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  backgroundColor: style.light,
                  opacity: press.opacity * 0.86,
                  transform: 'translate(-50%, -50%) rotate(45deg)',
                }}
              />
              <div
                className="absolute h-[2px] w-9 rounded-full"
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  backgroundColor: style.light,
                  opacity: press.opacity * 0.86,
                  transform: 'translate(-50%, -50%) rotate(-45deg)',
                }}
              />
            </div>
          );
        }

        return (
          <div key={press.id}>
            <div
              className="absolute rounded-full border"
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                width: press.kind === 'rageTap' ? 66 : press.kind === 'longPress' ? 62 : 56,
                height: press.kind === 'rageTap' ? 66 : press.kind === 'longPress' ? 62 : 56,
                borderColor: style.light,
                backgroundColor: style.faint,
                opacity: (1 - press.progress) * (press.kind === 'rageTap' ? 0.86 : 0.58),
                transform: `translate(-50%, -50%) scale(${rippleScale})`,
                boxShadow: `0 0 28px ${style.shadow}`,
              }}
            />
            {press.kind === 'rageTap' && (
              <div
                className="absolute rounded-full border-2"
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  width: 50,
                  height: 50,
                  borderColor: style.accent,
                  opacity: Math.max(0, 0.82 - press.progress * 0.45),
                  transform: `translate(-50%, -50%) scale(${1 + press.progress * 0.65})`,
                }}
              />
            )}
            <div
              className="absolute rounded-full blur-[5px]"
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                width: coreSize + 14,
                height: coreSize + 12,
                backgroundColor: style.shadow,
                opacity: press.opacity * 0.72,
                transform: `translate(-50%, -42%) scale(${coreScale})`,
              }}
            />
            <div
              className="absolute rounded-full border border-white/60"
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                width: coreSize,
                height: coreSize * 0.88,
                backgroundColor: style.accent,
                opacity: press.opacity,
                transform: `translate(-50%, -50%) rotate(${press.rotate}deg) scale(${coreScale})`,
                boxShadow: `0 10px 26px ${style.shadow}, inset 0 0 0 2px rgba(255,255,255,0.54)`,
                animation: press.kind === 'longPress' ? 'replay-fingertip-breathe 0.9s ease-in-out infinite' : undefined,
              }}
            />
          </div>
        );
      })}

      {renderedNetwork.length > 0 && (
        <div className="absolute right-2 top-12 z-20 flex flex-col items-end gap-1.5">
          {renderedNetwork.map((network) => (
            <div
              key={network.id}
              className="relative h-6 w-[58px] overflow-hidden rounded-full border bg-slate-950/62 shadow-lg backdrop-blur-md"
              style={{
                borderColor: network.color,
                opacity: network.opacity,
                transform: `translateY(${network.lane * 1.5}px) scale(${network.isSettling ? 0.98 : 1})`,
                boxShadow: `0 8px 22px ${network.trackColor}`,
              }}
            >
              <span
                className="absolute left-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                style={{
                  backgroundColor: network.color,
                  boxShadow: `0 0 14px ${network.color}`,
                  opacity: network.isSettling ? 0.9 : 0.72,
                }}
              />
              <span
                className="absolute right-2 top-1/2 h-1.5 w-8 -translate-y-1/2 overflow-hidden rounded-full bg-white/15"
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(8, network.progress * 100)}%`,
                    backgroundColor: network.color,
                    opacity: 0.9,
                  }}
                />
              </span>
              {!network.isSettling && (
                <span
                  className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${14 + network.progress * 30}px`,
                    backgroundColor: network.color,
                    boxShadow: `0 0 12px ${network.color}`,
                    animation: 'replay-network-bead 0.65s ease-in-out infinite',
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
