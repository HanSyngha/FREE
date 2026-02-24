/**
 * DashboardSection - 좌측 컬러바 + 제목 + 콘텐츠 래퍼
 */
import { type ReactNode } from 'react';

const COLOR_MAP = {
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  purple: 'bg-purple-500',
  orange: 'bg-amber-500',
} as const;

interface DashboardSectionProps {
  title: string;
  count?: number;
  colorBar?: keyof typeof COLOR_MAP;
  headerRight?: ReactNode;
  children: ReactNode;
  emptyText?: string;
  isEmpty?: boolean;
}

export default function DashboardSection({
  title,
  count,
  colorBar = 'blue',
  headerRight,
  children,
  emptyText = '데이터가 없습니다',
  isEmpty,
}: DashboardSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex">
        <div className={`w-1 ${COLOR_MAP[colorBar]} flex-shrink-0`} />
        <div className="flex-1 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              {title}
              {count !== undefined && (
                <span className="text-gray-400 font-normal ml-1">({count})</span>
              )}
            </h2>
            {headerRight}
          </div>
          {isEmpty ? (
            <p className="text-xs text-gray-400 py-2">{emptyText}</p>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
