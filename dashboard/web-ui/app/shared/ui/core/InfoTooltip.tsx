import React, { useId, useRef, useState } from 'react';

type InfoTooltipProps = {
  content: string;
  align?: 'left' | 'center' | 'right';
  label?: string;
  trigger?: React.ReactNode;
  className?: string;
};

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  content,
  align = 'center',
  label = '?',
  trigger,
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
      {trigger ? (
        <span
          tabIndex={0}
          className="cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 focus-visible:ring-offset-2"
          aria-describedby={isVisible ? tooltipId : undefined}
          onFocus={() => setIsVisible(true)}
          onBlur={() => setIsVisible(false)}
        >
          {trigger}
        </span>
      ) : (
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#f1f3f4] text-[10px] font-medium text-[#5f6368] transition-colors hover:bg-[#e8eaed] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
          aria-label="Show info"
          aria-describedby={isVisible ? tooltipId : undefined}
          onFocus={() => setIsVisible(true)}
          onBlur={() => setIsVisible(false)}
          onClick={() => setIsVisible((prev) => !prev)}
        >
          {label}
        </button>
      )}
      <div
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute z-30 mt-1 max-w-xs rounded-none bg-[#202124] px-2.5 py-1.5 text-xs font-normal normal-case leading-snug text-white shadow-[0_2px_6px_rgba(60,64,67,0.3)] transition-opacity duration-150 ${alignmentClass} ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      >
        {content}
      </div>
    </span>
  );
};
