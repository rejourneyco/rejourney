import React, { useRef, useState, useEffect, useCallback } from 'react';

interface TruncatedTextProps {
  text: string;
  className?: string;
  maxLines?: number;
}

export const TruncatedText: React.FC<TruncatedTextProps> = ({
  text,
  className = '',
  maxLines = 1,
}) => {
  const [isTruncated, setIsTruncated] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const textRef = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      if (textRef.current) {
        const el = textRef.current;
        if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
          setIsTruncated(true);
          setShowTooltip(true);
        }
      }
    }, 200);
  }, []);

  const handleLeave = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    setShowTooltip(false);
  }, []);

  useEffect(() => {
    if (textRef.current) {
      const element = textRef.current;
      const isOverflowing = element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
      setIsTruncated(isOverflowing);
    }
  }, [text]);

  const getLineClampClass = () => {
    if (maxLines === 1) return 'truncate';
    if (maxLines === 2) return 'line-clamp-2';
    if (maxLines === 3) return 'line-clamp-3';
    return 'line-clamp-2';
  };

  return (
    <span className="relative inline-block w-full">
      <span
        ref={textRef}
        className={`${getLineClampClass()} ${className} block`}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {text}
      </span>
      {isTruncated && showTooltip && textRef.current && (
        <div
          className="fixed z-50 max-w-xs rounded bg-black px-2 py-1 text-[10px] leading-snug text-white shadow pointer-events-none whitespace-normal break-words"
          style={{
            left: `${textRef.current.getBoundingClientRect().left + textRef.current.offsetWidth / 2}px`,
            top: `${textRef.current.getBoundingClientRect().top}px`,
            transform: 'translate(-50%, -100%)',
            marginTop: '-4px',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
};

