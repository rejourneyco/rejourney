import React from 'react';

interface SelectProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: { value: string; label: string }[];
  className?: string;
  label?: string;
}

export const Select: React.FC<SelectProps> = ({ value, onChange, options, className = '', label }) => {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-mono">{label}</label>}
      <select
        value={value}
        onChange={onChange}
        className={`px-2 py-1.5 text-xs font-mono border border-black bg-white focus:outline-none focus:ring-1 focus:ring-black ${className}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

