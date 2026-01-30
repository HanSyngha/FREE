/**
 * Super Admin Page - LLM 관리, 팀 관리, Team Admin 지정
 */
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { adminApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

export default function SuperAdmin() {
  const { isSuperAdmin } = useAuthStore();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'llm' | 'teams'>('llm');

  // LLM State
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<any[]>([]);
  const [configs, setConfigs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Teams State
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [adminUserId, setAdminUserId] = useState('');

  useEffect(() => {
    if (!isSuperAdmin) { navigate('/'); return; }
    fetchModels();
    fetchTeams();
  }, []);

  const fetchModels = () => {
    adminApi.getModels().then(res => {
      setModels(res.data.availableModels || []);
      setConfigs(res.data.configs || []);
    }).catch(() => {});
  };

  const fetchTeams = () => {
    adminApi.getTeams().then(res => setTeams(res.data.teams)).catch(() => {});
  };

  const handleSetEndpoint = async () => {
    setSaving(true);
    try {
      await adminApi.setEndpoint(endpoint, apiKey);
      alert('Endpoint가 설정되었습니다.');
    } catch { alert('설정에 실패했습니다.'); }
    finally { setSaving(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await adminApi.syncModels(endpoint || undefined, apiKey || undefined);
      setModels(res.data.models || []);
      alert(`${res.data.models?.length || 0}개 모델이 동기화되었습니다.`);
    } catch { alert('동기화에 실패했습니다.'); }
    finally { setSyncing(false); }
  };

  const handleActivate = async (model: any) => {
    try {
      await adminApi.activateModel(model.id, {
        modelName: model.displayName,
        endpoint,
        apiKey,
      });
      fetchModels();
      alert(`${model.displayName} 모델이 활성화되었습니다.`);
    } catch { alert('활성화에 실패했습니다.'); }
  };

  const handleAddAdmin = async (userId?: string) => {
    const targetUserId = userId || adminUserId;
    if (!targetUserId || !selectedTeamId) return;
    try {
      await adminApi.addTeamAdmin(targetUserId, selectedTeamId);
      fetchTeams();
      setAdminUserId('');
      alert('Team Admin이 추가되었습니다.');
    } catch (err: any) { alert(err.response?.data?.error || '추가에 실패했습니다.'); }
  };

  const handleRemoveAdmin = async (id: string) => {
    if (!confirm('Team Admin 권한을 해제하시겠습니까?')) return;
    try {
      await adminApi.removeTeamAdmin(id);
      fetchTeams();
    } catch { alert('해제에 실패했습니다.'); }
  };

  const selectedTeam = teams.find(t => t.id === selectedTeamId);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">시스템 관리 (Super Admin)</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6" role="tablist" aria-label="관리 메뉴">
        <button onClick={() => setTab('llm')} role="tab" aria-selected={tab === 'llm'} aria-controls="panel-llm"
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${tab === 'llm' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          LLM 설정
        </button>
        <button onClick={() => setTab('teams')} role="tab" aria-selected={tab === 'teams'} aria-controls="panel-teams"
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${tab === 'teams' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          팀 관리
        </button>
      </div>

      {/* LLM Tab */}
      {tab === 'llm' && (
        <div id="panel-llm" role="tabpanel" aria-labelledby="tab-llm" className="space-y-6">
          {/* Endpoint 설정 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4">LLM Endpoint 설정</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Endpoint URL</label>
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="http://..." className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs text-gray-500">API Key (선택)</label>
                <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password"
                  placeholder="API Key" className="w-full px-3 py-2 border rounded-lg text-sm mt-1" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSetEndpoint} disabled={saving || !endpoint}
                  className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg disabled:opacity-50">
                  {saving ? '저장 중...' : 'Endpoint 저장'}
                </button>
                <button onClick={handleSync} disabled={syncing}
                  className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg disabled:opacity-50">
                  {syncing ? '동기화 중...' : 'Model Sync'}
                </button>
              </div>
            </div>
          </div>

          {/* Model List */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4">사용 가능한 모델</h2>
            {models.length === 0 ? (
              <p className="text-sm text-gray-400">Sync를 실행하여 모델을 불러오세요</p>
            ) : (
              <div className="space-y-2">
                {models.map(model => {
                  const isActive = configs.some(c => c.modelId === model.id && c.isActive);
                  return (
                    <div key={model.id} className={`flex items-center justify-between p-3 rounded-lg border
                      ${isActive ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                      <div>
                        <span className="text-sm font-medium text-gray-700">{model.displayName}</span>
                        <span className="text-xs text-gray-400 ml-2">{model.id}</span>
                        {isActive && <span className="text-xs text-green-600 ml-2 font-medium">활성</span>}
                      </div>
                      {!isActive && (
                        <button onClick={() => handleActivate(model)}
                          className="px-3 py-1 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-700">
                          활성화
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Teams Tab */}
      {tab === 'teams' && (
        <div id="panel-teams" role="tabpanel" aria-labelledby="tab-teams" className="space-y-6">
          {/* 팀 목록 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4">전체 팀 목록</h2>
            <div className="space-y-3">
              {teams.map(team => (
                <div key={team.id} className={`p-4 rounded-lg border cursor-pointer transition-all
                  ${selectedTeamId === team.id ? 'border-primary-300 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  onClick={() => setSelectedTeamId(team.id)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{team.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{team.businessUnit}</span>
                    </div>
                    <span className="text-xs text-gray-500">{team.users?.length || 0}명</span>
                  </div>
                  {/* Team Admins */}
                  {team.teamAdmins?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {team.teamAdmins.map((ta: any) => (
                        <span key={ta.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded">
                          {ta.user.username}
                          <button onClick={(e) => { e.stopPropagation(); handleRemoveAdmin(ta.id); }}
                            className="text-amber-500 hover:text-red-500">x</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Team Admin 추가 */}
          {selectedTeam && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-bold text-gray-700 mb-4">
                {selectedTeam.name} - Team Admin 관리
              </h2>

              {/* 그룹/파트 드롭다운 필터 */}
              <div className="flex gap-3 mb-4">
                <select value={selectedGroupId} onChange={(e) => { setSelectedGroupId(e.target.value); setSelectedPartId(''); }}
                  className="px-3 py-2 border rounded-lg text-sm">
                  <option value="">전체 그룹</option>
                  {selectedTeam.groups?.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <select value={selectedPartId} onChange={(e) => setSelectedPartId(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm">
                  <option value="">전체 파트</option>
                  {selectedTeam.groups?.find((g: any) => g.id === selectedGroupId)?.parts?.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* 사용자 목록 */}
              <div className="mb-4 max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b">
                    <th scope="col" className="pb-2">이름</th><th scope="col" className="pb-2">ID</th>
                    <th scope="col" className="pb-2">그룹</th><th scope="col" className="pb-2">파트</th>
                    <th scope="col" className="pb-2"><span className="sr-only">관리</span></th>
                  </tr></thead>
                  <tbody>
                    {selectedTeam.users
                      ?.filter((u: any) => {
                        if (selectedGroupId && u.groupId !== selectedGroupId) return false;
                        if (selectedPartId && u.partId !== selectedPartId) return false;
                        return true;
                      })
                      .map((u: any) => (
                      <tr key={u.id} className="border-b border-gray-50">
                        <td className="py-1.5">{u.username}</td>
                        <td className="py-1.5 text-gray-500">{u.loginid}</td>
                        <td className="py-1.5 text-gray-500">{u.group?.name || '-'}</td>
                        <td className="py-1.5 text-gray-500">{u.part?.name || '-'}</td>
                        <td className="py-1.5">
                          {!selectedTeam.teamAdmins?.some((ta: any) => ta.user.id === u.id) && (
                            <button onClick={() => handleAddAdmin(u.id)}
                              className="text-xs text-primary-600 hover:underline">Admin 지정</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
