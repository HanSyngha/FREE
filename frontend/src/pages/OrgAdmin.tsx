/**
 * OrgAdmin Page - 통합 관리 페이지 (역할별 동적 제목)
 * 조직도(편집) + 관리도구 + 사용자 + 로그
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { teamAdminApi, adminApi, spacesApi } from '../services/api';
import OrgChartEditable from '../components/admin/OrgChartEditable';

type Tab = 'org' | 'tools' | 'users' | 'logs';

function getAdminTitle(isSuperAdmin: boolean, isTeamAdmin: boolean, orgAdminLevels: Array<{ level: string }>) {
  if (isSuperAdmin) return '사업부 관리';
  if (isTeamAdmin) return '팀 관리';
  const highest = orgAdminLevels.reduce<string | null>((h, oa) => {
    const order: Record<string, number> = { TEAM: 3, GROUP: 2, PART: 1 };
    if (!h || (order[oa.level] || 0) > (order[h] || 0)) return oa.level;
    return h;
  }, null);
  if (highest === 'TEAM') return '팀 관리';
  if (highest === 'GROUP') return '그룹 관리';
  if (highest === 'PART') return '파트 관리';
  return '관리';
}

function getEditLevel(isSuperAdmin: boolean, isTeamAdmin: boolean, orgAdminLevels: Array<{ level: string }>): 'BU' | 'TEAM' | 'GROUP' | 'PART' {
  if (isSuperAdmin) return 'BU';
  if (isTeamAdmin) return 'TEAM';
  const highest = orgAdminLevels.reduce<string | null>((h, oa) => {
    const order: Record<string, number> = { TEAM: 3, GROUP: 2, PART: 1 };
    if (!h || (order[oa.level] || 0) > (order[h] || 0)) return oa.level;
    return h;
  }, null);
  return (highest as 'TEAM' | 'GROUP' | 'PART') || 'PART';
}

export default function OrgAdmin() {
  const navigate = useNavigate();
  const { isSuperAdmin, isTeamAdmin, orgAdminLevels, user } = useAuthStore();

  const canAccess = isSuperAdmin || isTeamAdmin || orgAdminLevels.length > 0;
  const isTeamLevel = isSuperAdmin || isTeamAdmin;

  const [tab, setTab] = useState<Tab>('org');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');

  // 사용자 탭
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [filterGroupId, setFilterGroupId] = useState('');
  const [filterPartId, setFilterPartId] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);

  // 로그 탭
  const [logs, setLogs] = useState<any[]>([]);

  // 관리 도구 탭
  const [triggeringReport, setTriggeringReport] = useState(false);
  const [triggeringProgress, setTriggeringProgress] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!canAccess) { navigate('/'); return; }
    spacesApi.getTeam().then(res => {
      setTeamId(res.data.team?.id || null);
      setTeamName(res.data.team?.name || '');
    }).catch(() => {});
  }, []);

  const title = getAdminTitle(isSuperAdmin, isTeamAdmin, orgAdminLevels);
  const editLevel = getEditLevel(isSuperAdmin, isTeamAdmin, orgAdminLevels);
  const editTargetId = orgAdminLevels[0]?.level === 'GROUP' ? orgAdminLevels[0]?.targetId : undefined;

  // 사용자 fetcher
  const fetchUsers = (groupId?: string, partId?: string) => {
    setUsersLoading(true);
    teamAdminApi.getUsers({ groupId, partId })
      .then(res => {
        setUsers(res.data.users || []);
        setGroups(res.data.groups || []);
        setParts(res.data.parts || []);
      })
      .catch(() => {})
      .finally(() => setUsersLoading(false));
  };

  const fetchLogs = () => {
    teamAdminApi.getReportLogs().then(res => setLogs(res.data.logs || [])).catch(() => {});
  };

  useEffect(() => {
    if (tab === 'users') fetchUsers();
    if (tab === 'logs') fetchLogs();
  }, [tab]);

  const handleFilterGroup = (gId: string) => {
    setFilterGroupId(gId);
    setFilterPartId('');
    fetchUsers(gId);
  };

  const handleTriggerReport = async () => {
    if (!teamId) return;
    if (!confirm('보고서를 수동 생성하시겠습니까?')) return;
    setTriggeringReport(true);
    setTriggerMsg(null);
    try {
      const res = await adminApi.triggerReport(teamId);
      setTriggerMsg({ type: 'success', text: res.data.message });
    } catch (err: any) {
      setTriggerMsg({ type: 'error', text: err.response?.data?.error || '보고서 생성에 실패했습니다.' });
    } finally { setTriggeringReport(false); }
  };

  const handleTriggerProgress = async () => {
    if (!teamId) return;
    if (!confirm('진행률을 수동 업데이트하시겠습니까?')) return;
    setTriggeringProgress(true);
    setTriggerMsg(null);
    try {
      const res = await adminApi.triggerProgress(teamId);
      setTriggerMsg({ type: 'success', text: res.data.message });
    } catch (err: any) {
      setTriggerMsg({ type: 'error', text: err.response?.data?.error || '진행률 업데이트에 실패했습니다.' });
    } finally { setTriggeringProgress(false); }
  };

  if (!canAccess) return null;

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'org', label: '조직도', show: true },
    { key: 'tools', label: '관리 도구', show: isTeamLevel },
    { key: 'users', label: '사용자', show: true },
    { key: 'logs', label: '로그', show: isTeamLevel },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{title}</h1>
      {teamName && <p className="text-sm text-gray-500 mb-4">{teamName}</p>}

      {/* 탭 */}
      <div className="flex gap-2 mb-6" role="tablist">
        {tabs.filter(t => t.show).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} role="tab" aria-selected={tab === t.key}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              tab === t.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 조직도 탭 */}
      {tab === 'org' && teamId && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <OrgChartEditable
            teamId={teamId}
            editLevel={editLevel}
            editTargetId={editTargetId}
            onRefresh={() => {}}
          />
        </div>
      )}

      {/* 관리 도구 탭 */}
      {tab === 'tools' && isTeamLevel && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">수동 실행</h2>
          <div className="flex flex-wrap gap-3">
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
            <div className={`mt-3 p-3 rounded-lg text-sm ${
              triggerMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}>{triggerMsg.text}</div>
          )}
        </div>
      )}

      {/* 사용자 탭 */}
      {tab === 'users' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex gap-3 mb-4">
            <select value={filterGroupId} onChange={e => handleFilterGroup(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">전체 그룹</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={filterPartId} onChange={e => { setFilterPartId(e.target.value); fetchUsers(filterGroupId, e.target.value); }}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">전체 파트</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="text-sm text-gray-400 self-center">{users.length}명</span>
          </div>

          {usersLoading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b">
                <th scope="col" className="pb-2 py-2">이름</th>
                <th scope="col" className="pb-2">ID</th>
                <th scope="col" className="pb-2">그룹</th>
                <th scope="col" className="pb-2">파트</th>
                <th scope="col" className="pb-2">마지막 활동</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2">{u.username}</td>
                    <td className="py-2 text-gray-500">{u.loginid}</td>
                    <td className="py-2 text-gray-500">{u.group?.name || '-'}</td>
                    <td className="py-2 text-gray-500">{u.part?.name || '-'}</td>
                    <td className="py-2 text-gray-400 text-xs">
                      {u.lastActive ? new Date(u.lastActive).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">사용자가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 로그 탭 */}
      {tab === 'logs' && isTeamLevel && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">보고서 생성 로그 (0시 자동 생성)</h2>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-400">로그가 없습니다</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {logs.map(log => (
                <div key={log.id} className={`flex items-center justify-between p-3 rounded-lg border ${
                  log.status === 'SUCCESS' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                }`}>
                  <div>
                    <span className="text-sm font-medium">{log.targetName}</span>
                    <span className="text-xs text-gray-500 ml-2">
                      {log.reportType === 'PART' ? '파트' : log.reportType === 'GROUP' ? '그룹' : '팀'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium ${log.status === 'SUCCESS' ? 'text-green-600' : 'text-red-600'}`}>
                      {log.status === 'SUCCESS' ? '성공' : '실패'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(log.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
