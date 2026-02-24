/**
 * Super Admin Page - LLM 관리, 팀 관리, Team Admin 지정
 */
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { adminApi, orgAdminApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

export default function SuperAdmin() {
  const { isSuperAdmin } = useAuthStore();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'llm' | 'teams' | 'reports' | 'orgadmin'>('llm');

  // LLM State
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<any[]>([]);
  const [configs, setConfigs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Report Trigger State
  const [reportTeamId, setReportTeamId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // OrgAdmin State
  const [orgAdmins, setOrgAdmins] = useState<any[]>([]);
  const [orgAdminForm, setOrgAdminForm] = useState({ userId: '', level: 'PART', targetId: '' });

  // Teams State
  const [teams, setTeams] = useState<any[]>([]);
  const [filterBU, setFilterBU] = useState('');
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

  const handleTriggerReport = async () => {
    if (!reportTeamId) return;
    const team = teams.find(t => t.id === reportTeamId);
    if (!confirm(`${team?.name || reportTeamId} 팀의 보고서를 수동 생성하시겠습니까?`)) return;
    setTriggering(true);
    setTriggerResult(null);
    try {
      const res = await adminApi.triggerReport(reportTeamId);
      setTriggerResult({ type: 'success', message: res.data.message });
    } catch (err: any) {
      setTriggerResult({ type: 'error', message: err.response?.data?.error || '보고서 생성 트리거에 실패했습니다.' });
    } finally {
      setTriggering(false);
    }
  };

  const fetchOrgAdmins = () => {
    orgAdminApi.getAll().then(res => setOrgAdmins(res.data.orgAdmins || [])).catch(() => {});
  };

  const handleAddOrgAdmin = async () => {
    const { userId, level, targetId } = orgAdminForm;
    if (!userId || !targetId) return;
    try {
      await orgAdminApi.create(userId, level, targetId);
      setOrgAdminForm({ userId: '', level: 'PART', targetId: '' });
      fetchOrgAdmins();
    } catch (err: any) { alert(err.response?.data?.error || '조직 권한 추가에 실패했습니다.'); }
  };

  const handleRemoveOrgAdmin = async (id: string) => {
    if (!confirm('이 조직 권한을 해제하시겠습니까?')) return;
    try {
      await orgAdminApi.delete(id);
      fetchOrgAdmins();
    } catch { alert('권한 해제에 실패했습니다.'); }
  };

  const businessUnits = [...new Set(teams.map(t => t.businessUnit).filter(Boolean))].sort();
  const filteredTeams = filterBU ? teams.filter(t => t.businessUnit === filterBU) : teams;
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
        <button onClick={() => setTab('reports')} role="tab" aria-selected={tab === 'reports'} aria-controls="panel-reports"
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${tab === 'reports' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          보고서 생성
        </button>
        <button onClick={() => { setTab('orgadmin'); if (orgAdmins.length === 0) fetchOrgAdmins(); }} role="tab" aria-selected={tab === 'orgadmin'} aria-controls="panel-orgadmin"
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${tab === 'orgadmin' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          조직 권한
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-700">전체 팀 목록</h2>
              <select value={filterBU} onChange={(e) => { setFilterBU(e.target.value); setSelectedTeamId(''); }}
                className="px-3 py-1.5 border rounded-lg text-sm">
                <option value="">전체 사업부</option>
                {businessUnits.map(bu => <option key={bu} value={bu}>{bu}</option>)}
              </select>
            </div>
            <div className="space-y-3">
              {filteredTeams.map(team => (
                <div key={team.id} className={`p-4 rounded-lg border cursor-pointer transition-all
                  ${selectedTeamId === team.id ? 'border-primary-300 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  onClick={() => setSelectedTeamId(team.id)}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{team.name}</span>
                      <span className="text-xs text-gray-400 ml-2">({team.businessUnit})</span>
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
                {selectedTeam.name} <span className="text-gray-400 font-normal">({selectedTeam.businessUnit})</span> - Team Admin 관리
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

      {/* Reports Tab */}
      {tab === 'reports' && (
        <div id="panel-reports" role="tabpanel" aria-labelledby="tab-reports" className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-2">수동 보고서 생성</h2>
            <p className="text-xs text-gray-500 mb-4">
              매일 00:00(KST)에 자동 실행되는 보고서 생성과 동일한 작업을 수동으로 트리거합니다.
              파트 → 그룹 → 팀 순서로 보고서가 생성됩니다.
            </p>

            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">사업부</label>
                  <select value={filterBU} onChange={(e) => { setFilterBU(e.target.value); setReportTeamId(''); setTriggerResult(null); }}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">전체 사업부</option>
                    {businessUnits.map(bu => <option key={bu} value={bu}>{bu}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">팀 선택</label>
                  <select value={reportTeamId} onChange={(e) => { setReportTeamId(e.target.value); setTriggerResult(null); }}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">팀을 선택하세요</option>
                    {filteredTeams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.businessUnit}) - {team.users?.length || 0}명
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button onClick={handleTriggerReport} disabled={triggering || !reportTeamId}
                className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-primary-700 transition-colors">
                {triggering ? '생성 요청 중...' : '보고서 생성 시작'}
              </button>

              {triggerResult && (
                <div className={`p-3 rounded-lg text-sm ${
                  triggerResult.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {triggerResult.message}
                </div>
              )}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs text-amber-700">
              <strong>참고:</strong> 보고서 생성은 Worker 프로세스에서 비동기로 처리됩니다.
              생성 완료까지 팀 규모에 따라 시간이 걸릴 수 있으며, 진행 상황은 Worker 로그에서 확인할 수 있습니다.
            </p>
          </div>
        </div>
      )}
      {/* OrgAdmin Tab */}
      {tab === 'orgadmin' && (
        <div id="panel-orgadmin" role="tabpanel" aria-labelledby="tab-orgadmin" className="space-y-6">
          {/* 조직 권한 추가 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4">조직 관리 권한 추가</h2>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">사용자 ID</label>
                <input value={orgAdminForm.userId} onChange={(e) => setOrgAdminForm(f => ({ ...f, userId: e.target.value }))}
                  placeholder="사용자 ID" className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">권한 레벨</label>
                <select value={orgAdminForm.level} onChange={(e) => setOrgAdminForm(f => ({ ...f, level: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="PART">파트 (PART)</option>
                  <option value="GROUP">그룹 (GROUP)</option>
                  <option value="TEAM">팀 (TEAM)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">대상 ID</label>
                <input value={orgAdminForm.targetId} onChange={(e) => setOrgAdminForm(f => ({ ...f, targetId: e.target.value }))}
                  placeholder="팀/그룹/파트 ID" className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div className="flex items-end">
                <button onClick={handleAddOrgAdmin} disabled={!orgAdminForm.userId || !orgAdminForm.targetId}
                  className="w-full px-4 py-2 bg-primary-600 text-white text-sm rounded-lg disabled:opacity-50 hover:bg-primary-700">
                  권한 추가
                </button>
              </div>
            </div>
          </div>

          {/* 조직 권한 목록 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-bold text-gray-700 mb-4">현재 조직 권한 ({orgAdmins.length})</h2>
            {orgAdmins.length === 0 ? (
              <p className="text-sm text-gray-400">등록된 조직 권한이 없습니다</p>
            ) : (
              <div className="space-y-2">
                {orgAdmins.map((oa: any) => (
                  <div key={oa.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 text-xs rounded font-medium ${
                        oa.level === 'TEAM' ? 'bg-purple-100 text-purple-700' :
                        oa.level === 'GROUP' ? 'bg-blue-100 text-blue-700' :
                        'bg-green-100 text-green-700'
                      }`}>{oa.level}</span>
                      <span className="text-sm font-medium text-gray-700">{oa.user?.username || oa.userId}</span>
                      <span className="text-xs text-gray-400">→ {oa.targetId}</span>
                    </div>
                    <button onClick={() => handleRemoveOrgAdmin(oa.id)}
                      className="text-xs text-red-500 hover:text-red-700">해제</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-xs text-amber-700">
              <strong>권한 설명:</strong> PART 권한은 파트 목표 관리, GROUP 권한은 그룹 목표 관리, TEAM 권한은 팀 목표 관리를 할 수 있습니다.
              상위 레벨 권한은 하위 레벨도 포함합니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
