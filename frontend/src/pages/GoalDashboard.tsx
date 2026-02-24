/**
 * GoalDashboard - 태그별 진행률 + Gantt 차트
 */
import { useState, useEffect } from 'react';
import { goalsApi } from '../services/api';
import TagProgressView from '../components/chart/TagProgressView';
import GanttChart from '../components/chart/GanttChart';
import GoalCard from '../components/goal/GoalCard';

export default function GoalDashboard() {
  const [activeTab, setActiveTab] = useState<'tags' | 'gantt'>('tags');
  const [dashData, setDashData] = useState<any>(null);
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    goalsApi.getDashboard()
      .then(res => setDashData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  const tagProgress = dashData?.tagProgress || [];
  const goals = dashData?.goals || [];

  // Gantt용 아이템 변환
  const ganttItems = goals
    .filter((g: any) => g.startDate && g.endDate)
    .filter((g: any) => !selectedTag || g.tags?.some((t: any) => t.name === selectedTag))
    .map((g: any) => ({
      id: g.id,
      title: g.title,
      startDate: g.startDate,
      endDate: g.endDate,
      completed: g.status === 'COMPLETED',
      progress: g.progress,
    }));

  // 태그 필터링된 목표
  const filteredGoals = selectedTag
    ? goals.filter((g: any) => g.tags?.some((t: any) => t.name === selectedTag))
    : goals;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">목표 대시보드</h1>
      <p className="text-sm text-gray-500 mb-4">태그별 진행률과 일정을 한눈에 확인합니다</p>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button onClick={() => setActiveTab('tags')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'tags' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          태그별 진행률
        </button>
        <button onClick={() => setActiveTab('gantt')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'gantt' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          Gantt 차트
        </button>
      </div>

      {/* 선택된 태그 필터 표시 */}
      {selectedTag && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-primary-50 rounded-lg">
          <span className="text-sm text-primary-700">필터: {selectedTag}</span>
          <button onClick={() => setSelectedTag('')} className="text-xs text-primary-500 hover:text-primary-700">
            해제
          </button>
        </div>
      )}

      {activeTab === 'tags' && (
        <div className="space-y-6">
          <TagProgressView tags={tagProgress} onTagClick={setSelectedTag} selectedTag={selectedTag} />

          {/* 필터된 목표 목록 */}
          {filteredGoals.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-3">
                {selectedTag ? `${selectedTag} 목표` : '전체 목표'} ({filteredGoals.length})
              </h2>
              <div className="space-y-3">
                {filteredGoals.map((goal: any) => (
                  <GoalCard key={goal.id} goal={goal} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'gantt' && (
        <GanttChart items={ganttItems} />
      )}
    </div>
  );
}
