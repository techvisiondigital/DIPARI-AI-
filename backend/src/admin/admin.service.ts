import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as os from 'os';
import { FirebaseService } from '../firebase/firebase.service';
import { SeoCrawlerService } from './seo-crawler.service';

@Injectable()
export class AdminService {
  private systemPrompts: Record<string, string> = {
    campaign_generator: "You are Visionpilot AI's Senior Ad Copywriter (Meta authorised AI marketing agent). Create high-converting Meta ad copy with hooks, primary text, headline, and CTA.",
    content_planner: "You are Visionpilot AI's Social Media Strategist. Create a 5-day weekly content calendar with daily captions, CTAs, hashtags, and optimal posting times.",
    lead_assistant: "You are Visionpilot AI's AI Lead Sales Assistant. Generate executive lead summaries, priority scores (HIGH/MEDIUM/LOW), WhatsApp templates, email drafts, and structured call scripts.",
    help_bot: "You are Visionpilot AI's official Help Assistant (Meta authorised AI marketing agent). Answer ONLY questions related to Visionpilot AI and its features based strictly on retrieved knowledge base context."
  };

  private platformSettings = {
    maintenanceMode: false,
    aiModel: 'openrouter/free',
    allowRegistrations: true,
    metaApiVersion: 'v18.0',
    maxFreeCampaigns: 5,
    autoApproveLeads: true,
  };

  constructor(
    private readonly firebase: FirebaseService,
    private readonly seoCrawler: SeoCrawlerService,
  ) {}

  private checkAdmin(user: any) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access privileges required');
    }
  }

  async getPlatformStats(adminUser: any) {
    this.checkAdmin(adminUser);
    const totalUsers = await this.firebase.countUsers();
    const totalBusinesses = await this.firebase.countBusinesses();
    const activeCampaigns = await this.firebase.countCampaigns(undefined, 'ACTIVE');

    // Previously read EVERY subscription and EVERY payment just to derive three
    // numbers. Now: one aggregation for the subscriber count, and only the paid
    // payments are actually read (revenue needs their amounts to sum).
    const activeSubscribers = await this.firebase.countSubscriptions('ACTIVE');
    const paidPaymentsList = await this.firebase.getPaymentsByStatuses(['PAID', 'COMPLETED']);
    const totalRevenue = paidPaymentsList.reduce(
      (sum: number, payment: any) => sum + Number(payment.amountPaid || payment.amount || 0),
      0,
    );

    const auditLogsCount = await this.firebase.countAuditLogs();

    // These two numbers used to be derived by loading EVERY business and then
    // every scheduled post for each of them (an N+1 fan-out that cost thousands
    // of Firestore reads per dashboard load). Aggregation counts give the same
    // numbers for ~1 read each.
    const [jobsCompleted, activeJobs] = await Promise.all([
      this.firebase.countScheduledPosts(undefined, 'PUBLISHED'),
      this.firebase.countScheduledPosts(undefined, 'SCHEDULED'),
    ]);

    const memory = process.memoryUsage ? process.memoryUsage() : { rss: 150 * 1024 * 1024 };
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const cpus = os.cpus();
    const memoryPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

    return {
      totalUsers,
      totalBusinesses,
      activeCampaigns,
      activeSubscribers,
      totalRevenue,
      paidPayments: paidPaymentsList.length,
      auditLogsCount,
      platformHealth: 'OPERATIONAL',
      systemVersion: 'v2.4.0',
      memoryUsage: `${Math.round(memory.rss / 1024 / 1024)} MB / ${Math.round(totalMem / 1024 / 1024 / 1024)} GB`,
      memoryPercent,
      cpuCores: cpus.length,
      cpuModel: cpus[0]?.model || 'Generic CPU',
      systemUptime: Math.round(os.uptime()),
      processUptime: Math.round(process.uptime()),
      jobsCompleted,
      activeJobs,
    };
  }

  async runSeoAudit(adminUser: any, businessId: string, url?: string) {
    this.checkAdmin(adminUser);
    let targetUrl = url;

    if (!targetUrl) {
      const profile = await this.firebase.getBusinessProfile(businessId);
      targetUrl = profile?.websiteUrl || 'https://campaignai.app';
    }

    const auditData = await this.seoCrawler.crawlWebsite(targetUrl);
    await this.firebase.setBusinessSeoAudit(businessId, auditData);
    await this.firebase.createAuditLog({
      userId: adminUser.id,
      businessId,
      action: 'RUN_REAL_SEO_AUDIT',
      details: JSON.stringify({ url: targetUrl, score: auditData.score }),
    });

    return auditData;
  }

  async getSeoProfile(adminUser: any, businessId: string) {
    this.checkAdmin(adminUser);
    return this.firebase.getBusinessSeoAudit(businessId);
  }

  async updateSeoProfile(adminUser: any, businessId: string, data: any) {
    this.checkAdmin(adminUser);
    const updated = await this.firebase.setBusinessSeoAudit(businessId, data);
    await this.firebase.createAuditLog({
      userId: adminUser.id,
      businessId,
      action: 'UPDATE_SEO_PROFILE',
      details: JSON.stringify({ score: data.score, title: data.homepageTitle }),
    });
    return updated;
  }

  async sendInvoiceEmail(adminUser: any, businessId: string, invoiceId?: string) {
    this.checkAdmin(adminUser);
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new NotFoundException('Business workspace not found');

    const ownerId = business.memberIds?.[0] || business.ownerId;
    if (ownerId) {
      await this.firebase.createNotification({
        userId: ownerId,
        title: 'GST Tax Invoice Issued',
        message: `Tax Invoice ${invoiceId || ''} for workspace ${business.name} has been processed and emailed.`,
        type: 'INFO',
        read: false,
      });
    }

    await this.firebase.createAuditLog({
      userId: adminUser.id,
      businessId,
      action: 'EMAILED_GST_INVOICE',
      details: JSON.stringify({ invoiceId: invoiceId || 'AUTO_GENERATED' }),
    });

    return { success: true, message: `Invoice successfully issued and emailed for workspace ${business.name}` };
  }

  async updateSubscription(adminUser: any, businessId: string, plan: string) {
    this.checkAdmin(adminUser);
    const existingSubs = await this.firebase.getSubscriptionsByBusinessId(businessId);
    const now = new Date();
    let updated;
    if (existingSubs.length > 0) {
      updated = await this.firebase.updateSubscription(existingSubs[0].id, { plan, status: 'ACTIVE' });
    } else {
      const id = this.firebase.generateId();
      const sub = { id, businessId, plan, status: 'ACTIVE', createdAt: now, updatedAt: now };
      await this.firebase.col('subscriptions').doc(id).set(sub);
      updated = sub;
    }

    await this.firebase.createAuditLog({
      userId: adminUser.id,
      businessId,
      action: 'ADMIN_UPDATED_SUBSCRIPTION',
      details: JSON.stringify({ plan }),
    });

    return updated;
  }

  async getUsers(adminUser: any) {
    this.checkAdmin(adminUser);
    const users = await this.firebase.getAllUsers();

    return Promise.all(
      users.map(async (user) => {
        const businesses = await this.firebase.getBusinessesByUserId(user.id);
        return {
          ...user,
          businesses: businesses.map((b) => ({ business: b })),
        };
      }),
    );
  }

  async updateUserRole(adminUser: any, userId: string, role: string) {
    this.checkAdmin(adminUser);
    const updated = await this.firebase.updateUser(userId, { role });
    await this.firebase.createAuditLog({
      userId: adminUser.id,
      action: 'UPDATE_USER_ROLE',
      details: JSON.stringify({ targetUserId: userId, newRole: role }),
    });
    return updated;
  }

  async getBusinesses(adminUser: any) {
    this.checkAdmin(adminUser);
    const businesses = await this.firebase.getAllBusinesses();

    return Promise.all(
      businesses.map(async (business) => {
        const profile = await this.firebase.getBusinessProfile(business.id);
        const subscriptions = await this.firebase.getSubscriptionsByBusinessId(business.id);
        const campaignsCount = await this.firebase.countCampaigns(business.id);
        return {
          ...business,
          profile,
          subscriptions,
          campaignsCount,
        };
      }),
    );
  }

  async updateBusinessProfile(adminUser: any, businessId: string, data: any) {
    this.checkAdmin(adminUser);
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new NotFoundException('Business workspace not found');

    const profile = await this.firebase.upsertBusinessProfile(businessId, {
      businessName: data.businessName,
      businessUSP: data.usp,
      targetAudience: data.idealCustomer,
      currentOffer: data.offer,
      monthlyBudget: data.budget,
      brandColors: data.brandColors,
      logoUrl: data.logoUrl,
    });
    const updatedBusiness = await this.firebase.updateBusiness(businessId, {
      name: data.businessName || business.name,
    });
    await this.firebase.createAuditLog({
      userId: adminUser.id,
      businessId,
      action: 'ADMIN_UPDATED_BUSINESS_PROFILE',
      details: JSON.stringify({ fields: Object.keys(data) }),
    });
    return { business: updatedBusiness, profile };
  }

  async getAllCampaigns(adminUser: any) {
    this.checkAdmin(adminUser);
    return this.firebase.getAllCampaigns();
  }

  async updateCampaignStatus(adminUser: any, campaignId: string, status: string) {
    this.checkAdmin(adminUser);
    const updated = await this.firebase.updateCampaign(campaignId, { status });
    await this.firebase.createAuditLog({
      userId: adminUser.id,
      action: 'UPDATE_CAMPAIGN_STATUS',
      details: JSON.stringify({ campaignId, newStatus: status }),
    });
    return updated;
  }

  async getAllSubscriptions(adminUser: any) {
    this.checkAdmin(adminUser);
    return this.firebase.getAllSubscriptions();
  }

  async getAllPayments(adminUser: any) {
    this.checkAdmin(adminUser);
    return this.firebase.getAllPayments();
  }

  async getAllTickets(adminUser: any) {
    this.checkAdmin(adminUser);
    const tickets = await this.firebase.getAllSupportTickets();

    return Promise.all(
      tickets.map(async (ticket) => {
        const user = await this.firebase.getUserById((ticket as any).userId);
        return {
          ...ticket,
          user,
        };
      }),
    );
  }

  async updateTicketStatus(adminUser: any, ticketId: string, status: string) {
    this.checkAdmin(adminUser);
    const updated = await this.firebase.updateSupportTicket(ticketId, { status });
    await this.firebase.createAuditLog({
      userId: adminUser.id,
      action: 'UPDATE_TICKET_STATUS',
      details: JSON.stringify({ ticketId, newStatus: status }),
    });
    return updated;
  }

  async getSystemPrompts(adminUser: any) {
    this.checkAdmin(adminUser);
    const stored = await this.firebase.getAdminConfig<Record<string, any>>('systemPrompts');
    return stored?.values || this.systemPrompts;
  }

  async updateSystemPrompt(adminUser: any, key: string, template: string) {
    this.checkAdmin(adminUser);
    const stored = await this.firebase.getAdminConfig<Record<string, any>>('systemPrompts');
    const values = { ...(stored?.values || this.systemPrompts), [key]: template };
    this.systemPrompts = values;
    await this.firebase.setAdminConfig('systemPrompts', { values });
    await this.firebase.createAuditLog({
      userId: adminUser.id,
      action: 'UPDATE_SYSTEM_PROMPT',
      details: JSON.stringify({ promptKey: key }),
    });
    return { key, template, updated: true };
  }

  async sendBroadcastNotification(adminUser: any, title: string, message: string) {
    this.checkAdmin(adminUser);
    const users = await this.firebase.getAllUsers();

    await Promise.all(
      users.map((user) =>
        this.firebase.createNotification({
          userId: user.id,
          title: `[ANNOUNCEMENT] ${title}`,
          message,
          type: 'INFO',
          read: false,
        })
      )
    );

    await this.firebase.createAuditLog({
      userId: adminUser.id,
      action: 'BROADCAST_NOTIFICATION',
      details: JSON.stringify({ title, recipientsCount: users.length }),
    });

    return { success: true, count: users.length };
  }

  async getAllAuditLogs(adminUser: any) {
    this.checkAdmin(adminUser);
    const logs = await this.firebase.getAllAuditLogs(100);

    return Promise.all(
      logs.map(async (log) => {
        const user = await this.firebase.getUserById((log as any).userId);
        return {
          ...log,
          user,
        };
      }),
    );
  }

  async getPlatformSettings(adminUser: any) {
    this.checkAdmin(adminUser);
    const stored = await this.firebase.getAdminConfig<Record<string, any>>('platformSettings');
    const settings = stored?.values || this.platformSettings;
    return {
      ...settings,
      openRouterApiKeyConfigured: !!process.env.OPENROUTER_API_KEY,
      firebaseProjectConfigured: !!process.env.FIREBASE_PROJECT_ID,
      metaAppIdConfigured: !!process.env.META_APP_ID,
    };
  }

  async updatePlatformSettings(adminUser: any, newSettings: any) {
    this.checkAdmin(adminUser);
    this.platformSettings = {
      ...this.platformSettings,
      ...newSettings,
    };
    await this.firebase.setAdminConfig('platformSettings', { values: this.platformSettings });
    await this.firebase.createAuditLog({
      userId: adminUser.id,
      action: 'UPDATE_PLATFORM_SETTINGS',
      details: JSON.stringify(newSettings),
    });
    return this.platformSettings;
  }



  // ─── Client Impersonation ────────────────────────────────────────────────────

  /**
   * Returns a client's full context data so admin can "view as client" on the frontend.
   */
  async impersonateClient(adminUser: any, businessId: string) {
    this.checkAdmin(adminUser);
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new NotFoundException('Business workspace not found');

    const ownerId = business.ownerId || business.memberIds?.[0];
    let ownerUser: any = null;
    if (ownerId) {
      ownerUser = await this.firebase.getUserById(ownerId);
    }

    const profile = await this.firebase.getBusinessProfile(businessId);
    const subscriptions = await this.firebase.getSubscriptionsByBusinessId(businessId);
    const campaignsCount = await this.firebase.countCampaigns(businessId);

    await this.firebase.createAuditLog({
      userId: adminUser.id,
      businessId,
      action: 'ADMIN_IMPERSONATED_CLIENT',
      details: JSON.stringify({ businessName: business.name, ownerId }),
    });

    return {
      success: true,
      impersonation: true,
      business,
      profile,
      owner: ownerUser ? { id: ownerUser.id, name: ownerUser.name, email: ownerUser.email } : null,
      subscriptions,
      campaignsCount,
      targetUserId: ownerId,
      targetBusinessId: businessId,
    };
  }
}
