/**
 * BU Space Page - 사업부 목표 + 하위 팀 진행률
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, goalsApi } from '../services/api';
import GoalCard from '../components/goal/GoalCard';
import GoalInputForm from '../components/goal/GoalInputForm';
import ProgressBar from '../components/common/ProgressBar';

export default function BUSpace() {
  const { buId } = useParams<{ buId: string }>();
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [teamGoals, setTeamGoals] = useState<Record<string, any[]>>({});

  const fetchData = async () => {
    if (!buId) return;
    try {
      const res = await spacesApi.getBU(buId);
      setData(res.data);

      // 하위 팀별 목표 조회
      const teams = res.data.bu?.teams || [];
      const tGoalMap: Record<string, any[]> = {};
      await Promise.all(teams.map(async (team: any) => {
        try {
          const r = await goalsApi.getAll({ level: 'TEAM', ownerId: team.id });
          tGoalMap[team.id] = r.data.goals || [];
        } catch { tGoalMap[team.id] = []; }
      }));
      setTeamGoals(tGoalMap);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [buId]);

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  if (!data?.bu) return <div className="text-center py-12 text-gray-400">사업부를 찾을 수 없습니다</div>;

  const goals = data.goals || [];
  const childOrgNames: Record<string, string> = data.childOrgNames || {};

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{data.bu.name}</h1>
      <p className="text-sm text-gray-500 mb-4">사업부</p>

      {/* BU 목표 입력 (SuperAdmin만) */}
      {isSuperAdmin && buId && (
        <GoalInputForm level="BU" ownerId={buId} onCreated={fetchData} />
      )}

      {/* BU 목표 */}
      {goals.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">사업부 목표 ({goals.length})</h2>
          <div className="space-y-3">
            {goals.map((goal: any) => (
              <GoalCard key={goal.id} goal={goal} canEdit={isSuperAdmin} onUpdate={fetchData} childOrgNames={childOrgNames} />
            ))}
          </div>
        </div>
      )}

      {/* 하위 팀별 목표 진행률 */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">팀별 목표</h2>
        {(data.bu.teams || []).map((team: any) => {
          const tGoals = teamGoals[team.id] || [];
          const avgProgress = tGoals.length > 0
            ? Math.round(tGoals.reduce((s: number, g: any) => s + g.progress, 0) / tGoals.length)
            : 0;
          return (
            <div key={team.id}
              className="bg-white rounded-xl border border-gray-200 p-4 mb-3 cursor-pointer hover:shadow-sm transition-shadow"
              onClick={() => navigate('/space/team')}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-800">{team.name}</span>
                <span className="text-xs text-gray-400">{tGoals.length}개 목표</span>
              </div>
              <ProgressBar progress={avgProgress} size="md" />
              {tGoals.length > 0 && (
                <div className="mt-2 space-y-1">
                  {tGoals.slice(0, 3).map((g: any) => (
                    <GoalCard key={g.id} goal={g} compact />
                  ))}
                  {tGoals.length > 3 && (
                    <p className="text-xs text-gray-400 px-1">+{tGoals.length - 3}개 더</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
