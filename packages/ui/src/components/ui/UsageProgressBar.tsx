import React from 'react';
import { Progress } from './progress';
import { cn } from '@workspace/ui/lib/utils';

export interface UsageProgressBarProps {
  label: string;
  current: number;
  max: number;
  unit?: string;
  className?: string;
}

export function UsageProgressBar({ label, current, max, unit = '', className }: UsageProgressBarProps) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0;
  
  // Choose color based on usage
  let colorClass = 'bg-primary';
  if (percentage >= 90) {
    colorClass = 'bg-destructive';
  } else if (percentage >= 75) {
    colorClass = 'bg-yellow-500';
  }

  return (
    <div className={cn("w-full space-y-2", className)}>
      <div className="flex justify-between text-sm font-medium">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {current} / {max} {unit}
        </span>
      </div>
      <Progress value={percentage} indicatorClassName={colorClass} className="h-2" />
    </div>
  );
}
