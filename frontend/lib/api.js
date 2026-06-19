import { getSupabase } from './supabase';

const BASE = '/api';

async function getAuthHeader() {
  try {
    const { data: { session } } = await getSupabase().auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  } catch {
    return {};
  }
}

async function req(path, options = {}) {
  const authHeader = await getAuthHeader();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...options.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      // Don't hard-redirect here — middleware already redirects unauthenticated
      // requests to /login. A hard redirect here creates a loop for authenticated
      // users whose token the backend doesn't recognise yet (e.g. new accounts).
      throw new Error('Session expired. Please sign in again.');
    }
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    // Don't leak raw HTML (502 gateway pages, etc.) into the UI
    const isHtml = text.trimStart().startsWith('<');
    const msg = isHtml ? `Server error (${res.status})` : (text || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  health: () => req('/health'),

  // Settings
  getSettings: () => req('/settings'),
  updateSettings: (data) => req('/settings', { method: 'PATCH', body: JSON.stringify(data) }),

  // Review counts (for nav badges)
  getCounts: (profileId) => req(`/reviews/counts${profileId ? `?profile_id=${encodeURIComponent(profileId)}` : ''}`),

  // Profiles
  getProfiles: (userId) => req(`/profiles${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`),
  getProfile:  (id) => req(`/profiles/${id}`),
  createProfile: (data) => req('/profiles', { method: 'POST', body: JSON.stringify(data) }),
  updateProfile: (id, data) => req(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Resume upload (multipart — no Content-Type, browser sets boundary)
  uploadResume: async (profileId, file) => {
    const authHeader = await getAuthHeader();
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/profiles/${profileId}/resume`, {
      method: 'POST',
      body: fd,
      headers: authHeader,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      try { const j = JSON.parse(raw); throw new Error(j.detail || j.message || j.error || raw || `HTTP ${res.status}`); }
      catch (e) { if (e instanceof SyntaxError) throw new Error(raw || `HTTP ${res.status}`); throw e; }
    }
    return res.json();
  },

  // Jobs & scored matches — returns { jobs, total, offset, limit }
  getJobs: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries({ limit: 10, offset: 0, ...params }).filter(([, v]) => v != null && v !== '')
    ).toString();
    return req(`/jobs?${qs}`);
  },
  getMatches: (status, profileId) => {
    const p = new URLSearchParams();
    if (status && status !== 'all') p.set('status', status);
    if (profileId) p.set('profile_id', profileId);
    const qs = p.toString();
    return req(`/matches${qs ? '?' + qs : ''}`);
  },
  getPipeline: (profileId) => req(`/pipeline${profileId ? `?profile_id=${encodeURIComponent(profileId)}` : ''}`),
  getDashboard: (profileId) => req(`/dashboard${profileId ? `?profile_id=${encodeURIComponent(profileId)}` : ''}`),

  // Applications
  getApplications: (status, profileId) => {
    const p = new URLSearchParams();
    if (status && status !== 'all') p.set('status', status);
    if (profileId) p.set('profile_id', profileId);
    const qs = p.toString();
    return req(`/applications${qs ? '?' + qs : ''}`);
  },
  submitApplication: (jobId) => req(`/applications/${jobId}/submit`, { method: 'POST', body: '{}' }),

  // Human-in-the-loop reviews
  getReviews: (type, status = 'pending') =>
    req(`/reviews${type ? `?review_type=${type}&status=${status}` : `?status=${status}`}`),
  reviewMatch: (jobId, data) =>
    req(`/reviews/${jobId}/match`, { method: 'POST', body: JSON.stringify(data) }),
  reviewApplication: (jobId, data) =>
    req(`/reviews/${jobId}/application`, { method: 'POST', body: JSON.stringify(data) }),

  // Events
  getEvents: (limit = 60) => req(`/events?limit=${limit}`),

  // Google Forms filler
  analyzeForms: (data) => req('/forms/analyze', { method: 'POST', body: JSON.stringify(data) }),
  submitForm:   (data) => req('/forms/submit',  { method: 'POST', body: JSON.stringify(data) }),
  getFormSubmissions: (limit = 50) => req(`/forms/submissions?limit=${limit}`),

  // Run triggers
  runDiscovery:   (data) => req('/run/discovery',  { method: 'POST', body: JSON.stringify(data) }),
  runMatching:    (data) => req('/run/matching',   { method: 'POST', body: JSON.stringify(data) }),
  runTailoring:   () =>     req('/run/tailoring',  { method: 'POST', body: '{}' }),
  runApplication: () =>     req('/run/application',{ method: 'POST', body: '{}' }),
  runAll:         (data) => req('/run/all',        { method: 'POST', body: JSON.stringify(data) }),

  // Integrations status
  getIntegrationsStatus: (userId) => req(`/integrations/status?user_id=${encodeURIComponent(userId)}`),

  // WhatsApp sidecar (proxied through FastAPI to avoid CORS)
  getWhatsAppStatus: (userId) => req(`/whatsapp/status?user_id=${encodeURIComponent(userId)}`),
  getWhatsAppQr:     (userId) => req(`/whatsapp/qr?user_id=${encodeURIComponent(userId)}`),
  logoutWhatsApp:    (userId) => req(`/whatsapp/logout?user_id=${encodeURIComponent(userId)}`, { method: 'POST', body: '{}' }),

  // Gmail OAuth
  getGmailStatus:    (userId) => req(`/auth/gmail/status?user_id=${encodeURIComponent(userId)}`),
  getGmailConnectUrl:(userId) => req(`/auth/gmail/connect?user_id=${encodeURIComponent(userId)}`),
  disconnectGmail:   (userId) => req(`/auth/gmail/disconnect?user_id=${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  scanGmail:         (data) =>  req('/gmail/scan', { method: 'POST', body: JSON.stringify(data) }),

  // Email drafts
  getEmailDrafts:     (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
    return req(`/email-drafts${qs ? '?' + qs : ''}`);
  },
  getEmailDraft:      (id) =>        req(`/email-drafts/${id}`),
  updateEmailDraft:   (id, data) =>  req(`/email-drafts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  approveEmailDraft:  (id) =>        req(`/email-drafts/${id}/approve`,  { method: 'POST', body: '{}' }),
  rejectEmailDraft:   (id) =>        req(`/email-drafts/${id}/reject`,   { method: 'POST', body: '{}' }),
  generateEmailDraft: (id) =>        req(`/email-drafts/${id}/generate`, { method: 'POST', body: '{}' }),
  createDraftFromUrl: (url, userId) =>
    req(`/email-drafts/from-url?url=${encodeURIComponent(url)}&user_id=${encodeURIComponent(userId)}`, {
      method: 'POST', body: '{}',
    }),
};
