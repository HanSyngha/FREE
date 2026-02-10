/**
 * Team Space Page
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { spacesApi, reportsApi, announcementsApi } from '../services/api';


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
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);

  // Announcement management
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annSaving, setAnnSaving] = useState(false);

  const fetchData = () => {
    spacesApi.getTeam().then(res => setData(res.data)).catch(() => {}).finally(() => setLoading(false));
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

  // items를 날짜별 → 그룹별로 그룹핑
  const groupedByDate: Record<string, Record<string, any[]>> = {};
  data.items?.forEach((item: any) => {
    const d = item.date.split('T')[0];
    const groupName = item.user?.group?.name || 'Unknown';
    if (!groupedByDate[d]) groupedByDate[d] = {};
    if (!groupedByDate[d]![groupName]) groupedByDate[d]![groupName] = [];
    groupedByDate[d]![groupName]!.push(item);
  });

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{data.team?.name} 업무 기록</h1>
      <p className="text-sm text-gray-500 mb-4">{data.team?.businessUnit}</p>

      {/* 공지 */}
      {data.announcement && !showAnnouncementForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-sm font-bold text-blue-800 mb-1">{data.announcement.title}</h3>
              <p className="text-sm text-blue-700">{data.announcement.content}</p>
              <p className="text-xs text-blue-500 mt-2">
                {data.announcement.author?.username} | {new Date(data.announcement.updatedAt).toLocaleDateString('ko-KR')}
              </p>
            </div>
            {(isSuperAdmin || isTeamAdmin) && (
              <div className="flex gap-1 ml-2">
                <button onClick={handleEditAnnouncement} className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-100 rounded">수정</button>
                <button onClick={handleDeleteAnnouncement} className="text-xs px-2 py-1 text-red-500 hover:bg-red-100 rounded">삭제</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 공지 작성/수정 폼 */}
      {(isSuperAdmin || isTeamAdmin) && showAnnouncementForm && (
        <div className="bg-white border border-blue-200 rounded-xl p-4 mb-6">
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

      {/* 공지 없을 때 작성 버튼 */}
      {(isSuperAdmin || isTeamAdmin) && !data.announcement && !showAnnouncementForm && (
        <button onClick={() => { setAnnTitle(''); setAnnContent(''); setShowAnnouncementForm(true); }}
          className="mb-6 text-sm text-primary-600 hover:underline">+ 팀 공지 작성</button>
      )}

      {/* 실패한 보고서 재개 버튼 */}
      {data.failedJob && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-800">보고서 생성이 실패했습니다</p>
              <p className="text-xs text-red-600 mt-1">{data.failedJob.lastError}</p>
            </div>
            <button
              onClick={handleResume}
              disabled={resuming}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {resuming ? '재개 중...' : '계속해서 생성하기'}
            </button>
          </div>
        </div>
      )}

      {/* 보고서 */}
      {data.reports?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">주간 보고서</h2>
          {data.reports.map((report: any) => (
            <div key={report.id} className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span onClick={() => navigate(`/report/${report.id}`)}
                  className="text-sm font-medium text-primary-600 hover:underline cursor-pointer">
                  {data.team?.name} 보고서 {formatDateWithDay(report.periodStart)} ~ {formatDateWithDay(report.periodEnd)}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => handleExport(report.id, 'docx')}
                    className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100">DOCX</button>
                  <button onClick={() => handleExport(report.id, 'xlsx')}
                    className="text-xs px-3 py-1 bg-green-50 text-green-600 rounded-md hover:bg-green-100">XLSX</button>
                </div>
              </div>
              <div className="flex justify-between text-xs text-gray-400">
                <span>생성: {new Date(report.createdAt).toLocaleString('ko-KR')}</span>
                <span>자동 삭제: {new Date(report.expiresAt).toLocaleDateString('ko-KR')}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Item 목록 */}
      {sortedDates.length === 0 ? (
        <div className="text-center py-12 text-gray-400">등록된 항목이 없습니다</div>
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
                    <div key={item.id} className="px-3 py-2 bg-white rounded-lg border border-gray-100 cursor-pointer hover:border-primary-200 hover:bg-primary-50/30 transition-colors"
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
    </div>
  );
}
