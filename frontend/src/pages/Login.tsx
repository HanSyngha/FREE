/**
 * Login Page - OAuth 로그인
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api, authApi } from '../services/api';

const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || '';

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

  // OAuth 콜백 처리 (?token= from redirect)
  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      handleOAuthCallback(token);
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

  // OAuth 콜백: Dashboard JWT를 받아 로컬 JWT로 교환
  const handleOAuthCallback = async (dashboardToken: string) => {
    setIsLoggingIn(true);
    setError('');
    try {
      // Dashboard JWT → 로컬 JWT 교환
      const exchangeRes = await api.post('/auth/exchange', { dashboardToken });
      const { token, user: exchangedUser } = exchangeRes.data;

      localStorage.setItem('free_token', token);

      // 사용자 정보 조회
      const response = await authApi.me();
      setAuth({
        user: response.data.user,
        isSuperAdmin: response.data.isSuperAdmin,
        isTeamAdmin: response.data.isTeamAdmin,
        needsOnboarding: response.data.needsOnboarding,
        spaces: response.data.spaces,
      });

      window.history.replaceState({}, '', window.location.pathname);

      if (response.data.needsOnboarding) {
        navigate('/onboarding');
      } else {
        navigate('/space/personal');
      }
    } catch (err: any) {
      localStorage.removeItem('free_token');
      setError(err.response?.data?.error || 'OAuth 인증 처리 중 오류가 발생했습니다.');
      setIsLoggingIn(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  // OAuth 로그인 시작 - Dashboard에 위임
  const handleOAuthLogin = (provider: 'naver' | 'kakao' | 'google') => {
    setIsLoggingIn(true);
    const redirectUrl = window.location.origin + window.location.pathname;
    window.location.href = `${DASHBOARD_URL}/api/auth/${provider}/login?redirect=${encodeURIComponent(redirectUrl)}`;
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
            <p className="text-sm text-primary-400 mt-1 font-medium">주간보고에서 해방!</p>
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

          {/* OAuth Login Buttons */}
          <div className="space-y-3">
            <p className="text-sm text-gray-400 mb-2">간편 로그인</p>

            {/* Naver */}
            <button
              onClick={() => handleOAuthLogin('naver')}
              disabled={isLoggingIn}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5
                         bg-[#03C75A] hover:bg-[#02b351] text-white
                         rounded-xl font-medium text-sm
                         shadow-sm hover:shadow-md transition-all duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727v12.845z"/>
              </svg>
              <span>Naver 로그인</span>
            </button>

            {/* Kakao */}
            <button
              onClick={() => handleOAuthLogin('kakao')}
              disabled={isLoggingIn}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5
                         bg-[#FEE500] hover:bg-[#F5DC00] text-[#191919]
                         rounded-xl font-medium text-sm
                         shadow-sm hover:shadow-md transition-all duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3C6.477 3 2 6.463 2 10.691c0 2.726 1.8 5.127 4.5 6.49-.198.742-.716 2.69-.82 3.108-.127.51.187.503.393.366.162-.108 2.575-1.75 3.616-2.458.746.104 1.514.159 2.311.159 5.523 0 10-3.463 10-7.691C22 6.463 17.523 3 12 3z"/>
              </svg>
              <span>Kakao 로그인</span>
            </button>

            {/* Google */}
            <button
              onClick={() => handleOAuthLogin('google')}
              disabled={isLoggingIn}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5
                         bg-white hover:bg-gray-50 text-gray-700
                         border border-gray-300
                         rounded-xl font-medium text-sm
                         shadow-sm hover:shadow-md transition-all duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span>Google 로그인</span>
            </button>

            {isLoggingIn && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <div className="w-4 h-4 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" />
                <span className="text-sm text-gray-500">로그인 중...</span>
              </div>
            )}
          </div>

          <p className="mt-6 text-xs text-gray-400">
            syngha.han 개인 프로젝트
          </p>
        </div>
      </main>
    </div>
  );
}
