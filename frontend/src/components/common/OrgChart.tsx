/**
 * OrgChart - 읽기 전용 가로형 조직도 트리 (CSS flexbox)
 */
import { useNavigate } from 'react-router-dom';

export interface OrgNode {
  id: string;
  name: string;
  type: 'BU' | 'TEAM' | 'GROUP' | 'PART';
  memberCount?: number;
  children?: OrgNode[];
}

interface OrgChartProps {
  root: OrgNode;
  currentId?: string;
  onNodeClick?: (node: OrgNode) => void;
}

function getSpacePath(node: OrgNode) {
  switch (node.type) {
    case 'BU': return `/space/bu/${node.id}`;
    case 'TEAM': return '/space/team';
    case 'GROUP': return `/space/group/${node.id}`;
    case 'PART': return `/space/part/${node.id}`;
  }
}

function NodeCard({ node, isCurrent, onClick }: {
  node: OrgNode;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const typeLabel = { BU: '사업부', TEAM: '팀', GROUP: '그룹', PART: '파트' }[node.type];

  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-2 rounded-lg border text-left transition-all text-xs whitespace-nowrap
        hover:shadow-sm cursor-pointer min-w-[80px]
        ${isCurrent
          ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-300'
          : 'border-gray-200 bg-white hover:border-primary-300'}
      `}
    >
      <div className="font-medium text-gray-800 leading-tight">{node.name}</div>
      <div className="text-gray-400 mt-0.5">
        {typeLabel}
        {node.memberCount !== undefined && ` ${node.memberCount}명`}
      </div>
    </button>
  );
}

function TreeBranch({ nodes, currentId, onNodeClick, isLast = false }: {
  nodes: OrgNode[];
  currentId?: string;
  onNodeClick: (node: OrgNode) => void;
  isLast?: boolean;
}) {
  if (nodes.length === 0) return null;

  return (
    <div className="flex items-stretch">
      {/* 연결선 (가로) */}
      <div className="flex flex-col justify-center w-6 shrink-0">
        <div className="border-t border-gray-300 w-full" />
      </div>

      {/* 자식 노드들 */}
      <div className="flex flex-col gap-2">
        {nodes.map((node, i) => (
          <div key={node.id} className="flex items-center">
            {/* 세로 연결선 */}
            {nodes.length > 1 && (
              <div className="relative w-3 self-stretch shrink-0">
                {/* 세로선 */}
                <div className={`absolute left-0 border-l border-gray-300 ${
                  i === 0 ? 'top-1/2 bottom-0' :
                  i === nodes.length - 1 ? 'top-0 bottom-1/2' : 'top-0 bottom-0'
                }`} />
                {/* 가로선 (노드로) */}
                <div className="absolute top-1/2 left-0 w-full border-t border-gray-300" />
              </div>
            )}

            <div className="flex items-center">
              <NodeCard
                node={node}
                isCurrent={node.id === currentId}
                onClick={() => onNodeClick(node)}
              />
              {node.children && node.children.length > 0 && (
                <TreeBranch
                  nodes={node.children}
                  currentId={currentId}
                  onNodeClick={onNodeClick}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OrgChart({ root, currentId, onNodeClick }: OrgChartProps) {
  const navigate = useNavigate();

  const handleClick = (node: OrgNode) => {
    if (onNodeClick) {
      onNodeClick(node);
    } else {
      navigate(getSpacePath(node));
    }
  };

  return (
    <div className="overflow-x-auto py-3">
      <div className="flex items-center min-w-fit">
        <NodeCard
          node={root}
          isCurrent={root.id === currentId}
          onClick={() => handleClick(root)}
        />
        {root.children && root.children.length > 0 && (
          <TreeBranch
            nodes={root.children}
            currentId={currentId}
            onNodeClick={handleClick}
          />
        )}
      </div>
    </div>
  );
}
