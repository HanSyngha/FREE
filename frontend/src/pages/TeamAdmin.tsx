/**
 * Team Admin Page
 */
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { teamAdminApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

export default function TeamAdmin() {
  const { isTeamAdmin, isSuperAdmin } = useAuthStore();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'users' | 'logs'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  const [filterGroupId, setFilterGroupId] = useState('');
  const [filterPartId, setFilterPartId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isTeamAdmin && !isSuperAdmin) { navigate('/'); return; }
    fetchUsers();
    fetchLogs();
  }, []);

  const fetchUsers = (groupId?: string, partId?: string) => {
    setLoading(true);
    teamAdminApi.getUsers({ groupId, partId })
      .then(res => {
        setUsers(res.data.users || []);
        setGroups(res.data.groups || []);
        setParts(res.data.parts || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchLogs = () => {
    teamAdminApi.getReportLogs().then(res => setLogs(res.data.logs)).catch(() => {});
  };

  const handleFilterGroup = (gId: string) => {
    setFilterGroupId(gId);
    setFilterPartId('');
    fetchUsers(gId);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">팀 관리 (Team Admin)</h1>

      <div className="flex gap-2 mb-6" role="tablist" aria-label="팀 관리 메뉴">
        <button onClick={() => setTab('users')} role="tab" aria-selected={tab === 'users'} aria-controls="panel-users"
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${tab === 'users' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          사용자 목록
        </button>
        <button onClick={() => setTab('logs')} role="tab" aria-selected={tab === 'logs'} aria-controls="panel-logs"
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${tab === 'logs' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          보고서 생성 로그
        </button>
      </div>

      {tab === 'users' && (
        <div id="panel-users" role="tabpanel" aria-labelledby="tab-users" className="bg-white rounded-xl border border-gray-200 p-6">
          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <select value={filterGroupId} onChange={(e) => handleFilterGroup(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">전체 그룹</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={filterPartId} onChange={(e) => { setFilterPartId(e.target.value); fetchUsers(filterGroupId, e.target.value); }}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">전체 파트</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-b">
                <th scope="col" className="pb-2 py-2">이름</th><th scope="col" className="pb-2">ID</th>
                <th scope="col" className="pb-2">그룹</th><th scope="col" className="pb-2">파트</th>
                <th scope="col" className="pb-2">마지막 활동</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2">{u.username}</td>
                    <td className="py-2 text-gray-500">{u.loginid}</td>
                    <td className="py-2 text-gray-500">{u.group?.name || '-'}</td>
                    <td className="py-2 text-gray-500">{u.part?.name || '-'}</td>
                    <td className="py-2 text-gray-400 text-xs">{u.lastActive ? new Date(u.lastActive).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div id="panel-logs" role="tabpanel" aria-labelledby="tab-logs" className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">보고서 생성 로그 (0시 생성)</h2>
          {logs.length === 0 ? (
            <p className="text-sm text-gray-400">로그가 없습니다</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {logs.map(log => (
                <div key={log.id} className={`flex items-center justify-between p-3 rounded-lg border
                  ${log.status === 'SUCCESS' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
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
                    <span className="text-xs text-gray-400">{new Date(log.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>
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
