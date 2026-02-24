/**
 * Part Space Page - 파트 목표 + 파트원 업무 기록 (2컬럼 대시보드)
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, reportsApi, goalsApi, orgApi } from '../services/api';
import GoalCard from '../components/goal/GoalCard';
import GoalInputForm from '../components/goal/GoalInputForm';
import OrgChart from '../components/common/OrgChart';
import type { OrgNode } from '../components/common/OrgChart';
import DashboardGrid from '../components/spaces/DashboardGrid';
import DashboardSection from '../components/spaces/DashboardSection';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateWithDay(iso: string) {
  const dateStr = iso.split('T')[0]!;
  const d = new Date(dateStr + 'T00:00:00');
  return `${dateStr}(${DAYS[d.getDay()]})`;
}

export default function PartSpace() {
  const { partId } = useParams();
  const navigate = useNavigate();
  const { user, isSuperAdmin, isTeamAdmin } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [groupGoals, setGroupGoals] = useState<Array<{ id: string; title: string }>>([]);
  const [orgTree, setOrgTree] = useState<OrgNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOlderReports, setShowOlderReports] = useState(false);
  const [showAllGoals, setShowAllGoals] = useState(false);
  const [showAllDates, setShowAllDates] = useState(false);

  const GOAL_LIMIT = 5;
  const DATE_LIMIT = 2;

  const isPartAdmin = isSuperAdmin || isTeamAdmin || user?.partId === partId;

  const fetchData = async () => {
    if (!partId) return;
    try {
      const [spaceRes, goalsRes] = await Promise.all([
        spacesApi.getPart(partId),
        goalsApi.getAll({ level: 'PART', ownerId: partId }),
      ]);
      setData(spaceRes.data);
      setGoals(goalsRes.data.goals || []);

      const gId = spaceRes.data.part?.groupId;
      if (gId) {
        try {
          const gRes = await goalsApi.getAll({ level: 'GROUP', ownerId: gId });
          setGroupGoals((gRes.data.goals || []).map((g: any) => ({ id: g.id, title: g.title })));
        } catch { setGroupGoals([]); }
      }

      // 조직도
      const tId = spaceRes.data.part?.group?.teamId || spaceRes.data.teamId;
      if (tId) {
        try { const treeRes = await orgApi.getTree(tId); setOrgTree(treeRes.data.tree); } catch {}
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [partId]);

  const handleExport = async (reportId: string, format: 'docx' | 'xlsx') => {
    try {
      const res = await reportsApi.export(reportId, format);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data?.part?.name || '파트'}_보고서.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {}
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  if (!data) return <div className="text-center py-12 text-gray-400">파트를 찾을 수 없습니다</div>;

  // workLogs 그룹핑 (날짜별 → 개인별)
  const items = data.workLogs || data.items || [];
  const groupedByDate: Record<string, Record<string, any[]>> = {};
  items.forEach((item: any) => {
    const d = item.date.split('T')[0];
    const userName = item.user?.username || 'Unknown';
    if (!groupedByDate[d]) groupedByDate[d] = {};
    if (!groupedByDate[d]![userName]) groupedByDate[d]![userName] = [];
    groupedByDate[d]![userName]!.push(item);
  });
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  const visibleGoals = showAllGoals ? goals : goals.slice(0, GOAL_LIMIT);
  const hasMoreGoals = goals.length > GOAL_LIMIT;
  const visibleDates = showAllDates ? sortedDates : sortedDates.slice(0, DATE_LIMIT);
  const hasMoreDates = sortedDates.length > DATE_LIMIT;

  const reports = data.reports || [];
  const latestReport = reports[0];
  const olderReports = reports.slice(1);

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{data.part?.name}</h1>
      <p className="text-sm text-gray-500 mb-4">{data.users?.length || 0}명</p>

      <DashboardGrid
        top={isPartAdmin && partId ? (
          <GoalInputForm level="PART" ownerId={partId} onCreated={fetchData} />
        ) : undefined}
        left={
          <DashboardSection
            title="파트 목표"
            count={goals.length}
            colorBar="blue"
            isEmpty={goals.length === 0}
            emptyText="등록된 목표가 없습니다"
            headerRight={hasMoreGoals ? (
              <button onClick={() => setShowAllGoals(!showAllGoals)}
                className="text-xs text-primary-600 hover:text-primary-700">
                {showAllGoals ? '접기' : `전체 보기 (${goals.length})`}
              </button>
            ) : undefined}
          >
            <div className="space-y-3">
              {visibleGoals.map((goal: any) => (
                <GoalCard key={goal.id} goal={goal} canEdit={isPartAdmin} defaultExpanded={false}
                  onUpdate={fetchData} parentCandidates={groupGoals} />
              ))}
            </div>
          </DashboardSection>
        }
        right={
          <>
            {orgTree && (
              <DashboardSection title="조직도" colorBar="blue">
                <OrgChart root={orgTree} currentId={partId} />
              </DashboardSection>
            )}
            <DashboardSection
              title="업무 기록"
              colorBar="green"
              isEmpty={sortedDates.length === 0}
              emptyText="등록된 업무 기록이 없습니다"
              headerRight={hasMoreDates ? (
                <button onClick={() => setShowAllDates(!showAllDates)}
                  className="text-xs text-primary-600 hover:text-primary-700">
                  {showAllDates ? '접기' : `전체 보기 (${sortedDates.length}일)`}
                </button>
              ) : undefined}
            >
            {visibleDates.map(dateKey => (
              <div key={dateKey} className="mb-4 last:mb-0">
                <h3 className="text-xs font-semibold text-gray-500 mb-2">{dateKey}</h3>
                {Object.entries(groupedByDate[dateKey]!).map(([userName, userItems]) => (
                  <div key={userName} className="mb-2 last:mb-0">
                    <h4 className="text-xs font-medium text-gray-600 mb-1 cursor-pointer hover:text-primary-600"
                      onClick={() => {
                        const userItem = (userItems as any[])[0];
                        if (userItem?.user?.id) navigate(`/space/personal/${userItem.user.id}`);
                      }}>
                      {userName}
                    </h4>
                    <div className="space-y-1">
                      {(userItems as any[]).map((item: any) => (
                        <div key={item.id}
                          className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 hover:border-primary-200 hover:bg-primary-50/30 cursor-pointer transition-colors"
                          onClick={() => navigate(`/space/personal/${item.user?.id}/${dateKey}`)}
                        >
                          <span className="text-sm text-gray-700">{item.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </DashboardSection>
          </>
        }
        bottom={
          reports.length > 0 ? (
            <DashboardSection title="주간 보고서" count={reports.length} colorBar="purple">
              <div className="bg-gray-50 rounded-lg border border-gray-100 p-3 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span onClick={() => navigate(`/report/${latestReport.id}`)}
                    className="text-sm font-medium text-primary-600 hover:underline cursor-pointer">
                    {data.part?.name} 보고서 {formatDateWithDay(latestReport.periodStart)} ~ {formatDateWithDay(latestReport.periodEnd)}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => handleExport(latestReport.id, 'docx')}
                      className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100">DOCX</button>
                    <button onClick={() => handleExport(latestReport.id, 'xlsx')}
                      className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-md hover:bg-green-100">XLSX</button>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>생성: {new Date(latestReport.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
                  <span>자동 삭제: {new Date(latestReport.expiresAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
                </div>
              </div>
              {olderReports.length > 0 && (
                <>
                  <button onClick={() => setShowOlderReports(!showOlderReports)}
                    className="text-xs text-gray-400 hover:text-gray-600 mb-2 flex items-center gap-1">
                    <svg className={`w-3 h-3 transition-transform ${showOlderReports ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    이전 보고서 ({olderReports.length})
                  </button>
                  {showOlderReports && olderReports.map((report: any) => (
                    <div key={report.id} className="bg-gray-50 rounded-lg border border-gray-100 p-3 mb-2">
                      <div className="flex items-center justify-between">
                        <span onClick={() => navigate(`/report/${report.id}`)}
                          className="text-sm font-medium text-gray-500 hover:text-primary-600 hover:underline cursor-pointer">
                          {data.part?.name} 보고서 {formatDateWithDay(report.periodStart)} ~ {formatDateWithDay(report.periodEnd)}
                        </span>
                        <div className="flex gap-2">
                          <button onClick={() => handleExport(report.id, 'docx')}
                            className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100">DOCX</button>
                          <button onClick={() => handleExport(report.id, 'xlsx')}
                            className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-md hover:bg-green-100">XLSX</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </DashboardSection>
          ) : undefined
        }
      />
    </div>
  );
}
