/**
 * GoalCard - 목표 카드
 */
import ProgressBar from '../common/ProgressBar';
import TagBadge from '../common/TagBadge';

interface GoalCardProps {
  goal: {
    id: string;
    title: string;
    content?: string;
    status: string;
    progress: number;
    startDate?: string | null;
    endDate?: string | null;
    summary?: string | null;
    itemTags?: Array<{ tag: { name: string } }>;
    childItems?: Array<{ id: string; title: string; progress: number; status: string }>;
    _count?: { linkedWorkLogs: number; linkedTodos: number };
  };
  onClick?: () => void;
  compact?: boolean;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PLANNED: { label: '예정', color: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: '진행중', color: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: '완료', color: 'bg-green-100 text-green-700' },
};

export default function GoalCard({ goal, onClick, compact = false }: GoalCardProps) {
  const status = STATUS_LABELS[goal.status] || STATUS_LABELS.PLANNED;
  const tags = goal.itemTags?.map(it => it.tag.name) || [];

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`px-3 py-2.5 bg-white rounded-lg border border-gray-200 hover:shadow-sm transition-shadow ${onClick ? 'cursor-pointer' : ''}`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-800 truncate flex-1">{goal.title}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${status.color} ml-2 flex-shrink-0`}>
            {status.label}
          </span>
        </div>
        <ProgressBar progress={goal.progress} size="sm" />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 flex-1">{goal.title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${status.color} ml-2 flex-shrink-0`}>
          {status.label}
        </span>
      </div>

      {goal.summary && (
        <p className="text-xs text-gray-500 mb-2">{goal.summary}</p>
      )}

      <div className="mb-2">
        <ProgressBar progress={goal.progress} size="md" />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.map(tag => <TagBadge key={tag} name={tag} />)}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-400">
        {goal.startDate && <span>{goal.startDate.split('T')[0]}</span>}
        {goal.startDate && goal.endDate && <span>~</span>}
        {goal.endDate && <span>{goal.endDate.split('T')[0]}</span>}
        {goal._count && (
          <span className="ml-auto">
            {goal._count.linkedWorkLogs > 0 && `기록 ${goal._count.linkedWorkLogs}`}
            {goal._count.linkedWorkLogs > 0 && goal._count.linkedTodos > 0 && ' · '}
            {goal._count.linkedTodos > 0 && `할일 ${goal._count.linkedTodos}`}
          </span>
        )}
      </div>
    </div>
  );
}
