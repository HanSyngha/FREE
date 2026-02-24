/**
 * Team Space Page - 팀 목표 + 하위 그룹 진행률 (2컬럼 대시보드)
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, reportsApi, announcementsApi, goalsApi, adminApi } from '../services/api';
import GoalCard from '../components/goal/GoalCard';
import GoalInputForm from '../components/goal/GoalInputForm';
import ProgressBar from '../components/common/ProgressBar';
import DashboardGrid from '../components/spaces/DashboardGrid';
import DashboardSection from '../components/spaces/DashboardSection';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatDateWithDay(iso: string) {
  const dateStr = iso.split('T')[0]!;
  const d = new Date(dateStr + 'T00:00:00');
  return `${dateStr}(${DAYS[d.getDay()]})`;
}

export default function TeamSpace() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, isTeamAdmin } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [groupGoals, setGroupGoals] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [showOlderReports, setShowOlderReports] = useState(false);
  const [showAllGoals, setShowAllGoals] = useState(false);
  const [showAllDates, setShowAllDates] = useState(false);

  // Announcement
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annSaving, setAnnSaving] = useState(false);

  // Manual trigger
  const [triggeringReport, setTriggeringReport] = useState(false);
  const [triggeringProgress, setTriggeringProgress] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [buGoals, setBuGoals] = useState<Array<{ id: string; title: string }>>([]);

  const GOAL_LIMIT = 5;
  const DATE_LIMIT = 2;

  const isTeamLevel = isSuperAdmin || isTeamAdmin;

  const fetchData = async () => {
    try {
      const spaceRes = await spacesApi.getTeam();
      setData(spaceRes.data);

      const teamId = spaceRes.data.team?.id;
      const buId = spaceRes.data.team?.businessUnit?.id;
      if (buId) {
        try {
          const buRes = await goalsApi.getAll({ level: 'BU', ownerId: buId });
          setBuGoals((buRes.data.goals || []).map((g: any) => ({ id: g.id, title: g.title })));
        } catch { setBuGoals([]); }
      }
      if (teamId) {
        const goalsRes = await goalsApi.getAll({ level: 'TEAM', ownerId: teamId });
        setGoals(goalsRes.data.goals || []);

        const groups = spaceRes.data.team?.groups || [];
        const gGoalMap: Record<string, any[]> = {};
        await Promise.all(groups.map(async (group: any) => {
          try {
            const res = await goalsApi.getAll({ level: 'GROUP', ownerId: group.id });
            gGoalMap[group.id] = res.data.goals || [];
          } catch { gGoalMap[group.id] = []; }
        }));
        setGroupGoals(gGoalMap);
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleExport = async (reportId: string, format: 'docx' | 'xlsx') => {
    try {
      const res = await reportsApi.export(reportId, format);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data?.team?.name || '팀'}_보고서.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {}
  };

  const handleResume = async () => {
    setResuming(true);
    try {
      await reportsApi.resume();
      alert('보고서 생성을 재개합니다.');
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || '재개에 실패했습니다.');
    } finally {
      setResuming(false);
    }
  };

  const handleEditAnnouncement = () => {
    setAnnTitle(data?.announcement?.title || '');
    setAnnContent(data?.announcement?.content || '');
    setShowAnnouncementForm(true);
  };

  const handleSaveAnnouncement = async () => {
    if (!annTitle.trim() || !annContent.trim()) return;
    setAnnSaving(true);
    try {
      await announcementsApi.create(annTitle, annContent);
      setShowAnnouncementForm(false);
      fetchData();
    } catch { alert('공지 저장에 실패했습니다.'); }
    finally { setAnnSaving(false); }
  };

  const handleDeleteAnnouncement = async () => {
    if (!confirm('공지를 삭제하시겠습니까?')) return;
    try {
      await announcementsApi.delete();
      fetchData();
    } catch { alert('공지 삭제에 실패했습니다.'); }
  };

  const handleTriggerReport = async () => {
    if (!data?.team?.id) return;
    if (!confirm('보고서를 수동 생성하시겠습니까?')) return;
    setTriggeringReport(true);
    setTriggerMsg(null);
    try {
      const res = await adminApi.triggerReport(data.team.id);
      setTriggerMsg({ type: 'success', text: res.data.message });
    } catch (err: any) {
      setTriggerMsg({ type: 'error', text: err.response?.data?.error || '보고서 생성 트리거에 실패했습니다.' });
    } finally { setTriggeringReport(false); }
  };

  const handleTriggerProgress = async () => {
    if (!data?.team?.id) return;
    if (!confirm('진행률을 수동 업데이트하시겠습니까?')) return;
    setTriggeringProgress(true);
    setTriggerMsg(null);
    try {
      const res = await adminApi.triggerProgress(data.team.id);
      setTriggerMsg({ type: 'success', text: res.data.message });
    } catch (err: any) {
      setTriggerMsg({ type: 'error', text: err.response?.data?.error || '진행률 업데이트 트리거에 실패했습니다.' });
    } finally { setTriggeringProgress(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;
  if (!data) return <div className="text-center py-12 text-gray-400">팀을 찾을 수 없습니다</div>;

  // workLogs 그룹핑
  const items = data.workLogs || data.items || [];
  const groupedByDate: Record<string, Record<string, any[]>> = {};
  items.forEach((item: any) => {
    const d = item.date.split('T')[0];
    const groupName = item.user?.group?.name || 'Unknown';
    if (!groupedByDate[d]) groupedByDate[d] = {};
    if (!groupedByDate[d]![groupName]) groupedByDate[d]![groupName] = [];
    groupedByDate[d]![groupName]!.push(item);
  });
  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  const visibleGoals = showAllGoals ? goals : goals.slice(0, GOAL_LIMIT);
  const hasMoreGoals = goals.length > GOAL_LIMIT;
  const visibleDates = showAllDates ? sortedDates : sortedDates.slice(0, DATE_LIMIT);
  const hasMoreDates = sortedDates.length > DATE_LIMIT;

  const reports = data.reports || [];
  const latestReport = reports[0];
  const olderReports = reports.slice(1);

  // 상단 영역: 공지 + 관리패널 + 목표입력 + 실패보고서
  const topContent = (
    <>
      {/* 공지 */}
      {data.announcement && !showAnnouncementForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-sm font-bold text-blue-800 mb-1">{data.announcement.title}</h3>
              <p className="text-sm text-blue-700">{data.announcement.content}</p>
              <p className="text-xs text-blue-500 mt-2">
                {data.announcement.author?.username} | {new Date(data.announcement.updatedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
              </p>
            </div>
            {isTeamLevel && (
              <div className="flex gap-1 ml-2">
                <button onClick={handleEditAnnouncement} className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-100 rounded">수정</button>
                <button onClick={handleDeleteAnnouncement} className="text-xs px-2 py-1 text-red-500 hover:bg-red-100 rounded">삭제</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isTeamLevel && showAnnouncementForm && (
        <div className="bg-white border border-blue-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">{data.announcement ? '공지 수정' : '새 공지 작성'}</h3>
          <input value={annTitle} onChange={(e) => setAnnTitle(e.target.value)}
            placeholder="공지 제목" className="w-full px-3 py-2 border rounded-lg text-sm mb-2" />
          <textarea value={annContent} onChange={(e) => setAnnContent(e.target.value)}
            placeholder="공지 내용" className="w-full px-3 py-2 border rounded-lg text-sm h-20 resize-y mb-3" />
          <div className="flex gap-2">
            <button onClick={handleSaveAnnouncement} disabled={annSaving || !annTitle.trim() || !annContent.trim()}
              className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg disabled:opacity-50">
              {annSaving ? '저장 중...' : '저장'}
            </button>
            <button onClick={() => setShowAnnouncementForm(false)}
              className="px-4 py-2 bg-gray-200 text-gray-600 text-sm rounded-lg">취소</button>
          </div>
        </div>
      )}

      {isTeamLevel && !data.announcement && !showAnnouncementForm && (
        <button onClick={() => { setAnnTitle(''); setAnnContent(''); setShowAnnouncementForm(true); }}
          className="text-sm text-primary-600 hover:underline">+ 팀 공지 작성</button>
      )}

      {/* 관리 패널 */}
      {isTeamLevel && (
        <DashboardSection title="관리 패널" colorBar="orange">
          <div className="flex flex-wrap gap-2">
            <button onClick={handleTriggerReport} disabled={triggeringReport}
              className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-primary-700 transition-colors">
              {triggeringReport ? '생성 중...' : '보고서 수동 생성'}
            </button>
            <button onClick={handleTriggerProgress} disabled={triggeringProgress}
              className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors">
              {triggeringProgress ? '업데이트 중...' : '진행률 수동 업데이트'}
            </button>
          </div>
          {triggerMsg && (
            <div className={`mt-2 p-2 rounded-lg text-xs ${
              triggerMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}>{triggerMsg.text}</div>
          )}
        </DashboardSection>
      )}

      {/* 실패한 보고서 재개 */}
      {data.failedJob && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-800">보고서 생성이 실패했습니다</p>
              <p className="text-xs text-red-600 mt-1">{data.failedJob.lastError}</p>
            </div>
            <button onClick={handleResume} disabled={resuming}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50">
              {resuming ? '재개 중...' : '계속해서 생성하기'}
            </button>
          </div>
        </div>
      )}

      {/* 팀 목표 입력 */}
      {isTeamLevel && data.team?.id && (
        <GoalInputForm level="TEAM" ownerId={data.team.id} onCreated={fetchData} />
      )}
    </>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{data.team?.name}</h1>
      <p className="text-sm text-gray-500 mb-4">{data.team?.businessUnit?.name}</p>

      <DashboardGrid
        top={topContent}
        left={
          <>
            <DashboardSection
              title="팀 목표"
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
                  <GoalCard key={goal.id} goal={goal} canEdit={isTeamLevel} defaultExpanded={false}
                    onUpdate={fetchData} parentCandidates={buGoals} />
                ))}
              </div>
            </DashboardSection>

            {/* 그룹별 목표 */}
            <DashboardSection
              title="그룹별 목표"
              count={(data.team?.groups || []).length}
              colorBar="blue"
              isEmpty={(data.team?.groups || []).length === 0}
              emptyText="하위 그룹이 없습니다"
            >
              <div className="space-y-3">
                {(data.team?.groups || []).map((group: any) => {
                  const gGoals = groupGoals[group.id] || [];
                  const avgProgress = gGoals.length > 0
                    ? Math.round(gGoals.reduce((s: number, g: any) => s + g.progress, 0) / gGoals.length)
                    : 0;
                  return (
                    <div key={group.id}
                      className="bg-gray-50 rounded-lg border border-gray-100 p-3 cursor-pointer hover:shadow-sm transition-shadow"
                      onClick={() => navigate(`/space/group/${group.id}`)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-800">{group.name}</span>
                        <span className="text-xs text-gray-400">{gGoals.length}개 목표</span>
                      </div>
                      <ProgressBar progress={avgProgress} size="md" />
                      {gGoals.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {gGoals.slice(0, 3).map((g: any) => (
                            <GoalCard key={g.id} goal={g} compact />
                          ))}
                          {gGoals.length > 3 && (
                            <p className="text-xs text-gray-400 px-1">+{gGoals.length - 3}개 더</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </DashboardSection>
          </>
        }
        right={
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
                {Object.entries(groupedByDate[dateKey]!).map(([groupName, groupItems]) => (
                  <div key={groupName} className="mb-2 last:mb-0">
                    <h4 className="text-xs font-medium text-gray-600 mb-1 cursor-pointer hover:text-primary-600"
                      onClick={() => {
                        const group = data.team?.groups?.find((g: any) => g.name === groupName);
                        if (group) navigate(`/space/group/${group.id}`);
                      }}>
                      {groupName}
                    </h4>
                    <div className="space-y-1">
                      {(groupItems as any[]).map((item: any) => (
                        <div key={item.id} className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 cursor-pointer hover:border-primary-200 transition-colors"
                          onClick={() => {
                            const group = data.team?.groups?.find((g: any) => g.name === groupName);
                            if (group) navigate(`/space/group/${group.id}`);
                          }}>
                          <span className="text-sm text-gray-700">{item.title}</span>
                          <span className="text-xs text-gray-400 ml-2">{item.user?.username}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </DashboardSection>
        }
        bottom={
          reports.length > 0 ? (
            <DashboardSection title="주간 보고서" count={reports.length} colorBar="purple">
              <div className="bg-gray-50 rounded-lg border border-gray-100 p-3 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span onClick={() => navigate(`/report/${latestReport.id}`)}
                    className="text-sm font-medium text-primary-600 hover:underline cursor-pointer">
                    {data.team?.name} 보고서 {formatDateWithDay(latestReport.periodStart)} ~ {formatDateWithDay(latestReport.periodEnd)}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => handleExport(latestReport.id, 'docx')}
                      className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100">DOCX</button>
                    <button onClick={() => handleExport(latestReport.id, 'xlsx')}
                      className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-md hover:bg-green-100">XLSX</button>
                  </div>
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
                      <span onClick={() => navigate(`/report/${report.id}`)}
                        className="text-sm font-medium text-gray-500 hover:text-primary-600 hover:underline cursor-pointer">
                        {data.team?.name} 보고서 {formatDateWithDay(report.periodStart)} ~ {formatDateWithDay(report.periodEnd)}
                      </span>
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
