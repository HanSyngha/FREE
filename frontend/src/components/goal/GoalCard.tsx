/**
 * GoalCard - 확장형 목표 카드
 * 클릭 시 인라인 확장 → 상세 정보/매핑/수정 가능
 */
import { useState } from 'react';
import { goalsApi, todosApi, workLogsApi } from '../../services/api';
import ProgressBar from '../common/ProgressBar';

const LEVEL_LABELS: Record<string, string> = {
  BU: '사업부 목표', TEAM: '팀 목표', GROUP: '그룹 목표', PART: '파트 목표',
};

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
    childItems?: Array<{ id: string; title: string; progress: number; status: string; ownerId?: string }>;
    parentItem?: { id: string; title: string; level?: string } | null;
    linkedWorkLogs?: Array<{ id: string; title: string; date?: string; user?: { id: string; username: string } }>;
    linkedTodos?: Array<{ id: string; title: string; completed?: boolean; endDate?: string; user?: { id: string; username: string } }>;
    orgWorkLogs?: Array<{ id: string; date: string; content: string; level: string }>;
    _count?: { linkedWorkLogs: number; linkedTodos: number };
  };
  canEdit?: boolean;
  compact?: boolean;
  defaultExpanded?: boolean;
  onUpdate?: () => void;
  /** 상위 목표 후보 목록 (매핑 변경용) */
  parentCandidates?: Array<{ id: string; title: string }>;
  /** 미매핑 하위 목표 목록 (하위 추가용) */
  unmappedChildren?: Array<{ id: string; title: string }>;
  /** 하위 목표의 ownerId → 조직명 맵 */
  childOrgNames?: Record<string, string>;
  /** 클릭 핸들러 (목표 대시보드 등에서 사용) */
  onClick?: () => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PLANNED: { label: '예정', color: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: '진행중', color: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: '완료', color: 'bg-green-100 text-green-700' },
};

const STATUS_OPTIONS = ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] as const;

export default function GoalCard({ goal, canEdit = false, compact = false, defaultExpanded, onUpdate, parentCandidates, unmappedChildren, childOrgNames }: GoalCardProps) {
  const status = STATUS_LABELS[goal.status] || STATUS_LABELS.PLANNED;
  const [expanded, setExpanded] = useState(defaultExpanded ?? true);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryValue, setSummaryValue] = useState(goal.summary || '');
  const [progressValue, setProgressValue] = useState(goal.progress);
  const [statusValue, setStatusValue] = useState(goal.status);
  const [saving, setSaving] = useState(false);
  const [showParentSelect, setShowParentSelect] = useState(false);
  const [showChildSelect, setShowChildSelect] = useState(false);

  const handleSaveInline = async (data: Record<string, any>) => {
    setSaving(true);
    try {
      await goalsApi.update(goal.id, data);
      onUpdate?.();
    } catch {} finally { setSaving(false); }
  };

  const handleSaveSummary = () => {
    handleSaveInline({ summary: summaryValue });
    setEditingSummary(false);
  };

  const handleChangeParent = async (parentItemId: string | null) => {
    try {
      await goalsApi.updateMapping(goal.id, { parentItemId });
      onUpdate?.();
    } catch {}
    setShowParentSelect(false);
  };

  const handleAddChild = async (childId: string) => {
    try {
      await goalsApi.updateMapping(childId, { parentItemId: goal.id });
      onUpdate?.();
    } catch {}
    setShowChildSelect(false);
  };

  const handleRemoveChild = async (childId: string) => {
    try {
      await goalsApi.updateMapping(childId, { parentItemId: null });
      onUpdate?.();
    } catch {}
  };

  const handleUnlinkTodo = async (todoId: string) => {
    try {
      await todosApi.update(todoId, { linkedItemId: null });
      onUpdate?.();
    } catch {}
  };

  const handleUnlinkWorkLog = async (workLogId: string) => {
    try {
      await workLogsApi.update(workLogId, { linkedItemId: null });
      onUpdate?.();
    } catch {}
  };

  if (compact) {
    return (
      <div className="px-3 py-2.5 bg-white rounded-lg border border-gray-200 hover:shadow-sm transition-shadow">
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
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-md transition-shadow">
      {/* 기본 정보 (항상 표시) */}
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        {goal.parentItem && (
          <p className="text-xs text-gray-400 mb-1">
            {goal.parentItem.level ? (LEVEL_LABELS[goal.parentItem.level] || '상위') : '상위'}: {goal.parentItem.title}
          </p>
        )}
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900 flex-1">{goal.title}</h3>
          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full ${status.color}`}>
              {status.label}
            </span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </div>

        {goal.summary && !expanded && (
          <p className="text-xs text-gray-500 mb-2">{goal.summary}</p>
        )}

        <div className="mb-1">
          <ProgressBar progress={goal.progress} size="md" />
        </div>

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

      {/* 확장 영역 */}
      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {/* 설명 */}
          {goal.content && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">설명</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{goal.content}</p>
            </div>
          )}

          {/* 진척사항 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-xs font-semibold text-gray-500">진척사항</h4>
              {canEdit && !editingSummary && (
                <button onClick={() => { setEditingSummary(true); setSummaryValue(goal.summary || ''); }}
                  className="text-xs text-primary-600 hover:underline">수정</button>
              )}
            </div>
            {editingSummary ? (
              <div>
                <textarea value={summaryValue} onChange={e => setSummaryValue(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg p-2 min-h-[48px] resize-y focus:ring-1 focus:ring-primary-500" />
                <div className="flex gap-2 mt-1">
                  <button onClick={handleSaveSummary} disabled={saving}
                    className="px-3 py-1 bg-primary-600 text-white text-xs rounded-lg disabled:opacity-50">저장</button>
                  <button onClick={() => setEditingSummary(false)}
                    className="px-3 py-1 bg-gray-200 text-gray-600 text-xs rounded-lg">취소</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600">{goal.summary || '(없음)'}</p>
            )}
          </div>

          {/* 진행률 + 상태 (canEdit이면 수정 가능) */}
          {canEdit && (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">진행률 ({progressValue}%)</label>
                <input type="range" min={0} max={100} value={progressValue}
                  onChange={e => setProgressValue(Number(e.target.value))}
                  onMouseUp={() => handleSaveInline({ progress: progressValue })}
                  onTouchEnd={() => handleSaveInline({ progress: progressValue })}
                  className="w-full accent-primary-600" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">상태</label>
                <select value={statusValue}
                  onChange={e => { setStatusValue(e.target.value); handleSaveInline({ status: e.target.value }); }}
                  className="px-2 py-1 text-xs border rounded-lg">
                  {STATUS_OPTIONS.map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]?.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* 상위 목표 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-xs font-semibold text-gray-500">상위 목표</h4>
              {canEdit && parentCandidates && parentCandidates.length > 0 && (
                <button onClick={() => setShowParentSelect(!showParentSelect)}
                  className="text-xs text-primary-600 hover:underline">
                  {goal.parentItem ? '변경' : '선택'}
                </button>
              )}
            </div>
            {goal.parentItem ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">{goal.parentItem.title}</span>
                {canEdit && (
                  <button onClick={() => handleChangeParent(null)}
                    className="text-xs text-red-400 hover:text-red-600">해제</button>
                )}
              </div>
            ) : (
              !showParentSelect && <span className="text-xs text-gray-400">(없음)</span>
            )}
            {showParentSelect && parentCandidates && (
              <select onChange={e => { if (e.target.value) handleChangeParent(e.target.value); }}
                className="mt-1 w-full px-2 py-1 text-xs border rounded-lg" autoFocus>
                <option value="">상위 목표 선택...</option>
                {parentCandidates.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </div>

          {/* 하위 목표 */}
          {(goal.childItems && goal.childItems.length > 0) || (canEdit && unmappedChildren && unmappedChildren.length > 0) ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-semibold text-gray-500">하위 목표 ({goal.childItems?.length || 0})</h4>
                {canEdit && unmappedChildren && unmappedChildren.length > 0 && (
                  <button onClick={() => setShowChildSelect(!showChildSelect)}
                    className="text-xs text-primary-600 hover:underline">+ 추가</button>
                )}
              </div>
              {goal.childItems?.map(child => (
                <div key={child.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-700 truncate block">
                      {child.ownerId && childOrgNames?.[child.ownerId] && (
                        <span className="text-primary-600 font-medium">{childOrgNames[child.ownerId]}: </span>
                      )}
                      {child.title}
                    </span>
                    <div className="mt-0.5"><ProgressBar progress={child.progress} size="sm" /></div>
                  </div>
                  {canEdit && (
                    <button onClick={() => handleRemoveChild(child.id)}
                      className="text-xs text-red-400 hover:text-red-600 ml-2 flex-shrink-0">제거</button>
                  )}
                </div>
              ))}
              {showChildSelect && unmappedChildren && (
                <select onChange={e => { if (e.target.value) handleAddChild(e.target.value); }}
                  className="mt-1 w-full px-2 py-1 text-xs border rounded-lg">
                  <option value="">하위 목표 선택...</option>
                  {unmappedChildren.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              )}
            </div>
          ) : null}

          {/* OrgWorkLog (조직 업무 기록 요약) */}
          {goal.orgWorkLogs && goal.orgWorkLogs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">업무 요약 ({goal.orgWorkLogs.length}일)</h4>
              {goal.orgWorkLogs.map(owl => (
                <div key={owl.id} className="py-1.5 px-2 rounded hover:bg-gray-50">
                  <span className="text-xs text-gray-400">{owl.date.split('T')[0]}</span>
                  <p className="text-sm text-gray-600">{owl.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* 연결된 업무기록 (파트원별 그룹핑) */}
          {goal.linkedWorkLogs && goal.linkedWorkLogs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">연결된 업무기록 ({goal.linkedWorkLogs.length})</h4>
              {(() => {
                const byUser: Record<string, typeof goal.linkedWorkLogs> = {};
                for (const wl of goal.linkedWorkLogs!) {
                  const name = wl.user?.username || '(미지정)';
                  if (!byUser[name]) byUser[name] = [];
                  byUser[name]!.push(wl);
                }
                return Object.entries(byUser).map(([name, wls]) => (
                  <div key={name} className="mb-2">
                    {Object.keys(byUser).length > 1 && (
                      <p className="text-xs font-medium text-primary-600 px-2 mb-0.5">{name}</p>
                    )}
                    {wls!.map(wl => (
                      <div key={wl.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50">
                        <span className="text-sm text-gray-600 truncate">
                          {wl.date && <span className="text-xs text-gray-400 mr-1">{wl.date.split('T')[0]}</span>}
                          {wl.title}
                        </span>
                        {canEdit && (
                          <button onClick={() => handleUnlinkWorkLog(wl.id)}
                            className="text-xs text-red-400 hover:text-red-600 ml-2 flex-shrink-0">해제</button>
                        )}
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          )}

          {/* 연결된 할일 (파트원별 그룹핑) */}
          {goal.linkedTodos && goal.linkedTodos.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-1">연결된 할일 ({goal.linkedTodos.length})</h4>
              {(() => {
                const byUser: Record<string, typeof goal.linkedTodos> = {};
                for (const todo of goal.linkedTodos!) {
                  const name = todo.user?.username || '(미지정)';
                  if (!byUser[name]) byUser[name] = [];
                  byUser[name]!.push(todo);
                }
                return Object.entries(byUser).map(([name, todos]) => (
                  <div key={name} className="mb-2">
                    {Object.keys(byUser).length > 1 && (
                      <p className="text-xs font-medium text-primary-600 px-2 mb-0.5">{name}</p>
                    )}
                    {todos!.map(todo => (
                      <div key={todo.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50">
                        <span className={`text-sm truncate ${todo.completed ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
                          {todo.title}
                        </span>
                        {canEdit && (
                          <button onClick={() => handleUnlinkTodo(todo.id)}
                            className="text-xs text-red-400 hover:text-red-600 ml-2 flex-shrink-0">해제</button>
                        )}
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          )}

          {/* 삭제 */}
          {canEdit && (
            <div className="pt-2 border-t border-gray-100">
              <button onClick={async () => {
                if (!confirm('이 목표를 삭제하시겠습니까?')) return;
                try { await goalsApi.delete(goal.id); onUpdate?.(); } catch {}
              }} className="text-xs text-red-500 hover:text-red-700">목표 삭제</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
