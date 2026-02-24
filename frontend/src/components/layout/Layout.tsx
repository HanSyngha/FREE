import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../services/api';
import { useState, useEffect, useCallback, useRef } from 'react';
import { spacesApi } from '../../services/api';

export default function Layout() {
  const { user, isSuperAdmin, isTeamAdmin, logout } = useAuthStore();
  const navigate = useNavigate();
  const [sidebarData, setSidebarData] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    spacesApi.getTeam().then(res => {
      setSidebarData(res.data);
    }).catch(() => {});
  }, []);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    logout();
    navigate('/login');
  };

  // 실시간 시계 (KST, 분 단위 갱신)
  const [clock, setClock] = useState(() => {
    const now = new Date();
    return now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  });
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    // 다음 정각(분)에 맞춰 시작
    const msToNextMin = (60 - new Date().getSeconds()) * 1000;
    const timeout = setTimeout(() => {
      update();
      const interval = setInterval(update, 60_000);
      intervalRef.current = interval;
    }, msToNextMin);
    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ESC 키로 사이드바 닫기
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && sidebarOpen) {
      setSidebarOpen(false);
    }
  }, [sidebarOpen]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block px-3 py-2 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 ${
      isActive ? 'bg-primary-100 text-primary-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center px-6 justify-between fixed top-0 left-0 right-0 z-40">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 hover:bg-gray-100 rounded-lg" aria-label={sidebarOpen ? '사이드바 닫기' : '사이드바 열기'}>
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <NavLink to="/space/personal" className="flex items-center gap-2">
            <span className="text-xl font-bold text-primary-600">FREE</span>
            <span className="text-xs text-gray-400 hidden sm:block">Fast Report & Easy Evidence</span>
          </NavLink>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400 font-mono tabular-nums">{clock}</span>
          <NavLink to="/profile" className="text-sm text-gray-600 hover:text-gray-900">
            {user?.username} ({user?.loginid})
          </NavLink>
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-red-600" aria-label="로그아웃">
            로그아웃
          </button>
        </div>
      </header>

      <div className="flex pt-14">
        {/* Sidebar */}
        <aside
          className={`w-60 bg-white border-r border-gray-200 fixed top-14 bottom-0 left-0 overflow-y-auto p-4 z-30
            transition-transform duration-200 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
          role="navigation"
          aria-label="사이드바 네비게이션"
          aria-hidden={!sidebarOpen}
        >
            <nav className="space-y-1" aria-label="팀 구조 탐색">
              {/* 나의 업무 기록 */}
              <div className="mb-2">
                <NavLink to="/space/personal" className={navLinkClass}>
                  나의 업무 기록
                </NavLink>
                <NavLink to="/goals/dashboard" className={navLinkClass}>
                  목표 대시보드
                </NavLink>
              </div>

              {/* 사업부 → 팀 → 그룹 → 파트 트리 */}
              {sidebarData?.team && (
                <div className="mb-3">
                  {/* 사업부 */}
                  {sidebarData.team.businessUnit && (
                    <p className="text-[10px] font-semibold text-gray-400 uppercase px-3 pt-2 pb-1">
                      {sidebarData.team.businessUnit}
                    </p>
                  )}
                  {/* 팀 */}
                  <NavLink to="/space/team" className={({ isActive }) =>
                    `block px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 ${
                      isActive ? 'bg-primary-100 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
                    }`
                  }>
                    {sidebarData.team.name}
                  </NavLink>

                  {/* 그룹 → 파트 */}
                  {sidebarData.team.groups?.map((group: any) => {
                    const isMyGroup = user?.groupId === group.id;
                    return (
                      <div key={group.id} className="mt-1">
                        <NavLink to={`/space/group/${group.id}`} className={({ isActive }) =>
                          `block pl-6 pr-3 py-1.5 rounded-lg text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 ${
                            isActive ? 'bg-primary-100 text-primary-700 font-medium'
                              : isMyGroup ? 'text-primary-600 font-medium hover:bg-primary-50'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`
                        }>
                          {group.name}
                          {isMyGroup && <span className="ml-1 text-[10px] text-primary-400">내 그룹</span>}
                        </NavLink>
                        {group.parts?.map((part: any) => {
                          const isMyPart = user?.partId === part.id;
                          return (
                            <div key={part.id}>
                              <NavLink to={`/space/part/${part.id}`} className={({ isActive }) =>
                                `block pl-10 pr-3 py-1.5 rounded-lg text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 ${
                                  isActive ? 'bg-primary-50 text-primary-600 font-medium'
                                    : isMyPart ? 'text-primary-500 font-medium hover:bg-primary-50'
                                    : 'text-gray-500 hover:bg-gray-50'
                                }`
                              }>
                                {part.name}
                                {isMyPart && <span className="ml-1 text-[10px] text-primary-300">내 파트</span>}
                              </NavLink>
                              {part.users?.map((u: any) => {
                                const isMe = user?.id === u.id;
                                if (isMe) {
                                  return (
                                    <div key={u.id}
                                      onClick={() => navigate('/space/personal')}
                                      className="block pl-14 pr-3 py-1 rounded-lg text-[11px] text-primary-500 hover:bg-primary-50 cursor-pointer transition-colors"
                                    >
                                      {u.username}
                                      <span className="ml-1 text-[10px] text-primary-300">나</span>
                                    </div>
                                  );
                                }
                                return (
                                  <NavLink key={u.id} to={`/space/personal/${u.id}`} className={({ isActive }) =>
                                    `block pl-14 pr-3 py-1 rounded-lg text-[11px] transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 ${
                                      isActive ? 'bg-primary-50 text-primary-600 font-medium'
                                        : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                    }`
                                  }>
                                    {u.username}
                                  </NavLink>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Admin 메뉴 */}
              {(isSuperAdmin || isTeamAdmin) && (
                <div className="mt-6 pt-4 border-t border-gray-200">
                  <p className="text-xs font-semibold text-gray-400 uppercase mb-2 px-3">관리</p>
                  {(isTeamAdmin || isSuperAdmin) && (
                    <NavLink to="/admin/team" className={navLinkClass}>
                      팀 관리
                    </NavLink>
                  )}
                  {isSuperAdmin && (
                    <NavLink to="/admin/super" className={navLinkClass}>
                      시스템 관리
                    </NavLink>
                  )}
                </div>
              )}
            </nav>
        </aside>

        {/* Main Content */}
        <main className={`flex-1 min-h-screen p-6 pb-16 transition-all duration-200 ease-in-out ${sidebarOpen ? 'ml-60' : 'ml-0'}`}>
          <Outlet />
          <footer className="mt-12 pt-4 border-t border-gray-100 text-center text-[11px] text-gray-400">
            syngha.han 개인 프로젝트 &middot; 버그/문의:{' '}
            <a href="http://a2g.samsungds.net:4090/feedback" target="_blank" rel="noopener noreferrer"
              className="underline hover:text-gray-500">Feedback</a>
            {' '}또는 syngha.han
          </footer>
        </main>
      </div>
    </div>
  );
}
