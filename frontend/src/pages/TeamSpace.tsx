/**
 * Team Space Page - 팀 목표 + 하위 그룹 진행률
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, reportsApi, announcementsApi, goalsApi } from '../services/api';
import GoalCard from '../components/goal/GoalCard';
import GoalInputForm from '../components/goal/GoalInputForm';
import ProgressBar from '../components/common/ProgressBar';

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
  const [activeTab, setActiveTab] = useState<'goals' | 'records'>('goals');

  // Announcement management
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [showOlderReports, setShowOlderReports] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annSaving, setAnnSaving] = useState(false);

  const isTeamLevel = isSuperAdmin || isTeamAdmin;

  const fetchData = async () => {
    try {
      const spaceRes = await spacesApi.getTeam();
      setData(spaceRes.data);

      const teamId = spaceRes.data.team?.id;
      if (teamId) {
        const goalsRes = await goalsApi.getAll({ level: 'TEAM', ownerId: teamId });
        setGoals(goalsRes.data.goals || []);

        // 하위 그룹별 목표
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

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{data.team?.name}</h1>
      <p className="text-sm text-gray-500 mb-4">{data.team?.businessUnit}</p>

      {/* 공지 */}
      {data.announcement && !showAnnouncementForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-sm font-bold text-blue-800 mb-1">{data.announcement.title}</h3>
              <p className="text-sm text-blue-700">{data.announcement.content}</p>
              <p className="text-xs text-blue-500 mt-2">
                {data.announcement.author?.username} | {new Date(data.announcement.updatedAt).toLocaleDateString('ko-KR')}
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
        <div className="bg-white border border-blue-200 rounded-xl p-4 mb-4">
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
          className="mb-4 text-sm text-primary-600 hover:underline">+ 팀 공지 작성</button>
      )}

      {/* 실패한 보고서 재개 */}
      {data.failedJob && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
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
          {/* 팀 목표 입력 */}
          {isTeamLevel && data.team?.id && (
            <GoalInputForm level="TEAM" ownerId={data.team.id} onCreated={fetchData} />
          )}

          {/* 팀 목표 */}
          {goals.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-500 mb-3">팀 목표</h2>
              <div className="space-y-3">
                {goals.map((goal: any) => (
                  <GoalCard key={goal.id} goal={goal} onClick={() => navigate(`/goals/${goal.id}`)} />
                ))}
              </div>
            </div>
          )}

          {/* 하위 그룹별 목표 진행률 */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 mb-3">그룹별 목표</h2>
            {(data.team?.groups || []).map((group: any) => {
              const gGoals = groupGoals[group.id] || [];
              const avgProgress = gGoals.length > 0
                ? Math.round(gGoals.reduce((s: number, g: any) => s + g.progress, 0) / gGoals.length)
                : 0;
              return (
                <div key={group.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 mb-3 cursor-pointer hover:shadow-sm transition-shadow"
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
                          {data.team?.name} 보고서 {formatDateWithDay(latest.periodStart)} ~ {formatDateWithDay(latest.periodEnd)}
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
                              {data.team?.name} 보고서 {formatDateWithDay(report.periodStart)} ~ {formatDateWithDay(report.periodEnd)}
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
                {Object.entries(groupedByDate[dateKey]!).map(([groupName, groupItems]) => (
                  <div key={groupName} className="mb-3">
                    <h3 className="text-xs font-medium text-gray-600 mb-2 px-1 cursor-pointer hover:text-primary-600"
                      onClick={() => {
                        const group = data.team?.groups?.find((g: any) => g.name === groupName);
                        if (group) navigate(`/space/group/${group.id}`);
                      }}>
                      {groupName}
                    </h3>
                    <div className="space-y-1">
                      {(groupItems as any[]).map((item: any) => (
                        <div key={item.id} className="px-3 py-2 bg-white rounded-lg border border-gray-100 cursor-pointer hover:border-primary-200 transition-colors"
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
            ))
          )}
        </>
      )}
    </div>
  );
}
