import { create } from 'zustand';

export interface User {
  id: string;
  loginid: string;
  username: string;
  deptname: string;
  businessUnit: string;
  teamId: string | null;
  groupId: string | null;
  partId: string | null;
  teamName?: string | null;
  groupName?: string | null;
  partName?: string | null;
}

export interface VisibleScope {
  level: 'SUPER' | 'TEAM' | 'GROUP' | 'PART' | 'PERSONAL';
  editLevel: 'SUPER' | 'TEAM' | 'GROUP' | 'PART' | 'PERSONAL';
  teamId?: string;
  groupId?: string;
  partId?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isSuperAdmin: boolean;
  isTeamAdmin: boolean;
  needsOnboarding: boolean;
  visibleScope: VisibleScope | null;
  orgAdminLevels: Array<{ level: string; targetId: string }>;
  spaces: {
    personalSpaceId: string | null;
    teamSpaceId: string | null;
    teamId: string | null;
  };
  setUser: (user: User | null) => void;
  setIsLoading: (loading: boolean) => void;
  setAuth: (data: {
    user: User;
    isSuperAdmin: boolean;
    isTeamAdmin: boolean;
    needsOnboarding: boolean;
    spaces: { personalSpaceId: string | null; teamSpaceId: string | null; teamId: string | null };
    visibleScope?: VisibleScope;
    orgAdminLevels?: Array<{ level: string; targetId: string }>;
  }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isSuperAdmin: false,
  isTeamAdmin: false,
  needsOnboarding: false,
  visibleScope: null,
  orgAdminLevels: [],
  spaces: { personalSpaceId: null, teamSpaceId: null, teamId: null },

  setUser: (user) => set({ user }),
  setIsLoading: (isLoading) => set({ isLoading }),

  setAuth: (data) => set({
    user: data.user,
    isSuperAdmin: data.isSuperAdmin,
    isTeamAdmin: data.isTeamAdmin,
    needsOnboarding: data.needsOnboarding,
    spaces: data.spaces,
    visibleScope: data.visibleScope || null,
    orgAdminLevels: data.orgAdminLevels || [],
    isLoading: false,
  }),

  logout: () => {
    localStorage.removeItem('free_token');
    set({
      user: null,
      isSuperAdmin: false,
      isTeamAdmin: false,
      needsOnboarding: false,
      visibleScope: null,
      orgAdminLevels: [],
      spaces: { personalSpaceId: null, teamSpaceId: null, teamId: null },
    });
  },
}));
