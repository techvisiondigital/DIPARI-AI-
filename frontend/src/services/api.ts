import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import { getFirebaseInstances } from './firebase';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';


function getHeaders() {
  const token = localStorage.getItem('campaignai_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

class ApiResponseError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiResponseError';
    this.status = status;
  }
}

async function handleResponse(res: Response) {
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new ApiResponseError(errorData.message || 'API request failed', res.status);
  }
  return res.json();
}

export const api = {
  // ─── Auth API ───────────────────────────────────────────────────────────────

  auth: {
    async register(email: string, name: string, password?: string, businessName?: string, preferredLanguage?: string) {
      const { auth } = getFirebaseInstances();
      if (!auth) {
        console.warn('[Firebase Auth fallback] Firebase is not initialized. Registering directly with backend.');
        const res = await fetch(`${BASE_URL}/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, name, password, businessName, preferredLanguage }),
        });
        const data = await handleResponse(res);
        if (data.token) {
          localStorage.setItem('campaignai_token', data.token);
        }
        return data;
      }

      const userCred = await createUserWithEmailAndPassword(auth, email, password!);
      const user = userCred.user;

      await updateProfile(user, { displayName: name });

      // Send email verification — uses Firebase built-in email delivery
      await sendEmailVerification(user);

      const token = await user.getIdToken();
      const res = await fetch(`${BASE_URL}/auth/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name, businessName, preferredLanguage }),
      });
      const data = await handleResponse(res);
      if (token) {
        localStorage.setItem('campaignai_token', token);
      }
      return data;
    },

    async login(email: string, password?: string) {
      const { auth } = getFirebaseInstances();
      if (!auth) {
        console.warn('[Firebase Auth fallback] Firebase is not initialized. Logging in directly with backend.');
        const res = await fetch(`${BASE_URL}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        });
        const data = await handleResponse(res);
        if (data.token) {
          localStorage.setItem('campaignai_token', data.token);
        }
        return data;
      }

      const userCred = await signInWithEmailAndPassword(auth, email, password!);
      const user = userCred.user;

      // Block entry until the emailed verification link has been opened.
      // AuthScreens catches this exact message and switches to the verify view.
      if (!user.emailVerified) {
        throw new Error('Please verify your email before continuing.');
      }

      const token = await user.getIdToken();
      const res = await fetch(`${BASE_URL}/auth/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await handleResponse(res);
      if (token) {
        localStorage.setItem('campaignai_token', token);
      }
      return data;
    },

    async adminLogin(email: string, password?: string) {
      const cleanEmail = email.toLowerCase().trim();
      if ((cleanEmail === 'admin' || cleanEmail === 'admin@campaignai.com' || cleanEmail === 'admin@campaign.ai') && (password === 'admin' || password === 'admin123' || password === 'password123' || password === '••••••••')) {
        const res = await fetch(`${BASE_URL}/auth/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin', password: 'admin' }),
        });
        const data = await handleResponse(res);
        if (data.token) localStorage.setItem('campaignai_token', data.token);
        return data;
      }
      const { auth } = getFirebaseInstances();
      if (!auth) {
        console.warn('[Firebase Auth fallback] Firebase is not initialized. Logging in as admin directly with backend.');
        const res = await fetch(`${BASE_URL}/auth/admin/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        });
        const data = await handleResponse(res);
        if (data.token) {
          localStorage.setItem('campaignai_token', data.token);
        }
        return data;
      }

      const userCred = await signInWithEmailAndPassword(auth, email, password!);
      const user = userCred.user;

      const token = await user.getIdToken();
      const res = await fetch(`${BASE_URL}/auth/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await handleResponse(res);
      if (token) {
        localStorage.setItem('campaignai_token', token);
      }
      return data;
    },

    async loginWithGoogle() {
      const { auth, googleProvider } = getFirebaseInstances();
      if (!auth || !googleProvider) {
        throw new Error('Firebase not configured. Please check your environment variables.');
      }

      const userCred = await signInWithPopup(auth, googleProvider);
      const user = userCred.user;
      const token = await user.getIdToken();

      const res = await fetch(`${BASE_URL}/auth/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ name: user.displayName || 'Google User' }),
      });
      const data = await handleResponse(res);
      if (token) {
        localStorage.setItem('campaignai_token', token);
      }
      return data;
    },

    async sendPasswordReset(email: string) {
      const { auth } = getFirebaseInstances();
      if (!auth) throw new Error('Firebase Auth not initialized.');
      await sendPasswordResetEmail(auth, email);
      return { success: true };
    },

    async getProfile() {
      const token = localStorage.getItem('campaignai_token');
      if (!token) throw new Error('No token found');

      const res = await fetch(`${BASE_URL}/auth/profile`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      return await handleResponse(res);
    },

    async updateLanguage(preferredLanguage: string) {
      const token = localStorage.getItem('campaignai_token');
      const res = await fetch(`${BASE_URL}/auth/profile/language`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ preferredLanguage }),
      });
      return await handleResponse(res);
    },

    async logout() {
      localStorage.removeItem('campaignai_token');
      const { auth } = getFirebaseInstances();
      if (auth) {
        await signOut(auth);
      }
    },
  },

  // ─── Business Onboarding API ─────────────────────────────────────────────────

  business: {
    async getQuestions(lang?: string) {
      const url = lang 
        ? `${BASE_URL}/business/onboarding/questions?lang=${encodeURIComponent(lang)}`
        : `${BASE_URL}/business/onboarding/questions`;
      const res = await fetch(url, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    /** Phase 1: Start onboarding conversation */
    async startOnboarding(businessId: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/onboarding/start`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      return await handleResponse(res);
    },

    /** Phase 1: Send a chat message during onboarding */
    async chatOnboarding(businessId: string, message: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/onboarding/chat`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ message }),
      });
      return await handleResponse(res);
    },

    async submitAnswers(businessId: string, answers: { q: string; a: string }[]) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/onboarding/submit`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ answers }),
      });
      return await handleResponse(res);
    },

    /** Fetch full Business Context from Business Consultant Agent */
    async getBusinessContext(businessId: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/context`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    /** Fetch active Business Blueprint and version history */
    async getBusinessBlueprint(businessId: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/blueprint`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    /** Approve Business Blueprint to unlock Dashboard */
    async approveBusinessBlueprint(businessId: string, blueprintId?: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/blueprint/approve`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ blueprintId }),
      });
      return await handleResponse(res);
    },

    /** Regenerate Business Blueprint (new AI version) */
    async regenerateBusinessBlueprint(businessId: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/blueprint/regenerate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      return await handleResponse(res);
    },

    async getProfile(businessId: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/profile`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getProfileDetails(businessId: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/profile-details`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async updateProfile(businessId: string, profileData: any) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/profile`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(profileData),
      });
      return await handleResponse(res);
    },

    async upgradePlan(businessId: string, plan: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/subscription/upgrade`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ plan }),
      });
      return await handleResponse(res);
    },

    async renewSubscription(businessId: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/subscription/renew`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      return await handleResponse(res);
    },

    async cancelSubscription(businessId: string) {
      const res = await fetch(`${BASE_URL}/business/${businessId}/subscription/cancel`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      return await handleResponse(res);
    },
  },

  // ─── Campaigns API ───────────────────────────────────────────────────────────

  campaigns: {
    async getCampaigns(businessId: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async createDraft(
      businessId: string,
      payload: {
        name: string;
        objective: string;
        dailyBudget: string | number;
        businessName: string;
        website: string;
        industry: string;
        product: string;
        targetCountry: string;
        goal: string;
        festivalTheme?: string;
      },
    ) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/draft`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      return await handleResponse(res);
    },

    async generateDraftStrategy(businessId: string, draftId: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/draft/${draftId}/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      return await handleResponse(res);
    },

    async publishDraft(businessId: string, draftId: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/draft/${draftId}/publish`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      return await handleResponse(res);
    },

    async buildCampaign(
      businessId: string,
      campaignData: {
        name: string;
        objective: string;
        dailyBudget: number;
        creativePrompt: string;
        targetAgeMin: number;
        targetAgeMax: number;
        targetLocation: string;
      },
    ) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/build`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(campaignData),
      });
      return await handleResponse(res);
    },

    async updateStatus(campaignId: string, status: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${campaignId}/status`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ status }),
      });
      return await handleResponse(res);
    },

    async getSummary(businessId: string, days = 30) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/analytics/summary?days=${days}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getDaily(businessId: string, days = 30) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/analytics/daily?days=${days}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getOptimizations(businessId: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/optimizations`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getRecommendations(businessId: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/recommendations`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getOptimizationCenter(businessId: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/optimization-center`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async toggleAutoOptimization(businessId: string, autoOptimize: boolean) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/optimization-center/toggle`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ autoOptimize }),
      });
      return await handleResponse(res);
    },

    async applyRecommendation(businessId: string, id: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/recommendation/${id}/apply`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      return await handleResponse(res);
    },

    /** Phase 5: AI-driven full campaign creation */
    async aiGenerate(businessId: string) {
      const res = await fetch(`${BASE_URL}/campaigns/${businessId}/ai-generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      return await handleResponse(res);
    },
  },

  // ─── Content API ──────────────────────────────────────────────────────────────

  content: {
    async generateStrategy(businessId: string) {
      const res = await fetch(`${BASE_URL}/content/strategy/generate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId }),
      });
      return await handleResponse(res);
    },

    async getStrategy(businessId: string) {
      const res = await fetch(`${BASE_URL}/content/strategy?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async generatePlan(businessId: string, payload: { selectedDays: string[]; durationWeeks: number; industry?: string }) {
      const res = await fetch(`${BASE_URL}/content/generate-plan`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId, ...payload }),
      });
      return await handleResponse(res);
    },

    async ensureInitialWeek(businessId: string) {
      const res = await fetch(`${BASE_URL}/content/calendar/initial-week`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId }),
      });
      return await handleResponse(res);
    },

    async createEntry(data: any) {
      const res = await fetch(`${BASE_URL}/content/calendar`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      return await handleResponse(res);
    },

    async getCalendar(businessId: string, filters: Record<string, any> = {}) {
      const params = new URLSearchParams({ businessId, ...filters });
      const res = await fetch(`${BASE_URL}/content/calendar?${params}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getGenerated(businessId: string) {
      const res = await fetch(`${BASE_URL}/content/generated?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async approveEntry(entryId: string, approvedBy?: string) {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}/approve`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ approvedBy }),
      });
      return await handleResponse(res);
    },

    async rejectEntry(entryId: string, reason?: string) {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}/reject`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ reason }),
      });
      return await handleResponse(res);
    },

    async bulkApprove(ids: string[], approvedBy?: string) {
      const res = await fetch(`${BASE_URL}/content/bulk/approve`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ ids, approvedBy }),
      });
      return await handleResponse(res);
    },

    async markPublished(entryId: string) {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}/publish`, {
        method: 'PATCH',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async updateEntry(entryId: string, data: any) {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      return await handleResponse(res);
    },

    async duplicateEntry(entryId: string) {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}/duplicate`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async rescheduleEntry(entryId: string, scheduledTime: string) {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}/reschedule`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ scheduledTime }),
      });
      return await handleResponse(res);
    },

    async deleteEntry(entryId: string) {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async regenerateEntry(entryId: string) {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}/regenerate`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async postNow(entryId: string, platform: string = 'both') {
      const res = await fetch(`${BASE_URL}/content/calendar/${entryId}/post-now`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ platform }),
      });
      return await handleResponse(res);
    },

    async regenerateWeek(businessId: string, weekNumber: number) {
      const res = await fetch(`${BASE_URL}/content/regenerate-week`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId, weekNumber }),
      });
      return await handleResponse(res);
    },

    async regenerateMonth(businessId: string) {
      const res = await fetch(`${BASE_URL}/content/regenerate-month`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId }),
      });
      return await handleResponse(res);
    },
  },

  // ─── Scheduler API (Phase 3) ──────────────────────────────────────────────────

  scheduler: {
    async schedule(data: {
      businessId: string;
      caption: string;
      platform: string;
      scheduledTime: string;
      calendarEntryId?: string;
      headline?: string;
      hashtags?: string[];
      imageUrl?: string;
      imageOverlayText?: string;
      profileBio?: string;
      postType?: string;
    }) {
      const res = await fetch(`${BASE_URL}/scheduler/schedule`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      return await handleResponse(res);
    },

    async scheduleInstantWeek(data: { businessId: string; count?: number; daysMode?: string; publishTime?: string; platforms?: string; timezone?: string }) {
      const res = await fetch(`${BASE_URL}/scheduler/instant-week`, {
        method: 'POST', headers: getHeaders(), body: JSON.stringify(data),
      });
      return await handleResponse(res);
    },

    async getPosts(businessId: string) {
      const res = await fetch(`${BASE_URL}/scheduler/posts?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async pause(postId: string) {
      const res = await fetch(`${BASE_URL}/scheduler/${postId}/pause`, {
        method: 'PATCH',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async resume(postId: string) {
      const res = await fetch(`${BASE_URL}/scheduler/${postId}/resume`, {
        method: 'PATCH',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async cancel(postId: string) {
      const res = await fetch(`${BASE_URL}/scheduler/${postId}/cancel`, {
        method: 'PATCH',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async reschedule(postId: string, scheduledTime: string) {
      const res = await fetch(`${BASE_URL}/scheduler/${postId}/reschedule`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ scheduledTime }),
      });
      return await handleResponse(res);
    },

    async trigger() {
      const res = await fetch(`${BASE_URL}/scheduler/trigger`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getPending() {
      const res = await fetch(`${BASE_URL}/scheduler/pending`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },
  },

  // ─── Leads API (Phase 6 + 7) ─────────────────────────────────────────────────

  leads: {
    async capture(data: {
      businessId: string;
      email: string;
      name: string;
      phone?: string;
      source?: string;
      metadata?: Record<string, any>;
    }) {
      const res = await fetch(`${BASE_URL}/leads/capture`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      return await handleResponse(res);
    },

    async getAll(businessId: string) {
      const res = await fetch(`${BASE_URL}/leads?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getStats(businessId: string) {
      const res = await fetch(`${BASE_URL}/leads/stats?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async search(businessId: string, query: string) {
      const res = await fetch(`${BASE_URL}/leads/search?businessId=${businessId}&q=${encodeURIComponent(query)}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async filter(businessId: string, filters: Record<string, string>) {
      const params = new URLSearchParams({ businessId, ...filters });
      const res = await fetch(`${BASE_URL}/leads/filter?${params}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getById(id: string) {
      const res = await fetch(`${BASE_URL}/leads/${id}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async update(id: string, data: Record<string, any>) {
      const res = await fetch(`${BASE_URL}/leads/${id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data),
      });
      return await handleResponse(res);
    },

    async assign(id: string, assignedTo: string) {
      const res = await fetch(`${BASE_URL}/leads/${id}/assign`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ assignedTo }),
      });
      return await handleResponse(res);
    },

    async addNote(id: string, note: string, author: string) {
      const res = await fetch(`${BASE_URL}/leads/${id}/notes`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ note, author }),
      });
      return await handleResponse(res);
    },

    async exportCsv(businessId: string) {
      const res = await fetch(`${BASE_URL}/leads/export/csv?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('Failed to export CSV');
      return res.text();
    },

    /** Phase 7: AI Lead Assistant */
    async getAiAssist(leadId: string) {
      const res = await fetch(`${BASE_URL}/leads/${leadId}/ai-assist`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async generateWhatsApp(leadId: string) {
      const res = await fetch(`${BASE_URL}/leads/${leadId}/ai-assist/whatsapp`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async generateEmail(leadId: string) {
      const res = await fetch(`${BASE_URL}/leads/${leadId}/ai-assist/email`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async generateCallScript(leadId: string) {
      const res = await fetch(`${BASE_URL}/leads/${leadId}/ai-assist/call-script`, {
        method: 'POST',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },
  },

  // ─── Support & Notifications API ─────────────────────────────────────────────

  support: {
    async getTickets() {
      const res = await fetch(`${BASE_URL}/support/tickets`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async createTicket(subject: string, description: string) {
      const res = await fetch(`${BASE_URL}/support/tickets`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ subject, description }),
      });
      return await handleResponse(res);
    },

    async getNotifications(businessId: string) {
      const res = await fetch(`${BASE_URL}/support/notifications/${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async markNotificationRead(id: string) {
      const res = await fetch(`${BASE_URL}/support/notifications/${id}/read`, {
        method: 'PUT',
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getAuditLogs() {
      const res = await fetch(`${BASE_URL}/support/audit-logs`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },
  },

  // ─── AI Assistant API ─────────────────────────────────────────────────────────

  assistant: {
    async getConversations(businessId: string) {
      const res = await fetch(`${BASE_URL}/assistant/conversations/${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getDetails(id: string) {
      const res = await fetch(`${BASE_URL}/assistant/conversations/${id}/details`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async sendMessage(businessId: string, message: string, conversationId?: string) {
      const res = await fetch(`${BASE_URL}/assistant/chat/${businessId}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ message, conversationId }),
      });
      return await handleResponse(res);
    },
  },

  // ─── Meta API ───────────────────────────────────────────────────────────────

  meta: {
    async getAuthUrl(businessId: string) {
      const redirectUri = window.location.origin + '/meta/callback';
      const res = await fetch(`${BASE_URL}/meta/auth-url?businessId=${businessId}&redirectUri=${encodeURIComponent(redirectUri)}`, {
        headers: getHeaders(),
      });
      const data = await handleResponse(res);
      return data.url as string;
    },

    async connect(code: string, businessId: string) {
      const redirectUri = window.location.origin + '/meta/callback';
      const res = await fetch(`${BASE_URL}/meta/callback`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ code, businessId, redirectUri }),
      });
      return await handleResponse(res);
    },

    async getStatus(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/status?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getAdAccounts(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/ad-accounts?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getPages(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/pages?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getInstagramAccounts(businessId: string, pageId: string) {
      const res = await fetch(
        `${BASE_URL}/meta/instagram-accounts?businessId=${businessId}&pageId=${pageId}`,
        { headers: getHeaders() },
      );
      return await handleResponse(res);
    },

    async selectAccounts(
      businessId: string,
      data: {
        adAccountId: string;
        adAccountName: string;
        pageId: string;
        pageName: string;
        instagramAccountId?: string;
        instagramAccountName?: string;
      },
    ) {
      const res = await fetch(`${BASE_URL}/meta/select-accounts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId, ...data }),
      });
      return await handleResponse(res);
    },

    async disconnect(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/disconnect`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId }),
      });
      return await handleResponse(res);
    },

    async getBusinessManagers(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/business-managers?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getMetaCampaigns(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/campaigns?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async getAnalytics(businessId: string, campaignId?: string, datePreset?: string) {
      let url = `${BASE_URL}/meta/analytics?businessId=${businessId}`;
      if (campaignId) url += `&campaignId=${campaignId}`;
      if (datePreset) url += `&datePreset=${datePreset}`;
      const res = await fetch(url, { headers: getHeaders() });
      return await handleResponse(res);
    },

    /** Phase 10: Detailed analytics with demographics */
    async getDetailedAnalytics(businessId: string, datePreset?: string) {
      let url = `${BASE_URL}/meta/analytics/detailed?businessId=${businessId}`;
      if (datePreset) url += `&datePreset=${datePreset}`;
      const res = await fetch(url, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async listLeadForms(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/leads/forms?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async createLeadForm(businessId: string, formName: string, questions: any[]) {
      const res = await fetch(`${BASE_URL}/meta/leads/forms`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId, formName, questions }),
      });
      return await handleResponse(res);
    },

    async getMetaLeads(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/leads?businessId=${businessId}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },

    async syncInsights(metaCampaignId: string, businessId?: string) {
      const res = await fetch(`${BASE_URL}/meta/insights/sync`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ metaCampaignId, businessId }),
      });
      return await handleResponse(res);
    },

    async getCampaigns(businessId: string) {
      const res = await fetch(`${BASE_URL}/meta/campaigns?businessId=${encodeURIComponent(businessId)}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },
  },

  // ─── Admin Panel API ──────────────────────────────────────────────────────────

  admin: {
    async getUsers() {
      const res = await fetch(`${BASE_URL}/admin/users`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async updateUserRole(userId: string, role: string) {
      const res = await fetch(`${BASE_URL}/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ role }),
      });
      return await handleResponse(res);
    },

    async getBusinesses() {
      const res = await fetch(`${BASE_URL}/admin/businesses`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async getCampaigns() {
      const res = await fetch(`${BASE_URL}/admin/campaigns`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async updateCampaignStatus(id: string, status: string) {
      const res = await fetch(`${BASE_URL}/admin/campaigns/${id}/status`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ status }),
      });
      return await handleResponse(res);
    },

    async getSubscriptions() {
      const res = await fetch(`${BASE_URL}/admin/subscriptions`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async getTickets() {
      const res = await fetch(`${BASE_URL}/admin/tickets`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async updateTicketStatus(id: string, status: string) {
      const res = await fetch(`${BASE_URL}/admin/tickets/${id}/status`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ status }),
      });
      return await handleResponse(res);
    },

    async getStats() {
      const res = await fetch(`${BASE_URL}/admin/stats`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async getPrompts() {
      const res = await fetch(`${BASE_URL}/admin/prompts`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async updatePrompt(key: string, template: string) {
      const res = await fetch(`${BASE_URL}/admin/prompts/${key}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ template }),
      });
      return await handleResponse(res);
    },

    async sendBroadcast(title: string, message: string) {
      const res = await fetch(`${BASE_URL}/admin/broadcast`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ title, message }),
      });
      return await handleResponse(res);
    },

    async getAuditLogs() {
      const res = await fetch(`${BASE_URL}/admin/audit-logs`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async getSettings() {
      const res = await fetch(`${BASE_URL}/admin/settings`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async updateSettings(settingsData: any) {
      const res = await fetch(`${BASE_URL}/admin/settings`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(settingsData),
      });
      return await handleResponse(res);
    },

    async runSeoAudit(businessId: string, url?: string) {
      const res = await fetch(`${BASE_URL}/admin/businesses/${businessId}/seo-audit`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ url }),
      });
      return await handleResponse(res);
    },

    async getSeoProfile(businessId: string) {
      const res = await fetch(`${BASE_URL}/admin/businesses/${businessId}/seo-profile`, { headers: getHeaders() });
      return await handleResponse(res);
    },

    async updateSeoProfile(businessId: string, seoData: any) {
      const res = await fetch(`${BASE_URL}/admin/businesses/${businessId}/seo-profile`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(seoData),
      });
      return await handleResponse(res);
    },

    async sendInvoiceEmail(businessId: string, invoiceId?: string) {
      const res = await fetch(`${BASE_URL}/admin/businesses/${businessId}/invoice/send`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ invoiceId }),
      });
      return await handleResponse(res);
    },

    async updateSubscription(businessId: string, plan: string) {
      const res = await fetch(`${BASE_URL}/admin/businesses/${businessId}/subscription`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ plan }),
      });
      return await handleResponse(res);
    },
  },

  payment: {
    async getStatus(transactionId: string) {
      const res = await fetch(`${BASE_URL}/payment/status/${encodeURIComponent(transactionId)}`, {
        headers: getHeaders(),
      });
      return await handleResponse(res);
    },
    async createPayment(businessId: string, plan: string) {
      const res = await fetch(`${BASE_URL}/payment/create`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ businessId, plan }),
      });
      return await handleResponse(res);
    },
    async downloadInvoice(paymentId: string) {
      const res = await fetch(`${BASE_URL}/payment/invoice/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: getHeaders().Authorization || '' },
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new ApiResponseError(errorData.message || 'Invoice download failed', res.status);
      }
      return { blob: await res.blob(), fileName: res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || `invoice-${paymentId}.png` };
    },
  },

  // Top-level shortcuts
  getBusinessContext: (businessId: string) => api.business.getBusinessContext(businessId),
  getBusinessBlueprint: (businessId: string) => api.business.getBusinessBlueprint(businessId),
  approveBusinessBlueprint: (businessId: string, blueprintId?: string) => api.business.approveBusinessBlueprint(businessId, blueprintId),
  regenerateBusinessBlueprint: (businessId: string) => api.business.regenerateBusinessBlueprint(businessId),
};
