/**
 * TagProgressView - 태그별 진행률 대시보드
 */
import ProgressBar from '../common/ProgressBar';
import TagBadge from '../common/TagBadge';

interface TagProgress {
  name: string;
  progress: number;
  goalCount: number;
}

interface TagProgressViewProps {
  tags: TagProgress[];
  onTagClick?: (tagName: string) => void;
  selectedTag?: string;
}

export default function TagProgressView({ tags, onTagClick, selectedTag }: TagProgressViewProps) {
  if (tags.length === 0) {
    return <div className="text-center py-8 text-gray-400 text-sm">등록된 태그가 없습니다</div>;
  }

  const sorted = [...tags].sort((a, b) => b.progress - a.progress);

  return (
    <div className="space-y-3">
      {sorted.map(tag => (
        <div key={tag.name}
          className={`bg-white rounded-lg border p-3 cursor-pointer hover:shadow-sm transition-all ${
            selectedTag === tag.name ? 'border-primary-300 bg-primary-50/30' : 'border-gray-200'
          }`}
          onClick={() => onTagClick?.(tag.name)}>
          <div className="flex items-center justify-between mb-2">
            <TagBadge name={tag.name} active={selectedTag === tag.name} onClick={() => onTagClick?.(tag.name)} />
            <span className="text-xs text-gray-400">{tag.goalCount}개 목표</span>
          </div>
          <ProgressBar progress={tag.progress} size="md" showLabel />
        </div>
      ))}
    </div>
  );
}
