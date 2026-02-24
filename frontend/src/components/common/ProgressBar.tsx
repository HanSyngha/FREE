/**
 * ProgressBar - 진행률 바
 */

interface ProgressBarProps {
  progress: number;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export default function ProgressBar({ progress, size = 'sm', showLabel = true }: ProgressBarProps) {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const height = size === 'md' ? 'h-2.5' : 'h-1.5';

  const color =
    clampedProgress >= 80 ? 'bg-green-500' :
    clampedProgress >= 50 ? 'bg-blue-500' :
    clampedProgress >= 20 ? 'bg-yellow-500' :
    'bg-gray-300';

  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 ${height} bg-gray-100 rounded-full overflow-hidden`}>
        <div
          className={`${height} ${color} rounded-full transition-all duration-300`}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-gray-500 font-medium tabular-nums w-8 text-right">
          {clampedProgress}%
        </span>
      )}
    </div>
  );
}
