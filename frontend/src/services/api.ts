/**
 * API Service - ONCE와 동일한 패턴
 */
import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || '';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('free_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - 401 → 자동 로그아웃 (토큰 만료/무효)
// 403은 권한 부족이므로 로그아웃하지 않음 (Super Admin 접근 시도 등)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/me');
    if (error.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('free_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ==================== Auth ====================
export const authApi = {
  me: () => api.get('/auth/me'),
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
};

// ==================== Onboarding ====================
export const onboardingApi = {
  getGroups: () => api.get('/onboarding/groups'),
  getParts: (groupId: string) => api.get('/onboarding/parts', { params: { groupId } }),
  setup: (data: { groupId?: string; groupName?: string; partId?: string; partName?: string }) =>
    api.post('/onboarding/setup', data),
  normalizeName: (name: string) => api.post('/onboarding/normalize-name', { name }),
};

// ==================== WorkLogs ====================
export const workLogsApi = {
  create: (text: string, date?: string) => api.post('/worklogs', { text, date }),
  update: (id: string, data: { title?: string; content?: string; link?: string; date?: string; linkedItemId?: string | null }) =>
    api.put(`/worklogs/${id}`, data),
  delete: (id: string) => api.delete(`/worklogs/${id}`),
};
export const itemsApi = workLogsApi; // 하위 호환

// ==================== Goals ====================
export const goalsApi = {
  create: (text: string, level: string, ownerId: string) =>
    api.post('/goals', { text, level, ownerId }),
  getAll: (params?: { level?: string; ownerId?: string; status?: string }) =>
    api.get('/goals', { params }),
  getById: (id: string) => api.get(`/goals/${id}`),
  update: (id: string, data: {
    title?: string; content?: string; status?: string;
    startDate?: string | null; endDate?: string | null;
    progress?: number; summary?: string;
  }) => api.put(`/goals/${id}`, data),
  delete: (id: string) => api.delete(`/goals/${id}`),
  updateMapping: (id: string, data: { parentItemId?: string | null; childItemIds?: string[] }) =>
    api.put(`/goals/${id}/mapping`, data),
};

// ==================== Todos ====================
export const todosApi = {
  getAll: (params?: { completed?: string }) => api.get('/todos', { params }),
  create: (data: { title: string; content?: string; startDate?: string; endDate?: string }) =>
    api.post('/todos', data),
  update: (id: string, data: {
    title?: string; content?: string; startDate?: string | null;
    endDate?: string | null; completed?: boolean; linkedItemId?: string | null;
  }) => api.patch(`/todos/${id}`, data),
  delete: (id: string) => api.delete(`/todos/${id}`),
};

// ==================== OrgAdmin ====================
export const orgAdminApi = {
  getAll: () => api.get('/org-admin'),
  create: (userId: string, level: string, targetId: string) =>
    api.post('/org-admin', { userId, level, targetId }),
  delete: (id: string) => api.delete(`/org-admin/${id}`),
};

// ==================== Spaces ====================
export const spacesApi = {
  getPersonal: () => api.get('/spaces/personal'),
  getPersonalUser: (userId: string) => api.get(`/spaces/personal/${userId}`),
  getPart: (partId: string) => api.get(`/spaces/part/${partId}`),
  getGroup: (groupId: string) => api.get(`/spaces/group/${groupId}`),
  getTeam: () => api.get('/spaces/team'),
  getBU: (buId: string) => api.get(`/spaces/bu/${buId}`),
};

// ==================== OrgWorkLog ====================
export const orgWorkLogApi = {
  getByGoal: (goalId: string) => api.get('/org-worklogs', { params: { goalId } }),
  update: (id: string, data: { content: string }) => api.put(`/org-worklogs/${id}`, data),
};

// ==================== Reports ====================
export const reportsApi = {
  getBySpace: (spaceId: string) => api.get(`/reports/space/${spaceId}`),
  getById: (id: string) => api.get(`/reports/${id}`),
  export: (id: string, format: 'docx' | 'xlsx') =>
    api.get(`/reports/${id}/export`, { params: { format }, responseType: 'blob' }),
  resume: () => api.post('/reports/resume'),
  delete: (id: string) => api.delete(`/reports/${id}`),
  generatePersonal: () => api.post('/reports/personal'),
};

// ==================== Admin ====================
export const adminApi = {
  getTeams: () => api.get('/admin/teams'),
  addTeamAdmin: (userId: string, teamId: string) =>
    api.post('/admin/team-admin', { userId, teamId }),
  removeTeamAdmin: (id: string) => api.delete(`/admin/team-admin/${id}`),
  triggerReport: (teamId?: string) => api.post('/admin/trigger-report', teamId ? { teamId } : {}),
  triggerProgress: (teamId?: string) => api.post('/admin/trigger-progress', teamId ? { teamId } : {}),
  getLLMOperations: () => api.get('/admin/llm-operations'),
  setLLMOperation: (operation: string, modelId: string) => api.put(`/admin/llm-operations/${operation}`, { modelId }),
  deleteLLMOperation: (operation: string) => api.delete(`/admin/llm-operations/${operation}`),
  createItems: (loginid: string, items: Array<{ title: string; content: string; date?: string }>) =>
    api.post('/admin/worklogs', { loginid, items }),
};

// ==================== Team Admin ====================
export const teamAdminApi = {
  getUsers: (params?: { groupId?: string; partId?: string }) =>
    api.get('/team-admin/users', { params }),
  getReportLogs: () => api.get('/team-admin/report-logs'),
};

// ==================== Rating ====================
export const ratingApi = {
  submit: (score: number) => api.post('/ratings', { score }),
  check: () => api.get('/ratings/check'),
  // Dashboard rating (ONCE 패턴)
  submitToDashboard: (modelName: string, rating: number) => {
    const user = useAuthStore.getState().user;
    return axios.post(`${DASHBOARD_URL}/api/rating`, {
      modelName, rating, serviceId: 'free',
    }, {
      headers: {
        'X-Service-Id': 'free',
        ...(user && {
          'X-User-Id': user.loginid,
          'X-User-Name': encodeURIComponent(user.username),
          'X-User-Dept': encodeURIComponent(user.deptname),
        }),
      },
    });
  },
};

// ==================== Profile ====================
export const profileApi = {
  get: () => api.get('/profile'),
  updateOrganization: (data: { groupId?: string; groupName?: string; partId?: string; partName?: string }) =>
    api.put('/profile/organization', data),
  getActivityLog: () => api.get('/profile/activity-log'),
  getPreferences: () => api.get('/profile/preferences'),
  updatePreferences: (data: {
    tone?: string;
    language?: string;
    emphasis?: string;
    customInstructions?: string;
  }) => api.put('/profile/preferences', data),
};

// ==================== Announcements ====================
export const announcementsApi = {
  get: () => api.get('/announcements/team'),
  create: (title: string, content: string) => api.post('/announcements/team', { title, content }),
  delete: () => api.delete('/announcements/team'),
};
