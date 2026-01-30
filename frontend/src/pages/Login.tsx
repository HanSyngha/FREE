/**
 * Login Page - ONCE와 동일한 SSO 플로우
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../services/api';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, setAuth, setIsLoading } = useAuthStore();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');

  // 이미 로그인 상태면 리다이렉트
  useEffect(() => {
    const token = localStorage.getItem('free_token');
    if (token && user) {
      navigate('/space/personal');
    }
  }, [user, navigate]);

  // SSO 콜백 처리 (ONCE와 동일)
  useEffect(() => {
    const data = searchParams.get('data');
    if (data) {
      handleSSOCallback(data);
    } else {
      checkExistingSession();
    }
  }, [searchParams]);

  const checkExistingSession = async () => {
    const token = localStorage.getItem('free_token');
    if (!token) { setIsLoading(false); return; }
    try {
      const response = await authApi.me();
      setAuth({
        user: response.data.user,
        isSuperAdmin: response.data.isSuperAdmin,
        isTeamAdmin: response.data.isTeamAdmin,
        needsOnboarding: response.data.needsOnboarding,
        spaces: response.data.spaces,
      });
      if (response.data.needsOnboarding) {
        navigate('/onboarding');
      } else {
        navigate('/space/personal');
      }
    } catch {
      localStorage.removeItem('free_token');
      setIsLoading(false);
    }
  };

  // SSO 콜백 (ONCE와 동일)
  const handleSSOCallback = async (dataString: string) => {
    setIsLoggingIn(true);
    setError('');
    try {
      const decodedData = decodeURIComponent(dataString);
      const ssoData = JSON.parse(decodedData);

      // Unicode-safe base64 토큰 생성 (ONCE와 동일)
      const jsonData = JSON.stringify({
        loginid: ssoData.loginid,
        username: ssoData.username,
        deptname: ssoData.deptname || '',
        timestamp: Date.now(),
      });
      const ssoToken = btoa(unescape(encodeURIComponent(jsonData)));

      const response = await authApi.login(`sso.${ssoToken}`);
      const { user: userData, sessionToken, isSuperAdmin, isTeamAdmin, needsOnboarding, spaces } = response.data;

      localStorage.setItem('free_token', sessionToken);
      setAuth({ user: userData, isSuperAdmin, isTeamAdmin, needsOnboarding, spaces });

      window.history.replaceState({}, '', window.location.pathname);

      if (needsOnboarding) {
        navigate('/onboarding');
      } else {
        navigate('/space/personal');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'SSO 인증 처리 중 오류가 발생했습니다.');
      setIsLoggingIn(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  const handleLogin = () => {
    const SSO_BASE_URL = import.meta.env.VITE_SSO_URL || 'https://genai.samsungds.net:36810';
    const redirectUrl = window.location.origin + window.location.pathname;
    const ssoUrl = new URL('/direct_sso', SSO_BASE_URL);
    ssoUrl.searchParams.set('redirect_url', redirectUrl);
    window.location.href = ssoUrl.toString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col">
      {/* Header */}
      <header className="h-16 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-primary-600">FREE</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          {/* Logo */}
          <div className="mb-8">
            <h1 className="text-5xl font-extrabold text-primary-600 mb-2">FREE</h1>
            <p className="text-lg text-gray-500">Fast Report & Easy Evidence</p>
          </div>

          {/* Description */}
          <p className="text-gray-600 mb-8 leading-relaxed">
            팀 단위 주간 보고를 자동화하는 서비스입니다.<br />
            업무 내용을 자유롭게 입력하면 AI가 자동으로 정리합니다.
          </p>

          {/* Features */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="p-3 rounded-xl bg-white shadow-sm border border-gray-100">
              <div className="text-2xl mb-1">AI</div>
              <p className="text-xs text-gray-500">자동 정리</p>
            </div>
            <div className="p-3 rounded-xl bg-white shadow-sm border border-gray-100">
              <div className="text-2xl mb-1">7D</div>
              <p className="text-xs text-gray-500">주간 보고서</p>
            </div>
            <div className="p-3 rounded-xl bg-white shadow-sm border border-gray-100">
              <div className="text-2xl mb-1">TM</div>
              <p className="text-xs text-gray-500">팀 협업</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Login Button */}
          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            aria-label="Samsung SSO로 로그인"
            className="w-full py-3.5 px-6 bg-primary-600 text-white font-semibold rounded-xl
                       hover:bg-primary-700 active:scale-[0.98] transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-500/25"
          >
            {isLoggingIn ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                로그인 중...
              </span>
            ) : (
              'SSO 로그인'
            )}
          </button>

          <p className="mt-6 text-xs text-gray-400">
            syngha.han 개인 프로젝트 &middot; 버그/문의:{' '}
            <a href="http://a2g.samsungds.net:4090/feedback" target="_blank" rel="noopener noreferrer"
              className="underline hover:text-gray-600">Feedback</a>
            {' '}또는 syngha.han
          </p>
        </div>
      </main>
    </div>
  );
}
