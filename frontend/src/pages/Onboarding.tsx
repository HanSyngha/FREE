/**
 * Onboarding Page - 최초 로그인 그룹/파트 선택
 * Step 1: 그룹 선택/생성 → Step 2: 파트 선택/생성 → 완료
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { onboardingApi, authApi } from '../services/api';

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, setAuth } = useAuthStore();

  // Step: 'group' → 'part' → submit
  const [step, setStep] = useState<'group' | 'part'>('group');

  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [parts, setParts] = useState<Array<{ id: string; name: string }>>([]);

  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [newPartName, setNewPartName] = useState('');
  const [isNewGroup, setIsNewGroup] = useState(false);
  const [isNewPart, setIsNewPart] = useState(false);

  // 정규화 상태
  const [normalizedName, setNormalizedName] = useState('');
  const [normalizeTarget, setNormalizeTarget] = useState<'group' | 'part' | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [groupNormalized, setGroupNormalized] = useState(false);
  const [partNormalized, setPartNormalized] = useState(false);
  const programmaticSet = useRef(false);

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

  // 사용자가 직접 타이핑할 때만 정규화 상태 리셋
  const handleGroupNameChange = (val: string) => {
    setNewGroupName(val);
    setGroupNormalized(false);
  };

  const handlePartNameChange = (val: string) => {
    setNewPartName(val);
    setPartNormalized(false);
  };

  const handleNormalize = async (name: string, target: 'group' | 'part') => {
    try {
      setLoading(true);
      const res = await onboardingApi.normalizeName(name);
      setNormalizedName(res.data.normalized);
      setNormalizeTarget(target);
      setShowConfirm(true);
    } catch {
      setError('이름 정규화에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const confirmNormalize = () => {
    programmaticSet.current = true;
    if (normalizeTarget === 'group') {
      setNewGroupName(normalizedName);
      setGroupNormalized(true);
    } else {
      setNewPartName(normalizedName);
      setPartNormalized(true);
    }
    setShowConfirm(false);
  };

  // Step 1: 그룹 확정
  const handleGroupNext = async () => {
    setError('');

    if (isNewGroup && newGroupName && !groupNormalized) {
      await handleNormalize(newGroupName, 'group');
      return;
    }

    if (!selectedGroupId && !newGroupName) {
      setError('그룹을 선택하거나 새로 입력해 주세요.');
      return;
    }

    setStep('part');
  };

  // Step 2: 최종 제출
  const handleSubmit = async () => {
    setError('');

    if (isNewPart && newPartName && !partNormalized) {
      await handleNormalize(newPartName, 'part');
      return;
    }

    if (!selectedPartId && !newPartName) {
      setError('파트를 선택하거나 새로 입력해 주세요.');
      return;
    }

    setLoading(true);
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

  const groupResolved = isNewGroup ? newGroupName : selectedGroupId;
  const partResolved = isNewPart ? newPartName : selectedPartId;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">조직 설정</h1>
          <p className="text-sm text-gray-500">소속 그룹과 파트를 선택해 주세요</p>
          <p className="text-xs text-gray-400 mt-1">{user?.username} ({user?.loginid})</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          <div className={`flex-1 h-1.5 rounded-full transition-colors ${step === 'group' ? 'bg-primary-500' : 'bg-primary-500'}`} />
          <div className={`flex-1 h-1.5 rounded-full transition-colors ${step === 'part' ? 'bg-primary-500' : 'bg-gray-200'}`} />
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

        {/* Step 1: 그룹 */}
        {step === 'group' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">그룹 선택</label>
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
                  onChange={(e) => handleGroupNameChange(e.target.value)}
                  placeholder="예: Agent Enabler → AE그룹"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
                <p className="mt-1 text-xs text-gray-400">긴 영문명은 축약하세요 (Agent Enabler → AE그룹)</p>
                <button onClick={() => { setIsNewGroup(false); setNewGroupName(''); setGroupNormalized(false); }}
                  className="mt-1 text-xs text-gray-500 hover:underline">
                  기존 그룹에서 선택
                </button>
              </div>
            )}

            <button
              onClick={handleGroupNext}
              disabled={loading || !groupResolved}
              className="w-full mt-6 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700
                         disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? '처리 중...' : '다음'}
            </button>
          </div>
        )}

        {/* Step 2: 파트 */}
        {step === 'part' && (
          <div>
            {/* 선택된 그룹 표시 */}
            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-500">그룹</span>
                <p className="text-sm font-medium text-gray-900">
                  {isNewGroup ? newGroupName : groups.find(g => g.id === selectedGroupId)?.name}
                </p>
              </div>
              <button onClick={() => setStep('group')} className="text-xs text-primary-600 hover:underline">변경</button>
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-1">파트 선택</label>
            {!isNewPart ? (
              <div>
                <select
                  value={selectedPartId}
                  onChange={(e) => setSelectedPartId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  disabled={isNewGroup}
                >
                  <option value="">{isNewGroup ? '새 그룹에는 새 파트를 등록하세요' : '파트를 선택하세요'}</option>
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
                  onChange={(e) => handlePartNameChange(e.target.value)}
                  placeholder="예: Agent Enabler → AE파트"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                />
                <p className="mt-1 text-xs text-gray-400">긴 영문명은 축약하세요 (Agent Enabler → AE파트)</p>
                <button onClick={() => { setIsNewPart(false); setNewPartName(''); setPartNormalized(false); }}
                  className="mt-1 text-xs text-gray-500 hover:underline">
                  기존 파트에서 선택
                </button>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading || !partResolved}
              className="w-full mt-6 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700
                         disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? '설정 중...' : '설정 완료'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
