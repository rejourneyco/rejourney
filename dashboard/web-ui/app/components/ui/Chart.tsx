import React from 'react';
import { RealChart, StackedDataPoint } from './RealChart';

interface ChartDataPoint {
  label: string;
  value: number;
}

interface ChartProps {
  title?: string;
  data?: ChartDataPoint[] | StackedDataPoint[];
  height?: number;
  className?: string;
  type?: 'line' | 'bar' | 'area' | 'stacked-bar';
  color?: string;
  showGrid?: boolean;
}

export const Chart: React.FC<ChartProps> = ({
  title,
  data = [],
  height = 200,
  className = '',
  type = 'line',
  color = '#000',
  showGrid = true,
}) => {
  return (
    <RealChart
      title={title}
      data={data as any}
      height={height}
      className={className}
      type={type}
      color={color}
      showGrid={showGrid}
    />
  );
};

