/**
 * DashboardGrid - 2컬럼 반응형 그리드 레이아웃
 * top/bottom은 풀폭, left/right는 lg에서 2컬럼
 */
import { type ReactNode } from 'react';

interface DashboardGridProps {
  top?: ReactNode;
  left: ReactNode;
  right: ReactNode;
  bottom?: ReactNode;
}

export default function DashboardGrid({ top, left, right, bottom }: DashboardGridProps) {
  return (
    <div className="space-y-4">
      {top}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">{left}</div>
        <div className="space-y-4">{right}</div>
      </div>
      {bottom}
    </div>
  );
}
