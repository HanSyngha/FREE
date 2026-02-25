/**
 * Onboarding Page - 최초 로그인 조직 설정
 * 팀이 없으면: BU → 팀 → 그룹 → 파트 → 역할
 * 팀이 있으면: 그룹 → 파트 → 역할
 * 직속 옵션: 팀 직속(그룹+파트 스킵), 그룹 직속(파트 스킵)
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { onboardingApi, authApi } from '../services/api';

type Step = 'bu' | 'team' | 'group' | 'part' | 'role';

interface SelectItem { id: string; name: string }

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, setAuth } = useAuthStore();

  const hasTeam = !!user?.teamId;
  const initialStep: Step = hasTeam ? 'group' : 'bu';

  const [step, setStep] = useState<Step>(initialStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // BU
  const [bus, setBus] = useState<SelectItem[]>([]);
  const [selectedBuId, setSelectedBuId] = useState('');
  const [newBuName, setNewBuName] = useState('');
  const [isNewBu, setIsNewBu] = useState(false);

  // Team
  const [teams, setTeams] = useState<SelectItem[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [isNewTeam, setIsNewTeam] = useState(false);

  // Group
  const [groups, setGroups] = useState<SelectItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [isNewGroup, setIsNewGroup] = useState(false);
  const [isDirect, setIsDirect] = useState(false); // 팀 직속

  // Part
  const [parts, setParts] = useState<SelectItem[]>([]);
  const [selectedPartId, setSelectedPartId] = useState('');
  const [newPartName, setNewPartName] = useState('');
  const [isNewPart, setIsNewPart] = useState(false);
  const [isGroupDirect, setIsGroupDirect] = useState(false); // 그룹 직속

  // Role
  const [adminRole, setAdminRole] = useState<string>('');

  // Fetch BUs on mount (only if no team)
  useEffect(() => {
    if (!hasTeam) {
      onboardingApi.getBusinessUnits().then(res => setBus(res.data.businessUnits)).catch(() => {});
    }
  }, [hasTeam]);

  // Fetch teams when BU selected
  useEffect(() => {
    if (selectedBuId) {
      onboardingApi.getTeams(selectedBuId).then(res => setTeams(res.data.teams)).catch(() => {});
    } else {
      setTeams([]);
    }
  }, [selectedBuId]);

  // Fetch groups when step is group (team must be set)
  useEffect(() => {
    if (step === 'group' && (hasTeam || selectedTeamId || newTeamName)) {
      // groups API는 user.teamId 기반이라, team이 아직 DB에 안 잡힌 경우 빈 배열
      // 새 팀이면 그룹이 없으니 빈 배열 → 새 그룹 입력 유도
      if (hasTeam) {
        onboardingApi.getGroups().then(res => setGroups(res.data.groups)).catch(() => {});
      } else {
        setGroups([]); // 새 팀이면 기존 그룹 없음
      }
    }
  }, [step, hasTeam, selectedTeamId, newTeamName]);

  // Fetch parts when group selected
  useEffect(() => {
    if (selectedGroupId && !isDirect) {
      onboardingApi.getParts(selectedGroupId).then(res => setParts(res.data.parts)).catch(() => {});
    } else {
      setParts([]);
    }
  }, [selectedGroupId, isDirect]);

  // ── Step flow helpers ──────────────────────────────────

  const allSteps: Step[] = hasTeam ? ['group', 'part', 'role'] : ['bu', 'team', 'group', 'part', 'role'];

  const getStepIndex = (s: Step) => allSteps.indexOf(s);
  const totalSteps = allSteps.length;
  const currentStepIdx = getStepIndex(step);

  // ── Navigation ──────────────────────────────────────────

  const goNext = () => {
    setError('');
    if (step === 'bu') {
      if (!selectedBuId && !newBuName) { setError('사업부를 선택하거나 입력해 주세요.'); return; }
      setStep('team');
    } else if (step === 'team') {
      if (!selectedTeamId && !newTeamName) { setError('팀을 선택하거나 입력해 주세요.'); return; }
      setStep('group');
    } else if (step === 'group') {
      if (isDirect) {
        // 팀 직속 → 파트 스킵, 역할로
        setStep('role');
        return;
      }
      if (!selectedGroupId && !newGroupName) { setError('그룹을 선택하거나 입력해 주세요.'); return; }
      setStep('part');
    } else if (step === 'part') {
      if (!isGroupDirect && !selectedPartId && !newPartName) { setError('파트를 선택하거나 입력해 주세요.'); return; }
      setStep('role');
    }
  };

  const goBack = () => {
    setError('');
    const idx = currentStepIdx;
    if (idx <= 0) return;

    // 팀 직속에서 역할→그룹으로 돌아갈 때
    if (step === 'role' && isDirect) {
      setStep('group');
      return;
    }

    setStep(allSteps[idx - 1]);
  };

  // ── Submit ──────────────────────────────────────────────

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const data: any = {};

      // BU/Team (팀이 없는 경우)
      if (!hasTeam) {
        if (isNewBu) data.buName = newBuName;
        else data.buId = selectedBuId;
        if (isNewTeam) data.teamName = newTeamName;
        else data.teamId = selectedTeamId;
      }

      // Direct flags
      if (isDirect) {
        data.isDirect = true;
      } else {
        if (isNewGroup) data.groupName = newGroupName;
        else data.groupId = selectedGroupId;

        if (isGroupDirect) {
          data.isGroupDirect = true;
        } else {
          if (isNewPart) data.partName = newPartName;
          else data.partId = selectedPartId;
        }
      }

      // Admin role
      if (adminRole) data.adminRole = adminRole;

      await onboardingApi.setup(data);

      const meRes = await authApi.me();
      setAuth({
        user: meRes.data.user,
        isSuperAdmin: meRes.data.isSuperAdmin,
        isTeamAdmin: meRes.data.isTeamAdmin,
        needsOnboarding: meRes.data.needsOnboarding,
        spaces: meRes.data.spaces,
        orgAdminLevels: meRes.data.orgAdminLevels,
      });

      navigate('/space/personal');
    } catch (err: any) {
      setError(err.response?.data?.error || '설정에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step labels ──────────────────────────────────────────

  const stepLabels: Record<Step, string> = {
    bu: '사업부', team: '팀', group: '그룹', part: '파트', role: '역할',
  };

  // ── Render helpers ──────────────────────────────────────

  const renderSelectOrCreate = (
    items: SelectItem[],
    selectedId: string, setSelectedId: (v: string) => void,
    newName: string, setNewName: (v: string) => void,
    isNew: boolean, setIsNew: (v: boolean) => void,
    label: string,
  ) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {!isNew ? (
        <div>
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">{items.length > 0 ? `${label}을(를) 선택하세요` : `등록된 ${label}이(가) 없습니다`}</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <button onClick={() => setIsNew(true)} className="mt-1.5 text-xs text-primary-600 hover:underline">
            + 새 {label} 등록
          </button>
        </div>
      ) : (
        <div>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={`새 ${label} 이름`}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          {items.length > 0 && (
            <button onClick={() => { setIsNew(false); setNewName(''); }}
              className="mt-1.5 text-xs text-gray-500 hover:underline">
              기존 {label}에서 선택
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">조직 설정</h1>
          <p className="text-sm text-gray-500">소속 조직을 설정해 주세요</p>
          <p className="text-xs text-gray-400 mt-1">{user?.username} ({user?.loginid})</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {allSteps.map((s, i) => (
            <div key={s} className={`flex-1 h-1.5 rounded-full transition-colors ${
              i <= currentStepIdx ? 'bg-primary-500' : 'bg-gray-200'
            }`} />
          ))}
        </div>
        <p className="text-xs text-gray-400 text-center mb-5">
          {currentStepIdx + 1}/{totalSteps} · {stepLabels[step]}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        {/* ── Step: BU ──────────────────────────────── */}
        {step === 'bu' && (
          <div>
            {renderSelectOrCreate(bus, selectedBuId, setSelectedBuId, newBuName, setNewBuName, isNewBu, setIsNewBu, '사업부')}
            <button onClick={goNext} disabled={!selectedBuId && !newBuName}
              className="w-full mt-6 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              다음
            </button>
          </div>
        )}

        {/* ── Step: Team ────────────────────────────── */}
        {step === 'team' && (
          <div>
            {/* 선택된 BU 표시 */}
            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-xs text-gray-500">사업부</span>
                <p className="text-sm font-medium text-gray-900">
                  {isNewBu ? newBuName : bus.find(b => b.id === selectedBuId)?.name}
                </p>
              </div>
              <button onClick={goBack} className="text-xs text-primary-600 hover:underline">변경</button>
            </div>

            {renderSelectOrCreate(teams, selectedTeamId, setSelectedTeamId, newTeamName, setNewTeamName, isNewTeam, setIsNewTeam, '팀')}
            <button onClick={goNext} disabled={!selectedTeamId && !newTeamName}
              className="w-full mt-6 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              다음
            </button>
          </div>
        )}

        {/* ── Step: Group ───────────────────────────── */}
        {step === 'group' && (
          <div>
            {/* 상위 조직 요약 */}
            {!hasTeam && (
              <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="text-xs">
                    <span className="text-gray-500">사업부</span>
                    <span className="text-gray-800 font-medium ml-1">{isNewBu ? newBuName : bus.find(b => b.id === selectedBuId)?.name}</span>
                    <span className="text-gray-400 mx-1">/</span>
                    <span className="text-gray-500">팀</span>
                    <span className="text-gray-800 font-medium ml-1">{isNewTeam ? newTeamName : teams.find(t => t.id === selectedTeamId)?.name}</span>
                  </div>
                  <button onClick={goBack} className="text-xs text-primary-600 hover:underline">변경</button>
                </div>
              </div>
            )}

            {/* 팀 직속 옵션 */}
            <label className="flex items-center gap-2 mb-4 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                checked={isDirect}
                onChange={e => {
                  setIsDirect(e.target.checked);
                  if (e.target.checked) {
                    setSelectedGroupId(''); setNewGroupName(''); setIsNewGroup(false);
                    setSelectedPartId(''); setNewPartName(''); setIsNewPart(false);
                    setIsGroupDirect(false);
                  }
                }}
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-800">팀 직속</span>
                <p className="text-xs text-gray-500">하위 그룹/파트 없이 팀에 직속 소속</p>
              </div>
            </label>

            {!isDirect && renderSelectOrCreate(groups, selectedGroupId, setSelectedGroupId, newGroupName, setNewGroupName, isNewGroup, setIsNewGroup, '그룹')}

            <button onClick={goNext} disabled={!isDirect && !selectedGroupId && !newGroupName}
              className="w-full mt-6 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              {isDirect ? '다음 (역할 설정)' : '다음'}
            </button>
          </div>
        )}

        {/* ── Step: Part ────────────────────────────── */}
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
              <button onClick={goBack} className="text-xs text-primary-600 hover:underline">변경</button>
            </div>

            {/* 그룹 직속 옵션 */}
            <label className="flex items-center gap-2 mb-4 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                checked={isGroupDirect}
                onChange={e => {
                  setIsGroupDirect(e.target.checked);
                  if (e.target.checked) {
                    setSelectedPartId(''); setNewPartName(''); setIsNewPart(false);
                  }
                }}
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-800">그룹 직속</span>
                <p className="text-xs text-gray-500">하위 파트 없이 그룹에 직속 소속</p>
              </div>
            </label>

            {!isGroupDirect && renderSelectOrCreate(parts, selectedPartId, setSelectedPartId, newPartName, setNewPartName, isNewPart, setIsNewPart, '파트')}

            <button onClick={goNext} disabled={!isGroupDirect && !selectedPartId && !newPartName}
              className="w-full mt-6 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
              다음 (역할 설정)
            </button>
          </div>
        )}

        {/* ── Step: Role ────────────────────────────── */}
        {step === 'role' && (
          <div>
            {/* 조직 요약 */}
            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-xs text-gray-500 block mb-1">소속 조직</span>
              <p className="text-sm font-medium text-gray-900">
                {!hasTeam && (
                  <>
                    {isNewBu ? newBuName : bus.find(b => b.id === selectedBuId)?.name}
                    {' / '}
                    {isNewTeam ? newTeamName : teams.find(t => t.id === selectedTeamId)?.name}
                    {' / '}
                  </>
                )}
                {isDirect ? (
                  <span className="text-primary-600">팀 직속</span>
                ) : (
                  <>
                    {isNewGroup ? newGroupName : groups.find(g => g.id === selectedGroupId)?.name}
                    {' / '}
                    {isGroupDirect ? (
                      <span className="text-primary-600">그룹 직속</span>
                    ) : (
                      <>{isNewPart ? newPartName : parts.find(p => p.id === selectedPartId)?.name}</>
                    )}
                  </>
                )}
              </p>
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-2">부서장 역할 (선택)</label>
            <div className="space-y-2">
              {[
                { value: '', label: '일반 구성원', desc: '부서장이 아닙니다' },
                { value: 'BU', label: '사업부장', desc: '사업부 전체 관리 권한' },
                { value: 'TEAM', label: '팀장', desc: '팀 전체 관리 권한' },
                { value: 'GROUP', label: '그룹장', desc: '소속 그룹 관리 권한' },
                { value: 'PART', label: '파트장', desc: '소속 파트 관리 권한' },
              ].map(opt => (
                <label key={opt.value} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  adminRole === opt.value ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'
                }`}>
                  <input
                    type="radio"
                    name="adminRole"
                    value={opt.value}
                    checked={adminRole === opt.value}
                    onChange={e => setAdminRole(e.target.value)}
                    className="w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-800">{opt.label}</span>
                    <p className="text-xs text-gray-500">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={goBack}
                className="flex-1 py-3 border border-gray-300 text-gray-700 font-semibold rounded-xl hover:bg-gray-50 transition-all">
                이전
              </button>
              <button onClick={handleSubmit} disabled={loading}
                className="flex-1 py-3 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {loading ? '설정 중...' : '설정 완료'}
              </button>
            </div>
          </div>
        )}

        {/* 이전 버튼 (role 스텝 제외, role은 자체 이전 버튼) */}
        {step !== 'role' && currentStepIdx > 0 && (
          <button onClick={goBack}
            className="w-full mt-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
            이전 단계로
          </button>
        )}
      </div>
    </div>
  );
}
