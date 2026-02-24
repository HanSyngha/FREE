/**
 * Profile Page - 프로필 + 활동 로그 + 그룹/파트 변경 + 업무 기록 설정
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

  // Preferences state
  const [prefTone, setPrefTone] = useState('');
  const [prefCustomTone, setPrefCustomTone] = useState('');
  const [prefLanguage, setPrefLanguage] = useState('korean');
  const [prefEmphasis, setPrefEmphasis] = useState('');
  const [prefCustomInstructions, setPrefCustomInstructions] = useState('');
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefSuccess, setPrefSuccess] = useState(false);
  const [prefError, setPrefError] = useState('');

  // Organization change state
  const [groups, setGroups] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [newPartName, setNewPartName] = useState('');
  const [isNewGroup, setIsNewGroup] = useState(false);
  const [isNewPart, setIsNewPart] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      profileApi.get().then(res => setProfile(res.data.user)),
      profileApi.getActivityLog().then(res => setActivityLogs(res.data.logs)),
      profileApi.getPreferences().then(res => {
        const prefs = res.data.preferences || {};
        // 어조: custom 값이면 직접 입력으로 설정
        if (prefs.tone && !['formal', 'concise'].includes(prefs.tone)) {
          setPrefTone('custom');
          setPrefCustomTone(prefs.tone);
        } else {
          setPrefTone(prefs.tone || '');
        }
        setPrefLanguage(prefs.language || 'korean');
        setPrefEmphasis(prefs.emphasis || '');
        setPrefCustomInstructions(prefs.customInstructions || '');
      }),
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

  const handleSaveOrg = async () => {
    setSaving(true);
    setError('');
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

  const handleSavePreferences = async () => {
    setPrefSaving(true);
    setPrefSuccess(false);
    setPrefError('');
    try {
      const tone = prefTone === 'custom' ? prefCustomTone : prefTone;
      await profileApi.updatePreferences({
        tone: tone || undefined,
        language: prefLanguage,
        emphasis: prefEmphasis || undefined,
        customInstructions: prefCustomInstructions || undefined,
      });
      setPrefSuccess(true);
      setTimeout(() => setPrefSuccess(false), 2000);
    } catch (err: any) {
      setPrefError(err.response?.data?.error || '설정 저장에 실패했습니다.');
    } finally {
      setPrefSaving(false);
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
            <p className="text-sm font-medium text-gray-900">{profile?.businessUnit || profile?.team?.businessUnit?.name}</p>
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

      {/* 업무 기록 설정 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-4">업무 기록 설정</h2>
        <p className="text-xs text-gray-500 mb-4">Item 추가 시 AI가 적용할 개인 설정입니다.</p>

        {prefError && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">{prefError}</div>}

        {/* 어조 */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">어조</label>
          <div className="flex gap-2">
            <select
              value={prefTone}
              onChange={(e) => { setPrefTone(e.target.value); if (e.target.value !== 'custom') setPrefCustomTone(''); }}
              className="flex-1 px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">기본</option>
              <option value="formal">격식체</option>
              <option value="concise">간결체</option>
              <option value="custom">직접 입력</option>
            </select>
            {prefTone === 'custom' && (
              <input
                value={prefCustomTone}
                onChange={(e) => setPrefCustomTone(e.target.value)}
                placeholder="예: 친근하게, 전문적으로"
                className="flex-1 px-3 py-2 border rounded-lg text-sm"
              />
            )}
          </div>
        </div>

        {/* 언어 */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">작성 언어</label>
          <select
            value={prefLanguage}
            onChange={(e) => setPrefLanguage(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          >
            <option value="korean">한국어</option>
            <option value="english">영어</option>
          </select>
        </div>

        {/* 강조 */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">강조할 내용</label>
          <input
            value={prefEmphasis}
            onChange={(e) => setPrefEmphasis(e.target.value)}
            placeholder="예: AI 프로젝트를 우선 강조"
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>

        {/* 추가 지시사항 */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">추가 지시사항</label>
          <textarea
            value={prefCustomInstructions}
            onChange={(e) => setPrefCustomInstructions(e.target.value)}
            placeholder="예: 기술 용어는 영어로 유지해줘"
            rows={2}
            className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
          />
        </div>

        <button
          onClick={handleSavePreferences}
          disabled={prefSaving}
          className="w-full py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {prefSaving ? '저장 중...' : prefSuccess ? '저장됨!' : '설정 저장'}
        </button>
      </div>

      {/* 그룹/파트 변경 폼 */}
      {showOrgChange && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">그룹/파트 변경</h2>

          {error && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">{error}</div>}

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
                  {new Date(log.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
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
