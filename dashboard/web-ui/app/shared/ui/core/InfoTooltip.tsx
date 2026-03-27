import React, { useId, useState } from 'react';

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

  const alignmentClass = align === 'left'
    ? 'left-0'
    : align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';

  const show = () => setIsVisible(true);
  const hide = () => setIsVisible(false);
  const toggle = () => setIsVisible((prev) => !prev);

  return (
    <span className={`relative inline-flex ${className || ''}`}>
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-700 transition hover:bg-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
        aria-label="Show info"
        aria-describedby={isVisible ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={toggle}
      >
        {label}
      </button>
      <div
        id={tooltipId}
        role="tooltip"
        className={`absolute z-30 mt-1 max-w-xs rounded bg-black px-2 py-1 text-[10px] leading-snug text-white shadow transition-all duration-150 ${alignmentClass} ${isVisible ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-95'}`}
      >
        {content}
      </div>
    </span>
  );
};
