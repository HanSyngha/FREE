/**
 * Profile Page - 프로필 + 활동 로그 + 그룹/파트 변경
 */
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { profileApi, onboardingApi, authApi } from '../services/api';

export default function Profile() {
  const { user, setAuth } = useAuthStore();
  const [profile, setProfile] = useState<any>(null);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [showOrgChange, setShowOrgChange] = useState(false);
  const [loading, setLoading] = useState(true);

  // Organization change state
  const [groups, setGroups] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [newPartName, setNewPartName] = useState('');
  const [isNewGroup, setIsNewGroup] = useState(false);
  const [isNewPart, setIsNewPart] = useState(false);
  const [normalizedName, setNormalizedName] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [normalizeTarget, setNormalizeTarget] = useState<'group' | 'part' | null>(null);
  const [groupNormalized, setGroupNormalized] = useState(false);
  const [partNormalized, setPartNormalized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      profileApi.get().then(res => setProfile(res.data.user)),
      profileApi.getActivityLog().then(res => setActivityLogs(res.data.logs)),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (showOrgChange) {
      onboardingApi.getGroups().then(res => setGroups(res.data.groups)).catch(() => {});
    }
  }, [showOrgChange]);

  useEffect(() => {
    if (selectedGroupId) {
      onboardingApi.getParts(selectedGroupId).then(res => setParts(res.data.parts)).catch(() => {});
    }
  }, [selectedGroupId]);

  const handleNormalize = async (name: string, target: 'group' | 'part') => {
    try {
      const res = await onboardingApi.normalizeName(name);
      setNormalizedName(res.data.normalized);
      setNormalizeTarget(target);
      setShowConfirm(true);
    } catch { setError('이름 정규화에 실패했습니다.'); }
  };

  // 신규 이름 직접 변경 시 정규화 상태 리셋
  useEffect(() => { setGroupNormalized(false); }, [newGroupName]);
  useEffect(() => { setPartNormalized(false); }, [newPartName]);

  const handleSaveOrg = async () => {
    setSaving(true);
    setError('');

    if (isNewGroup && newGroupName && !groupNormalized) {
      await handleNormalize(newGroupName, 'group');
      setSaving(false);
      return;
    }
    if (isNewPart && newPartName && !partNormalized) {
      await handleNormalize(newPartName, 'part');
      setSaving(false);
      return;
    }

    try {
      const data: any = {};
      if (isNewGroup) data.groupName = newGroupName;
      else data.groupId = selectedGroupId;
      if (isNewPart) data.partName = newPartName;
      else data.partId = selectedPartId;

      await profileApi.updateOrganization(data);

      // Refresh
      const meRes = await authApi.me();
      setAuth({
        user: meRes.data.user,
        isSuperAdmin: meRes.data.isSuperAdmin,
        isTeamAdmin: meRes.data.isTeamAdmin,
        needsOnboarding: meRes.data.needsOnboarding,
        spaces: meRes.data.spaces,
      });

      setShowOrgChange(false);
      const profRes = await profileApi.get();
      setProfile(profRes.data.user);
      const logRes = await profileApi.getActivityLog();
      setActivityLogs(logRes.data.logs);
    } catch (err: any) {
      setError(err.response?.data?.error || '변경에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>;

  const actionLabels: Record<string, string> = {
    CREATE_ITEM: 'Item 추가',
    UPDATE_ITEM: 'Item 수정',
    DELETE_ITEM: 'Item 삭제',
    CHANGE_GROUP: '그룹 변경',
    CHANGE_PART: '파트 변경',
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-6">프로필</h1>

      {/* 프로필 정보 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">이름</p>
            <p className="text-sm font-medium text-gray-900">{profile?.username}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">ID</p>
            <p className="text-sm font-medium text-gray-900">{profile?.loginid}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">사업부</p>
            <p className="text-sm font-medium text-gray-900">{profile?.businessUnit || profile?.team?.businessUnit}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">팀</p>
            <p className="text-sm font-medium text-gray-900">{profile?.team?.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">그룹</p>
            <p className="text-sm font-medium text-gray-900">{profile?.group?.name || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">파트</p>
            <p className="text-sm font-medium text-gray-900">{profile?.part?.name || '-'}</p>
          </div>
        </div>

        <button onClick={() => setShowOrgChange(!showOrgChange)}
          className="mt-4 text-sm text-primary-600 hover:underline">
          그룹/파트 변경
        </button>
      </div>

      {/* 그룹/파트 변경 폼 */}
      {showOrgChange && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">그룹/파트 변경</h2>

          {error && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">{error}</div>}

          {showConfirm && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 mb-2">정규화 결과: <strong>{normalizedName}</strong></p>
              <div className="flex gap-2">
                <button onClick={() => {
                  if (normalizeTarget === 'group') { setGroupNormalized(true); setNewGroupName(normalizedName); }
                  else { setPartNormalized(true); setNewPartName(normalizedName); }
                  setShowConfirm(false);
                }} className="px-3 py-1 bg-primary-600 text-white text-sm rounded">확인</button>
                <button onClick={() => setShowConfirm(false)} className="px-3 py-1 bg-gray-200 text-sm rounded">취소</button>
              </div>
            </div>
          )}

          {/* 그룹 */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">그룹</label>
            {!isNewGroup ? (
              <div>
                <select value={selectedGroupId} onChange={(e) => { setSelectedGroupId(e.target.value); setSelectedPartId(''); }}
                  className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">선택</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button onClick={() => setIsNewGroup(true)} className="text-xs text-primary-600 mt-1">+ 새 그룹</button>
              </div>
            ) : (
              <div>
                <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="새 그룹 이름" className="w-full px-3 py-2 border rounded-lg text-sm" />
                <button onClick={() => { setIsNewGroup(false); setNewGroupName(''); }} className="text-xs text-gray-500 mt-1">기존 선택</button>
              </div>
            )}
          </div>

          {/* 파트 */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">파트</label>
            {!isNewPart ? (
              <div>
                <select value={selectedPartId} onChange={(e) => setSelectedPartId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm" disabled={!selectedGroupId && !isNewGroup}>
                  <option value="">선택</option>
                  {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={() => setIsNewPart(true)} className="text-xs text-primary-600 mt-1">+ 새 파트</button>
              </div>
            ) : (
              <div>
                <input value={newPartName} onChange={(e) => setNewPartName(e.target.value)}
                  placeholder="새 파트 이름" className="w-full px-3 py-2 border rounded-lg text-sm" />
                <button onClick={() => { setIsNewPart(false); setNewPartName(''); }} className="text-xs text-gray-500 mt-1">기존 선택</button>
              </div>
            )}
          </div>

          <button onClick={handleSaveOrg} disabled={saving}
            className="w-full py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50">
            {saving ? '저장 중...' : '변경 저장'}
          </button>
        </div>
      )}

      {/* 활동 로그 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4">활동 로그 (최근 30일)</h2>
        {activityLogs.length === 0 ? (
          <p className="text-sm text-gray-400">활동 기록이 없습니다</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {activityLogs.map(log => (
              <div key={log.id} className="flex items-start gap-3 px-2 py-2 hover:bg-gray-50 rounded">
                <span className="text-xs text-gray-400 whitespace-nowrap mt-0.5">
                  {new Date(log.createdAt).toLocaleString('ko-KR')}
                </span>
                <div>
                  <span className="text-sm font-medium text-gray-700">{actionLabels[log.action] || log.action}</span>
                  {log.details && <span className="text-sm text-gray-500 ml-2">{log.details}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
