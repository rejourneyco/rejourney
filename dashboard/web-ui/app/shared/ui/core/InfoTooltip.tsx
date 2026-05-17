import React, { useId, useRef, useState } from 'react';

type InfoTooltipProps = {
  content: string;
  align?: 'left' | 'center' | 'right';
  label?: string;
  className?: string;
};

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  content,
  align = 'center',
  label = '?',
  className,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const tooltipId = useId();
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alignmentClass = align === 'left'
    ? 'left-0'
    : align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';

  const handleEnter = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => setIsVisible(true), 200);
  };

  const handleLeave = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    setIsVisible(false);
  };

  return (
    <span
      className={`relative inline-flex ${className || ''}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-700 transition hover:bg-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
        aria-label="Show info"
        aria-describedby={isVisible ? tooltipId : undefined}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        onClick={() => setIsVisible((prev) => !prev)}
      >
        {label}
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute z-30 mt-1 max-w-xs rounded bg-black px-2 py-1 text-[10px] leading-snug text-white shadow transition-all duration-150 ${alignmentClass} ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      >
        {content}
      </div>
    </span>
  );
};
