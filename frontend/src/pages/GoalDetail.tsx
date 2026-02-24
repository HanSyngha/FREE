/**
 * GoalDetail - 목표 상세 페이지
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { goalsApi } from '../services/api';
import GoalCard from '../components/goal/GoalCard';
import ProgressBar from '../components/common/ProgressBar';
import TagBadge from '../components/common/TagBadge';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PLANNED: { label: '예정', color: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: '진행중', color: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: '완료', color: 'bg-green-100 text-green-700' },
};

export default function GoalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [goal, setGoal] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    goalsApi.getById(id)
      .then(res => setGoal(res.data.goal))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!goal) {
    return <div className="text-center py-12 text-gray-400">목표를 찾을 수 없습니다</div>;
  }

  const status = STATUS_LABELS[goal.status] || STATUS_LABELS.PLANNED;
  const tags = goal.itemTags?.map((it: any) => it.tag.name) || [];

  return (
    <div className="max-w-3xl mx-auto">
      {/* 뒤로가기 */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        뒤로가기
      </button>

      {/* 상위 목표 브레드크럼 */}
      {goal.parentItem && (
        <button
          onClick={() => navigate(`/goals/${goal.parentItem.id}`)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary-600 mb-2"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
          </svg>
          상위: {goal.parentItem.title}
        </button>
      )}

      {/* 제목 + 상태 + 진행률 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <div className="flex items-start justify-between mb-3">
          <h1 className="text-lg font-bold text-gray-900 flex-1">{goal.title}</h1>
          <span className={`text-xs px-2.5 py-1 rounded-full ${status.color} ml-3 flex-shrink-0`}>
            {status.label}
          </span>
        </div>

        <div className="mb-3">
          <ProgressBar progress={goal.progress} size="md" />
        </div>

        {/* 태그 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {tags.map((tag: string) => <TagBadge key={tag} name={tag} />)}
          </div>
        )}

        {/* 기간 */}
        {(goal.startDate || goal.endDate) && (
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            {goal.startDate && <span>{goal.startDate.split('T')[0]}</span>}
            {goal.startDate && goal.endDate && <span>~</span>}
            {goal.endDate && <span>{goal.endDate.split('T')[0]}</span>}
          </div>
        )}

        {/* 설명 */}
        {goal.content && (
          <div className="mb-3">
            <h3 className="text-xs font-semibold text-gray-500 mb-1">설명</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{goal.content}</p>
          </div>
        )}

        {/* 진척사항 */}
        {goal.summary && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 mb-1">진척사항</h3>
            <p className="text-sm text-gray-700">{goal.summary}</p>
          </div>
        )}
      </div>

      {/* 하위 목표 */}
      {goal.childItems?.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">하위 목표 ({goal.childItems.length})</h2>
          <div className="space-y-2">
            {goal.childItems.map((child: any) => (
              <GoalCard
                key={child.id}
                goal={child}
                compact
                onClick={() => navigate(`/goals/${child.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 연결된 업무 기록 */}
      {goal.linkedWorkLogs?.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">연결된 업무 기록 ({goal.linkedWorkLogs.length})</h2>
          <div className="space-y-1">
            {goal.linkedWorkLogs.map((wl: any) => (
              <div key={wl.id} className="px-3 py-2 bg-white rounded-lg border border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{wl.title}</span>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>{wl.user?.username}</span>
                    <span>{wl.date?.split('T')[0]}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 연결된 할일 */}
      {goal.linkedTodos?.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">연결된 할일 ({goal.linkedTodos.length})</h2>
          <div className="space-y-1">
            {goal.linkedTodos.map((todo: any) => (
              <div key={todo.id} className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-100">
                {todo.completed ? (
                  <svg className="w-4 h-4 text-green-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <div className="w-4 h-4 rounded border-2 border-gray-300 flex-shrink-0" />
                )}
                <span className={`text-sm flex-1 ${todo.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                  {todo.title}
                </span>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{todo.user?.username}</span>
                  {todo.endDate && <span>{todo.endDate.split('T')[0]}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
