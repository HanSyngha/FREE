/**
 * Group Space Page - 그룹 목표 + 하위 파트 진행률
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, reportsApi, goalsApi } from '../services/api';
import GoalCard from '../components/goal/GoalCard';
import GoalInputForm from '../components/goal/GoalInputForm';
import ProgressBar from '../components/common/ProgressBar';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateWithDay(iso: string) {
  const dateStr = iso.split('T')[0]!;
  const d = new Date(dateStr + 'T00:00:00');
  return `${dateStr}(${DAYS[d.getDay()]})`;
}

export default function GroupSpace() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user, isSuperAdmin, isTeamAdmin } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [partGoals, setPartGoals] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [showOlderReports, setShowOlderReports] = useState(false);
  const [activeTab, setActiveTab] = useState<'goals' | 'records'>('goals');

  const isGroupAdmin = isSuperAdmin || isTeamAdmin || user?.groupId === groupId;

  const fetchData = async () => {
    if (!groupId) return;
    try {
      const [spaceRes, goalsRes] = await Promise.all([
        spacesApi.getGroup(groupId),
        goalsApi.getAll({ level: 'GROUP', ownerId: groupId }),
      ]);
      setData(spaceRes.data);
      setGoals(goalsRes.data.goals || []);

      // 하위 파트별 목표 가져오기
      const parts = spaceRes.data.parts || [];
      const partGoalMap: Record<string, any[]> = {};
      await Promise.all(parts.map(async (part: any) => {
        try {
          const res = await goalsApi.getAll({ level: 'PART', ownerId: part.id });
          partGoalMap[part.id] = res.data.goals || [];
        } catch { partGoalMap[part.id] = []; }
      }));
      setPartGoals(partGoalMap);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [groupId]);

  const handleExport = async (reportId: string, format: 'docx' | 'xlsx') => {
    try {
      const res = await reportsApi.export(reportId, format);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data?.group?.name || '그룹'}_보고서.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {}
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  if (!data) return <div className="text-center py-12 text-gray-400">그룹을 찾을 수 없습니다</div>;

  // workLogs 그룹핑
  const items = data.workLogs || data.items || [];
  const groupedByDate: Record<string, Record<string, any[]>> = {};
  const partMap = new Map<string, string>();
  data.parts?.forEach((p: any) => { partMap.set(p.id, p.name); });

  items.forEach((item: any) => {
    const d = item.date.split('T')[0];
    const partName = item.user?.partId ? (partMap.get(item.user.partId) || 'Unknown') : 'Unknown';
    if (!groupedByDate[d]) groupedByDate[d] = {};
    if (!groupedByDate[d]![partName]) groupedByDate[d]![partName] = [];
    groupedByDate[d]![partName]!.push(item);
  });
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{data.group?.name}</h1>
      <p className="text-sm text-gray-500 mb-4">{data.parts?.length || 0}개 파트</p>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button onClick={() => setActiveTab('goals')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'goals' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          목표
        </button>
        <button onClick={() => setActiveTab('records')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'records' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          업무 기록
        </button>
      </div>

      {activeTab === 'goals' && (
        <>
          {/* 그룹 목표 입력 */}
          {isGroupAdmin && groupId && (
            <GoalInputForm level="GROUP" ownerId={groupId} onCreated={fetchData} />
          )}

          {/* 그룹 목표 */}
          {goals.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 mb-3">그룹 목표</h2>
              <div className="space-y-3">
                {goals.map((goal: any) => (
                  <GoalCard key={goal.id} goal={goal} />
                ))}
              </div>
            </div>
          )}

          {/* 하위 파트별 목표 진행률 */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-3">파트별 목표</h2>
            {(data.parts || []).map((part: any) => {
              const pGoals = partGoals[part.id] || [];
              const avgProgress = pGoals.length > 0
                ? Math.round(pGoals.reduce((s: number, g: any) => s + g.progress, 0) / pGoals.length)
                : 0;
              return (
                <div key={part.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 mb-3 cursor-pointer hover:shadow-sm transition-shadow"
                  onClick={() => navigate(`/space/part/${part.id}`)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-800">{part.name}</span>
                    <span className="text-xs text-gray-400">{pGoals.length}개 목표</span>
                  </div>
                  <ProgressBar progress={avgProgress} size="md" />
                  {pGoals.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {pGoals.slice(0, 3).map((g: any) => (
                        <GoalCard key={g.id} goal={g} compact />
                      ))}
                      {pGoals.length > 3 && (
                        <p className="text-xs text-gray-400 px-1">+{pGoals.length - 3}개 더</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'records' && (
        <>
          {/* 보고서 */}
          {data.reports?.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 mb-3">주간 보고서</h2>
              {(() => {
                const latest = data.reports[0];
                const older = data.reports.slice(1);
                return (
                  <>
                    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
                      <div className="flex items-center justify-between mb-2">
                        <span onClick={() => navigate(`/report/${latest.id}`)}
                          className="text-sm font-medium text-primary-600 hover:underline cursor-pointer">
                          {data.group?.name} 보고서 {formatDateWithDay(latest.periodStart)} ~ {formatDateWithDay(latest.periodEnd)}
                        </span>
                        <div className="flex gap-2">
                          <button onClick={() => handleExport(latest.id, 'docx')}
                            className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100">DOCX</button>
                          <button onClick={() => handleExport(latest.id, 'xlsx')}
                            className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-md hover:bg-green-100">XLSX</button>
                        </div>
                      </div>
                    </div>
                    {older.length > 0 && (
                      <>
                        <button onClick={() => setShowOlderReports(!showOlderReports)}
                          className="text-xs text-gray-400 hover:text-gray-600 mb-2 flex items-center gap-1">
                          <svg className={`w-3 h-3 transition-transform ${showOlderReports ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                          이전 보고서 ({older.length})
                        </button>
                        {showOlderReports && older.map((report: any) => (
                          <div key={report.id} className="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-2">
                            <span onClick={() => navigate(`/report/${report.id}`)}
                              className="text-sm font-medium text-gray-500 hover:text-primary-600 hover:underline cursor-pointer">
                              {data.group?.name} 보고서 {formatDateWithDay(report.periodStart)} ~ {formatDateWithDay(report.periodEnd)}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* WorkLog 목록 */}
          {sortedDates.length === 0 ? (
            <div className="text-center py-12 text-gray-400">등록된 업무 기록이 없습니다</div>
          ) : (
            sortedDates.map(dateKey => (
              <div key={dateKey} className="mb-6">
                <h2 className="text-sm font-semibold text-gray-500 mb-3">{dateKey}</h2>
                {Object.entries(groupedByDate[dateKey]!).map(([partName, partItems]) => (
                  <div key={partName} className="mb-3">
                    <h3 className="text-xs font-medium text-gray-600 mb-2 px-1 cursor-pointer hover:text-primary-600"
                      onClick={() => {
                        const part = data.parts?.find((p: any) => p.name === partName);
                        if (part) navigate(`/space/part/${part.id}`);
                      }}>
                      {partName}
                    </h3>
                    <div className="space-y-1">
                      {(partItems as any[]).map((item: any) => (
                        <div key={item.id} className="px-3 py-2 bg-white rounded-lg border border-gray-100 cursor-pointer hover:border-primary-200 transition-colors"
                          onClick={() => {
                            const part = data.parts?.find((p: any) => p.name === partName);
                            if (part) navigate(`/space/part/${part.id}`);
                          }}>
                          <span className="text-sm text-gray-700">{item.title}</span>
                          <span className="text-xs text-gray-400 ml-2">{item.user?.username}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
