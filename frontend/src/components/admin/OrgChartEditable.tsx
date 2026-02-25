/**
 * OrgChartEditable - 편집 가능 조직도 (이름수정/생성/삭제/사용자 재배치)
 * BU view (buId): BU → Teams → Groups → Parts
 * Team view (teamId): Team → Groups → Parts
 */
import { useState, useEffect, useRef } from 'react';
import { orgApi, teamAdminApi } from '../../services/api';
import type { OrgNode } from '../common/OrgChart';

interface OrgChartEditableProps {
  teamId?: string;
  buId?: string;
  editLevel: 'BU' | 'TEAM' | 'GROUP' | 'PART';
  editTargetId?: string;
  onRefresh: () => void;
}

interface TreeData {
  tree: OrgNode;
}

interface UserItem {
  id: string;
  username: string;
  loginid: string;
  groupId: string | null;
  partId: string | null;
  group?: { id: string; name: string } | null;
  part?: { id: string; name: string } | null;
}

// ── 확인 모달 ──────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm mx-4">
        <p className="text-sm text-gray-700 mb-4 whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
            취소
          </button>
          <button onClick={onConfirm}
            className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 인라인 이름 입력 ──────────────────────────────────────

function InlineInput({ defaultValue, placeholder, onSubmit, onCancel }: {
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue || '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && value.trim()) onSubmit(value.trim());
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={onCancel}
      className="px-2 py-1 text-xs border border-primary-300 rounded-md outline-none ring-1 ring-primary-200 w-28"
    />
  );
}

// ── 편집 가능 노드 카드 ──────────────────────────────────

function EditableNodeCard({ node, canEdit, canDelete, canCreate, onRename, onCreate, onCreateDirect, onDelete }: {
  node: OrgNode;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  onRename: (id: string, type: OrgNode['type'], currentName: string) => void;
  onCreate: (parentId: string, parentType: OrgNode['type']) => void;
  onCreateDirect: (parentId: string, parentType: OrgNode['type']) => void;
  onDelete: (id: string, type: OrgNode['type'], name: string) => void;
}) {
  const typeLabel = { BU: '사업부', TEAM: '팀', GROUP: '그룹', PART: '파트' }[node.type];
  const isEmpty = (node.memberCount || 0) === 0 && (!node.children || node.children.length === 0);

  return (
    <div className="flex items-center gap-1 group">
      <div className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-xs min-w-[80px]">
        <div className="font-medium text-gray-800 leading-tight flex items-center gap-1">
          {node.name}
          {canEdit && (
            <button
              onClick={() => onRename(node.id, node.type, node.name)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-primary-600"
              title="이름 수정"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
              </svg>
            </button>
          )}
        </div>
        <div className="text-gray-400 mt-0.5">
          {typeLabel}
          {node.memberCount !== undefined && ` ${node.memberCount}명`}
        </div>
      </div>

      {/* + 버튼 (하위 생성) */}
      {canCreate && (node.type === 'TEAM' || node.type === 'GROUP') && (
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onCreate(node.id, node.type)}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 hover:bg-primary-200 text-xs"
            title={node.type === 'TEAM' ? '그룹 추가' : '파트 추가'}
          >
            +
          </button>
          <button
            onClick={() => onCreateDirect(node.id, node.type)}
            className="px-1.5 h-5 flex items-center justify-center rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 text-[10px] font-medium"
            title="직속 추가"
          >
            직속
          </button>
        </div>
      )}

      {/* x 버튼 (빈 노드 삭제) */}
      {canDelete && isEmpty && (node.type === 'GROUP' || node.type === 'PART') && (
        <button
          onClick={() => onDelete(node.id, node.type, node.name)}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 text-xs"
          title="삭제"
        >
          x
        </button>
      )}
    </div>
  );
}

// ── 사용자 드래그 카드 ──────────────────────────────────

function DraggableUser({ user }: { user: UserItem }) {
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('userId', user.id);
        e.dataTransfer.setData('userName', user.username);
        e.dataTransfer.setData('fromGroup', user.group?.name || '미배치');
        e.dataTransfer.setData('fromPart', user.part?.name || '미배치');
      }}
      className="px-2 py-1 text-xs bg-gray-50 border border-gray-200 rounded cursor-grab hover:border-primary-300 hover:bg-primary-50/30 transition-colors"
    >
      {user.username}
      <span className="text-gray-400 ml-1">{user.part?.name || '미배치'}</span>
    </div>
  );
}

// ── 드롭 가능 파트 노드 ──────────────────────────────────

function DroppablePartNode({ node, canEdit, canDelete, onRename, onDelete, onDrop }: {
  node: OrgNode;
  canEdit: boolean;
  canDelete: boolean;
  onRename: (id: string, type: OrgNode['type'], currentName: string) => void;
  onDelete: (id: string, type: OrgNode['type'], name: string) => void;
  onDrop: (userId: string, userName: string, fromInfo: string, toPartId: string, toGroupId: string, toPartName: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const isEmpty = (node.memberCount || 0) === 0;

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        const userId = e.dataTransfer.getData('userId');
        const userName = e.dataTransfer.getData('userName');
        const fromGroup = e.dataTransfer.getData('fromGroup');
        const fromPart = e.dataTransfer.getData('fromPart');
        onDrop(userId, userName, `${fromGroup}/${fromPart}`, node.id, '', node.name);
      }}
      className="flex items-center gap-1 group"
    >
      <div className={`px-3 py-2 rounded-lg border text-xs min-w-[80px] transition-colors ${
        dragOver ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-300' : 'border-gray-200 bg-white'
      }`}>
        <div className="font-medium text-gray-800 leading-tight flex items-center gap-1">
          {node.name}
          {canEdit && (
            <button
              onClick={() => onRename(node.id, node.type, node.name)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-primary-600"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
              </svg>
            </button>
          )}
        </div>
        <div className="text-gray-400 mt-0.5">파트 {node.memberCount ?? 0}명</div>
      </div>

      {canDelete && isEmpty && (
        <button
          onClick={() => onDelete(node.id, node.type, node.name)}
          className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 text-xs"
        >
          x
        </button>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────

export default function OrgChartEditable({ teamId, buId, editLevel, editTargetId, onRefresh }: OrgChartEditableProps) {
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 편집 상태
  const [renaming, setRenaming] = useState<{ id: string; type: OrgNode['type']; name: string } | null>(null);
  const [creating, setCreating] = useState<{ parentId: string; parentType: OrgNode['type'] } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null);

  const isBUView = !!buId;
  const canEditGroup = editLevel === 'BU' || editLevel === 'TEAM';
  const canEditSubGroup = editLevel === 'BU' || editLevel === 'TEAM' || editLevel === 'GROUP';

  const fetchTree = async () => {
    try {
      const treeRes = buId
        ? await orgApi.getTree(undefined, buId)
        : await orgApi.getTree(teamId);
      setTreeData(treeRes.data);

      // 사용자 목록 로드 (드래그 재배치용)
      const usersRes = await teamAdminApi.getUsers();
      setUsers(usersRes.data.users || []);
    } catch { setError('조직도를 불러올 수 없습니다.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTree(); }, [teamId, buId]);

  // ── 핸들러 ──────────────────────────────────────────

  const handleRename = (id: string, type: OrgNode['type'], currentName: string) => {
    setRenaming({ id, type, name: currentName });
  };

  const submitRename = (newName: string) => {
    if (!renaming) return;
    const { id, type, name: oldName } = renaming;
    setRenaming(null);
    setConfirm({
      message: `'${oldName}'을(를) '${newName}'(으)로 변경하시겠습니까?`,
      action: async () => {
        if (type === 'GROUP') await orgApi.renameGroup(id, newName);
        else if (type === 'PART') await orgApi.renamePart(id, newName);
        await fetchTree();
        onRefresh();
      },
    });
  };

  const handleCreate = (parentId: string, parentType: OrgNode['type']) => {
    setCreating({ parentId, parentType });
  };

  const handleCreateDirect = (parentId: string, parentType: OrgNode['type']) => {
    const childType = parentType === 'TEAM' ? '그룹' : '파트';
    setConfirm({
      message: `'직속' ${childType}을(를) 생성하시겠습니까?`,
      action: async () => {
        if (parentType === 'TEAM') {
          const res = await orgApi.createGroup(parentId, '직속');
          // 직속 그룹 아래에 직속 파트도 자동 생성
          await orgApi.createPart(res.data.group.id, '직속');
        } else if (parentType === 'GROUP') {
          await orgApi.createPart(parentId, '직속');
        }
        await fetchTree();
        onRefresh();
      },
    });
  };

  const submitCreate = (name: string) => {
    if (!creating) return;
    const { parentId, parentType } = creating;
    const childType = parentType === 'TEAM' ? '그룹' : '파트';
    setCreating(null);
    setConfirm({
      message: `'${name}' ${childType}을(를) 생성하시겠습니까?`,
      action: async () => {
        if (parentType === 'TEAM') await orgApi.createGroup(parentId, name);
        else if (parentType === 'GROUP') await orgApi.createPart(parentId, name);
        await fetchTree();
        onRefresh();
      },
    });
  };

  const handleDelete = (id: string, type: OrgNode['type'], name: string) => {
    const label = type === 'GROUP' ? '그룹' : '파트';
    setConfirm({
      message: `'${name}' ${label}을(를) 삭제하시겠습니까?`,
      action: async () => {
        if (type === 'GROUP') await orgApi.deleteGroup(id);
        else if (type === 'PART') await orgApi.deletePart(id);
        await fetchTree();
        onRefresh();
      },
    });
  };

  const handleUserDrop = (userId: string, userName: string, fromInfo: string, toPartId: string, _toGroupId: string, toPartName: string) => {
    // tree에서 파트의 부모 그룹을 찾기 (BU view와 Team view 모두 지원)
    let groupId = '';
    if (treeData) {
      const tree = treeData.tree;
      if (isBUView) {
        // BU → Teams → Groups → Parts
        for (const team of tree.children || []) {
          for (const group of team.children || []) {
            if (group.children?.some(p => p.id === toPartId)) { groupId = group.id; break; }
          }
          if (groupId) break;
        }
      } else {
        // Team → Groups → Parts
        for (const g of tree.children || []) {
          if (g.children?.some(p => p.id === toPartId)) { groupId = g.id; break; }
        }
      }
    }
    if (!groupId) return;

    setConfirm({
      message: `${userName}을(를) ${fromInfo}에서 ${toPartName}(으)로 이동하시겠습니까?`,
      action: async () => {
        await orgApi.reassignUser(userId, groupId, toPartId);
        await fetchTree();
        onRefresh();
      },
    });
  };

  const executeConfirm = async () => {
    if (!confirm) return;
    try {
      await confirm.action();
    } catch (err: any) {
      setError(err.response?.data?.error || '작업에 실패했습니다.');
    }
    setConfirm(null);
  };

  // ── 렌더 헬퍼: 파트 브랜치 ──────────────────────────

  const renderPartsBranch = (group: OrgNode) => {
    const parts = group.children || [];
    if (parts.length === 0 && !(creating?.parentId === group.id && creating?.parentType === 'GROUP')) return null;

    return (
      <div className="flex items-stretch">
        <div className="flex flex-col justify-center w-6 shrink-0">
          <div className="border-t border-gray-300 w-full" />
        </div>
        <div className="flex flex-col gap-2">
          {parts.map((part, pi) => (
            <div key={part.id} className="flex items-center">
              {parts.length > 1 && (
                <div className="relative w-3 self-stretch shrink-0">
                  <div className={`absolute left-0 border-l border-gray-300 ${
                    pi === 0 ? 'top-1/2 bottom-0' :
                    pi === parts.length - 1 ? 'top-0 bottom-1/2' : 'top-0 bottom-0'
                  }`} />
                  <div className="absolute top-1/2 left-0 w-full border-t border-gray-300" />
                </div>
              )}

              {renaming?.id === part.id ? (
                <InlineInput defaultValue={renaming.name} onSubmit={submitRename} onCancel={() => setRenaming(null)} />
              ) : (
                <DroppablePartNode
                  node={part}
                  canEdit={canEditSubGroup && (editLevel !== 'GROUP' || editTargetId === group.id)}
                  canDelete={canEditSubGroup && (editLevel !== 'GROUP' || editTargetId === group.id)}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onDrop={handleUserDrop}
                />
              )}
            </div>
          ))}

          {creating?.parentId === group.id && creating?.parentType === 'GROUP' && (
            <InlineInput placeholder="파트 이름" onSubmit={submitCreate} onCancel={() => setCreating(null)} />
          )}
        </div>
      </div>
    );
  };

  // ── 렌더 헬퍼: 그룹 브랜치 (한 팀의 그룹→파트) ────────

  const renderGroupsBranch = (teamNode: OrgNode) => {
    const groups = teamNode.children || [];
    const hasCreating = creating?.parentId === teamNode.id && creating?.parentType === 'TEAM';
    if (groups.length === 0 && !hasCreating) return null;

    return (
      <div className="flex items-stretch">
        <div className="flex flex-col justify-center w-6 shrink-0">
          <div className="border-t border-gray-300 w-full" />
        </div>
        <div className="flex flex-col gap-3">
          {groups.map((group, gi) => (
            <div key={group.id} className="flex items-start">
              {groups.length > 1 && (
                <div className="relative w-3 self-stretch shrink-0">
                  <div className={`absolute left-0 border-l border-gray-300 ${
                    gi === 0 ? 'top-[14px] bottom-0' :
                    gi === groups.length - 1 ? 'top-0 bottom-[calc(100%-14px)]' : 'top-0 bottom-0'
                  }`} />
                  <div className="absolute top-[14px] left-0 w-full border-t border-gray-300" />
                </div>
              )}

              <div className="flex items-start">
                {renaming?.id === group.id ? (
                  <InlineInput defaultValue={renaming.name} onSubmit={submitRename} onCancel={() => setRenaming(null)} />
                ) : (
                  <EditableNodeCard
                    node={group}
                    canEdit={canEditSubGroup && (editLevel !== 'GROUP' || editTargetId === group.id)}
                    canDelete={canEditGroup}
                    canCreate={canEditSubGroup && (editLevel !== 'GROUP' || editTargetId === group.id)}
                    onRename={handleRename}
                    onCreate={handleCreate}
                    onCreateDirect={handleCreateDirect}
                    onDelete={handleDelete}
                  />
                )}

                {renderPartsBranch(group)}

                {/* 파트가 없을 때 새 파트 생성 */}
                {(group.children?.length ?? 0) === 0 && creating?.parentId === group.id && creating?.parentType === 'GROUP' && (
                  <div className="flex items-center">
                    <div className="w-6 border-t border-gray-300" />
                    <InlineInput placeholder="파트 이름" onSubmit={submitCreate} onCancel={() => setCreating(null)} />
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* 새 그룹 생성 인라인 */}
          {hasCreating && (
            <div className="flex items-center">
              {groups.length > 0 && (
                <div className="relative w-3 self-stretch shrink-0">
                  <div className="absolute left-0 top-0 bottom-[calc(100%-14px)] border-l border-gray-300" />
                  <div className="absolute top-[14px] left-0 w-full border-t border-gray-300" />
                </div>
              )}
              <InlineInput placeholder="그룹 이름" onSubmit={submitCreate} onCancel={() => setCreating(null)} />
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── 렌더링 ──────────────────────────────────────────

  if (loading) return <div className="flex justify-center py-8"><div className="w-6 h-6 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  if (!treeData) return <div className="text-center py-8 text-gray-400">{error || '조직도 데이터 없음'}</div>;

  const tree = treeData.tree;

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-600">x</button>
        </div>
      )}

      {/* 조직도 트리 */}
      <div className="overflow-x-auto">
        <div className="flex items-start min-w-fit py-3 gap-0">
          {isBUView ? (
            <>
              {/* BU root */}
              <EditableNodeCard
                node={tree}
                canEdit={false}
                canDelete={false}
                canCreate={false}
                onRename={handleRename}
                onCreate={handleCreate}
                onCreateDirect={handleCreateDirect}
                onDelete={handleDelete}
              />

              {/* Teams branch */}
              {(tree.children?.length ?? 0) > 0 && (
                <div className="flex items-stretch">
                  <div className="flex flex-col justify-center w-6 shrink-0">
                    <div className="border-t border-gray-300 w-full" />
                  </div>
                  <div className="flex flex-col gap-4">
                    {tree.children!.map((team, ti) => (
                      <div key={team.id} className="flex items-start">
                        {/* 팀 간 세로 연결선 */}
                        {tree.children!.length > 1 && (
                          <div className="relative w-3 self-stretch shrink-0">
                            <div className={`absolute left-0 border-l border-gray-300 ${
                              ti === 0 ? 'top-[14px] bottom-0' :
                              ti === tree.children!.length - 1 ? 'top-0 bottom-[calc(100%-14px)]' : 'top-0 bottom-0'
                            }`} />
                            <div className="absolute top-[14px] left-0 w-full border-t border-gray-300" />
                          </div>
                        )}

                        <div className="flex items-start">
                          <EditableNodeCard
                            node={team}
                            canEdit={false}
                            canDelete={false}
                            canCreate={canEditGroup}
                            onRename={handleRename}
                            onCreate={handleCreate}
                            onCreateDirect={handleCreateDirect}
                            onDelete={handleDelete}
                          />
                          {renderGroupsBranch(team)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Team root */}
              <EditableNodeCard
                node={tree}
                canEdit={false}
                canDelete={false}
                canCreate={canEditGroup}
                onRename={handleRename}
                onCreate={handleCreate}
                onCreateDirect={handleCreateDirect}
                onDelete={handleDelete}
              />
              {renderGroupsBranch(tree)}

              {/* 그룹이 없을 때 새 그룹 생성 */}
              {(tree.children?.length ?? 0) === 0 && creating?.parentId === tree.id && creating?.parentType === 'TEAM' && (
                <div className="flex items-center">
                  <div className="w-6 border-t border-gray-300" />
                  <InlineInput placeholder="그룹 이름" onSubmit={submitCreate} onCancel={() => setCreating(null)} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 사용자 목록 (드래그 소스) — 단일 팀 뷰에서만 */}
      {canEditSubGroup && users.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 mb-2">
            팀원 ({users.length}명) — 파트 노드로 드래그하여 재배치
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {users.map(u => <DraggableUser key={u.id} user={u} />)}
          </div>
        </div>
      )}

      {/* 확인 모달 */}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          onConfirm={executeConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
