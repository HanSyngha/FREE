/**
 * TagBadge - 태그 배지
 */

interface TagBadgeProps {
  name: string;
  onClick?: () => void;
  active?: boolean;
}

const TAG_COLORS = [
  'bg-blue-50 text-blue-700 border-blue-200',
  'bg-green-50 text-green-700 border-green-200',
  'bg-purple-50 text-purple-700 border-purple-200',
  'bg-orange-50 text-orange-700 border-orange-200',
  'bg-pink-50 text-pink-700 border-pink-200',
  'bg-cyan-50 text-cyan-700 border-cyan-200',
];

function getTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!;
}

export default function TagBadge({ name, onClick, active }: TagBadgeProps) {
  const colorClass = active
    ? 'bg-primary-100 text-primary-700 border-primary-300'
    : getTagColor(name);

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border
        ${colorClass} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {name}
    </span>
  );
}
