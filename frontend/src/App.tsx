import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './stores/authStore';
import { authApi } from './services/api';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import PersonalSpace from './pages/PersonalSpace';
import PersonalSpaceOther from './pages/PersonalSpaceOther';
import PartSpace from './pages/PartSpace';
import GroupSpace from './pages/GroupSpace';
import TeamSpace from './pages/TeamSpace';
import BUSpace from './pages/BUSpace';
import ReportDetail from './pages/ReportDetail';
import Profile from './pages/Profile';
import SuperAdmin from './pages/SuperAdmin';
import OrgAdmin from './pages/OrgAdmin';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { needsOnboarding } = useAuthStore();
  if (needsOnboarding) return <Navigate to="/onboarding" />;
  return <>{children}</>;
}

export default function App() {
  const { setAuth, setIsLoading, logout } = useAuthStore();

  useEffect(() => {
    const token = localStorage.getItem('free_token');
    if (!token) {
      setIsLoading(false);
      return;
    }
    authApi.me()
      .then((res) => {
        setAuth({
          user: res.data.user,
          isSuperAdmin: res.data.isSuperAdmin,
          isTeamAdmin: res.data.isTeamAdmin,
          orgAdminLevels: res.data.orgAdminLevels || [],
          needsOnboarding: res.data.needsOnboarding,
          spaces: res.data.spaces,
        });
      })
      .catch(() => {
        logout();
        setIsLoading(false);
      });
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding" element={
        <ProtectedRoute><Onboarding /></ProtectedRoute>
      } />
      <Route element={
        <ProtectedRoute>
          <OnboardingGuard>
            <Layout />
          </OnboardingGuard>
        </ProtectedRoute>
      }>
        <Route path="/space/personal" element={<PersonalSpace />} />
        <Route path="/space/personal/:userId" element={<PersonalSpaceOther />} />
        <Route path="/space/personal/:userId/:date" element={<PersonalSpaceOther />} />
        <Route path="/space/part/:partId" element={<PartSpace />} />
        <Route path="/space/group/:groupId" element={<GroupSpace />} />
        <Route path="/space/team" element={<TeamSpace />} />
        <Route path="/space/bu/:buId" element={<BUSpace />} />
        <Route path="/report/:id" element={<ReportDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin/org" element={<OrgAdmin />} />
        <Route path="/admin/super" element={<SuperAdmin />} />
        <Route path="/admin/team" element={<Navigate to="/admin/org" />} />
      </Route>
      <Route path="/" element={<Navigate to="/space/personal" />} />
      <Route path="*" element={<Navigate to="/space/personal" />} />
    </Routes>
  );
}
