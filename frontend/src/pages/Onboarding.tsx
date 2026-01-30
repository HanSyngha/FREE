/**
 * Onboarding Page - 최초 로그인 그룹/파트 선택
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { onboardingApi, authApi } from '../services/api';

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, setAuth } = useAuthStore();
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [parts, setParts] = useState<Array<{ id: string; name: string }>>([]);

  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [newPartName, setNewPartName] = useState('');
  const [isNewGroup, setIsNewGroup] = useState(false);
  const [isNewPart, setIsNewPart] = useState(false);

  const [normalizedName, setNormalizedName] = useState('');
  const [normalizeTarget, setNormalizeTarget] = useState<'group' | 'part' | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [groupNormalized, setGroupNormalized] = useState(false);
  const [partNormalized, setPartNormalized] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onboardingApi.getGroups().then(res => setGroups(res.data.groups)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedGroupId) {
      onboardingApi.getParts(selectedGroupId).then(res => setParts(res.data.parts)).catch(() => {});
    } else {
      setParts([]);
    }
  }, [selectedGroupId]);

  const handleNormalize = async (name: string, target: 'group' | 'part') => {
    try {
      const res = await onboardingApi.normalizeName(name);
      setNormalizedName(res.data.normalized);
      setNormalizeTarget(target);
      setShowConfirm(true);
    } catch {
      setError('이름 정규화에 실패했습니다.');
    }
  };

  // 신규 이름 직접 변경 시 정규화 상태 리셋
  useEffect(() => { setGroupNormalized(false); }, [newGroupName]);
  useEffect(() => { setPartNormalized(false); }, [newPartName]);

  const confirmNormalize = () => {
    if (normalizeTarget === 'group') {
      setGroupNormalized(true);
      setNewGroupName(normalizedName);
    } else {
      setPartNormalized(true);
      setNewPartName(normalizedName);
    }
    setShowConfirm(false);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    // 신규 그룹 이름 정규화 확인 (아직 정규화 안 됐으면)
    if (isNewGroup && newGroupName && !groupNormalized) {
      await handleNormalize(newGroupName, 'group');
      setLoading(false);
      return;
    }

    // 신규 파트 이름 정규화 확인 (아직 정규화 안 됐으면)
    if (isNewPart && newPartName && !partNormalized) {
      await handleNormalize(newPartName, 'part');
      setLoading(false);
      return;
    }

    try {
      const data: any = {};
      if (isNewGroup) {
        data.groupName = newGroupName;
      } else {
        data.groupId = selectedGroupId;
      }
      if (isNewPart) {
        data.partName = newPartName;
      } else {
        data.partId = selectedPartId;
      }

      await onboardingApi.setup(data);

      // Refresh user data
      const meRes = await authApi.me();
      setAuth({
        user: meRes.data.user,
        isSuperAdmin: meRes.data.isSuperAdmin,
        isTeamAdmin: meRes.data.isTeamAdmin,
        needsOnboarding: meRes.data.needsOnboarding,
        spaces: meRes.data.spaces,
      });

      navigate('/space/personal');
    } catch (err: any) {
      setError(err.response?.data?.error || '설정에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">조직 설정</h1>
          <p className="text-sm text-gray-500">소속 그룹과 파트를 선택해 주세요</p>
          <p className="text-xs text-gray-400 mt-1">{user?.username} ({user?.loginid})</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        {/* 정규화 확인 모달 */}
        {showConfirm && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800 font-medium mb-2">이름이 다음과 같이 정규화됩니다:</p>
            <p className="text-lg font-bold text-blue-900 mb-3">{normalizedName}</p>
            <div className="flex gap-2">
              <button onClick={confirmNormalize}
                className="flex-1 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700">
                확인
              </button>
              <button onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300">
                다시 입력
              </button>
            </div>
          </div>
        )}

        {/* 그룹 선택 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">그룹</label>
          {!isNewGroup ? (
            <div>
              <select
                value={selectedGroupId}
                onChange={(e) => { setSelectedGroupId(e.target.value); setSelectedPartId(''); }}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">그룹을 선택하세요</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button onClick={() => setIsNewGroup(true)} className="mt-1 text-xs text-primary-600 hover:underline">
                + 새 그룹 등록
              </button>
            </div>
          ) : (
            <div>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="새 그룹 이름을 입력하세요"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              />
              <button onClick={() => { setIsNewGroup(false); setNewGroupName(''); }} className="mt-1 text-xs text-gray-500 hover:underline">
                기존 그룹에서 선택
              </button>
            </div>
          )}
        </div>

        {/* 파트 선택 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">파트</label>
          {!isNewPart ? (
            <div>
              <select
                value={selectedPartId}
                onChange={(e) => setSelectedPartId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                disabled={!selectedGroupId && !isNewGroup}
              >
                <option value="">파트를 선택하세요</option>
                {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={() => setIsNewPart(true)} className="mt-1 text-xs text-primary-600 hover:underline">
                + 새 파트 등록
              </button>
            </div>
          ) : (
            <div>
              <input
                value={newPartName}
                onChange={(e) => setNewPartName(e.target.value)}
                placeholder="새 파트 이름을 입력하세요"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
              />
              <button onClick={() => { setIsNewPart(false); setNewPartName(''); }} className="mt-1 text-xs text-gray-500 hover:underline">
                기존 파트에서 선택
              </button>
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || ((!selectedGroupId && !newGroupName) || (!selectedPartId && !newPartName))}
          className="w-full py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700
                     disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? '설정 중...' : '설정 완료'}
        </button>
      </div>
    </div>
  );
}
