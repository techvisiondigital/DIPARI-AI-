import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { UsersDao } from './daos/users.dao';
import { WorkspacesDao } from './daos/workspaces.dao';
import { SocialPostsDao } from './daos/social-posts.dao';

class MockDocument {
  public ref: any;
  constructor(public id: string, public exists: boolean, private _data: any = null) {
    this.ref = {
      update: async (data: any) => {
        return { id: this.id };
      },
      get: async () => {
        return this;
      },
      set: async (data: any, options?: any) => {
        return { id: this.id };
      },
      delete: async () => {
        return { id: this.id };
      }
    };
  }
  data() {
    return this._data;
  }
}

class MockQuerySnapshot {
  constructor(public docs: MockDocument[]) {}
  get empty() {
    return this.docs.length === 0;
  }
}

class MockCollection {
  constructor(private colName: string, private db: any) {}

  doc(id?: string) {
    const docId = id || randomUUID();
    return {
      set: async (data: any, options?: { merge?: boolean }) => {
        this.db.setDoc(this.colName, docId, data, options?.merge);
        return { id: docId };
      },
      get: async () => {
        const data = this.db.getDoc(this.colName, docId);
        return new MockDocument(docId, !!data, data);
      },
      update: async (data: any) => {
        this.db.setDoc(this.colName, docId, data, true);
        return { id: docId };
      },
      delete: async () => {
        this.db.deleteDoc(this.colName, docId);
        return { id: docId };
      }
    };
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.colName, this.db, [{ field, op, val }]);
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
    return new MockQuery(this.colName, this.db, [], { field, dir });
  }

  limit(n: number) {
    return new MockQuery(this.colName, this.db, [], null, n);
  }

  async get() {
    const docs = this.db.getDocs(this.colName);
    return new MockQuerySnapshot(docs);
  }

  count() {
    return {
      get: async () => {
        const count = this.db.getDocs(this.colName).length;
        return { data: () => ({ count }) };
      }
    };
  }
}

class MockQuery {
  constructor(
    private colName: string,
    private db: any,
    private wheres: any[] = [],
    private order: any = null,
    private limitVal: number | null = null
  ) {}

  where(field: string, op: string, val: any) {
    this.wheres.push({ field, op, val });
    return this;
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
    this.order = { field, dir };
    return this;
  }

  limit(n: number) {
    this.limitVal = n;
    return this;
  }

  count() {
    return {
      get: async () => {
        const snap = await this.get();
        const count = snap.docs.length;
        return { data: () => ({ count }) };
      }
    };
  }

  async get() {
    let docs = this.db.getDocs(this.colName);

    // Apply wheres
    for (const w of this.wheres) {
      docs = docs.filter((d: any) => {
        const data = d.data();
        const fieldVal = data ? data[w.field] : undefined;
        if (w.op === '==') return fieldVal === w.val;
        if (w.op === '<=') return fieldVal <= w.val;
        if (w.op === '>=') return fieldVal >= w.val;
        if (w.op === '<') return fieldVal < w.val;
        if (w.op === '>') return fieldVal > w.val;
        if (w.op === 'array-contains') {
          return Array.isArray(fieldVal) && fieldVal.includes(w.val);
        }
        return false;
      });
    }

    // Apply orderBy
    if (this.order) {
      docs.sort((a: any, b: any) => {
        const dataA = a.data();
        const dataB = b.data();
        const valA = dataA ? dataA[this.order.field] : undefined;
        const valB = dataB ? dataB[this.order.field] : undefined;
        if (valA === valB) return 0;
        if (valA === undefined) return 1;
        if (valB === undefined) return -1;
        const multiplier = this.order.dir === 'desc' ? -1 : 1;
        return valA < valB ? -1 * multiplier : 1 * multiplier;
      });
    }

    // Apply limit
    if (this.limitVal !== null) {
      docs = docs.slice(0, this.limitVal);
    }

    return new MockQuerySnapshot(docs);
  }
}

class MockDb {
  private cache: Record<string, Record<string, any>> = {};
  private filePath = path.join(process.cwd(), 'mock-db.json');

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.cache = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to load mock-db.json:', e);
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save mock-db.json:', e);
    }
  }

  getDoc(colName: string, docId: string) {
    if (!this.cache[colName]) return null;
    return this.cache[colName][docId] || null;
  }

  setDoc(colName: string, docId: string, data: any, merge = false) {
    if (!this.cache[colName]) this.cache[colName] = {};
    
    // Convert Dates to ISO strings for JSON compatibility
    const cleanData = JSON.parse(JSON.stringify(data, (key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    }));

    if (merge) {
      this.cache[colName][docId] = {
        ...(this.cache[colName][docId] || {}),
        ...cleanData,
        id: docId
      };
    } else {
      this.cache[colName][docId] = {
        ...cleanData,
        id: docId
      };
    }
    this.save();
  }

  deleteDoc(colName: string, docId: string) {
    if (this.cache[colName] && this.cache[colName][docId]) {
      delete this.cache[colName][docId];
      this.save();
    }
  }

  getDocs(colName: string) {
    const col = this.cache[colName] || {};
    return Object.keys(col).map(id => new MockDocument(id, true, col[id]));
  }
}

@Injectable()
export class FirebaseService implements OnModuleInit {
  private db: any;
  private readonly logger = new Logger(FirebaseService.name);

  public usersDao: UsersDao = new UsersDao((name: string) => this.col(name));
  public workspacesDao: WorkspacesDao = new WorkspacesDao((name: string) => this.col(name));
  public socialPostsDao: SocialPostsDao = new SocialPostsDao((name: string) => this.col(name));

  onModuleInit() {
    this.getDb();
    const isMock = !process.env.FIREBASE_PROJECT_ID;

    if (isMock) {
      this.logger.log('FIREBASE_PROJECT_ID not set. Initializing local MockFirestore service.');
      
      const mockAuthObj = {
        createUser: async (properties: any) => {
          const uid = randomUUID();
          return { uid, email: properties.email, displayName: properties.displayName };
        },
        getUser: async (uid: string) => {
          const userDoc = await this.getUserById(uid);
          if (!userDoc) throw new Error('User not found');
          return { uid, email: userDoc.email, displayName: userDoc.name };
        },
        verifyIdToken: async (token: string) => {
          try {
            const parts = token.split('.');
            if (parts.length !== 3) throw new Error('Invalid token');
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            return {
              uid: payload.sub || payload.uid,
              email: payload.email,
              name: payload.name || payload.displayName,
            };
          } catch (e) {
            throw new Error('Invalid token');
          }
        },
        generatePasswordResetLink: async (email: string) => `http://localhost:3000/reset?email=${email}`,
        generateEmailVerificationLink: async (email: string) => `http://localhost:3000/verify?email=${email}`,
      };

      Object.defineProperty(admin, 'auth', {
        value: () => mockAuthObj,
        writable: true,
        configurable: true,
      });

      this.seedAdminUserIfNeeded();
    } else {
      this.logger.log('Firebase Firestore initialised successfully');
    }
  }

  /**
   * Upload a file buffer (e.g. generated 1080x1080 PNG graphic) to Firebase Storage,
   * making it publicly accessible and returning the public download URL.
   */
  async uploadFileBuffer(
    buffer: Buffer,
    destinationPath: string,
    contentType: string = 'image/png',
  ): Promise<{ publicUrl: string; storagePath: string }> {
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || 'campaignai-1044d.firebasestorage.app';

    if (process.env.FIREBASE_PROJECT_ID && admin.apps.length > 0) {
      try {
        const bucket = admin.storage().bucket(storageBucket);
        const file = bucket.file(destinationPath);

        await file.save(buffer, {
          metadata: {
            contentType,
            metadata: {
              firebaseStorageDownloadTokens: destinationPath.replace(/[^a-zA-Z0-9]/g, '-'),
            },
          },
          resumable: false,
        });

        // Make file public
        try {
          await file.makePublic();
        } catch {
          // If bucket-level ACL restricts makePublic, use standard Firebase Storage download URL
        }

        const encodedPath = encodeURIComponent(destinationPath);
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodedPath}?alt=media`;

        this.logger.log(`[FirebaseService] File successfully uploaded to Firebase Storage: ${publicUrl}`);
        return { publicUrl, storagePath: destinationPath };
      } catch (err: any) {
        this.logger.warn(`[FirebaseService] Firebase Storage upload failed (${err.message}). Using mock storage fallback.`);
      }
    }

    // Mock/Offline fallback: Save file to local public upload directory & serve via local URL
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const fileName = path.basename(destinationPath);
    const localFilePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(localFilePath, buffer);

    const publicUrl = `http://localhost:3001/uploads/${fileName}`;
    this.logger.log(`[FirebaseService] File saved locally to mock storage: ${publicUrl}`);
    return { publicUrl, storagePath: destinationPath };
  }

  private async seedAdminUserIfNeeded() {
    try {
      const adminEmail = 'admin@campaignai.com';
      const existing = await this.getUserByEmail(adminEmail);
      if (!existing) {
        this.logger.log(`Seeding default admin user: ${adminEmail}`);
        const adminId = 'admin-user-id';
        await this.createUser({
          email: adminEmail,
          name: 'Visionpilot AI Admin',
          passwordHash: 'password123',
          role: 'ADMIN',
        }, adminId);

        const business = await this.createBusiness({
          name: 'Visionpilot AI Enterprise',
          ownerId: adminId,
        });

        await this.createSubscription({
          businessId: business.id,
          plan: 'ENTERPRISE',
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });

        this.logger.log('Seeding default admin user completed.');
      }
    } catch (e) {
      this.logger.error('Failed to seed default admin user:', e);
    }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  private getDb() {
    if (!this.db) {
      if (!process.env.FIREBASE_PROJECT_ID) {
        this.db = new MockDb();
      } else {
        if (admin.apps.length === 0) {
          const fs = require('fs');
          const path = require('path');
          const serviceAccountPath = path.join(process.cwd(), 'firebase-service-account.json');

          if (fs.existsSync(serviceAccountPath)) {
            const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
            admin.initializeApp({
              credential: admin.credential.cert(serviceAccount),
            });
          } else {
            admin.initializeApp({
              credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
              }),
            });
          }
        }
        this.db = admin.firestore();
        try {
          this.db.settings({ ignoreUndefinedProperties: true });
        } catch {
          // Ignore if settings already initialized
        }
      }
    }
    return this.db;
  }

  col(name: string) {
    const db = this.getDb();
    if (!process.env.FIREBASE_PROJECT_ID) {
      return new MockCollection(name, db) as any;
    }
    return db.collection(name);
  }

  private async snap<T>(doc: admin.firestore.DocumentSnapshot): Promise<T | null> {
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as T;
  }

  generateId(): string {
    return randomUUID();
  }

  // ─── Users ───────────────────────────────────────────────────────────────────

  async createUser(data: {
    email: string;
    name: string;
    passwordHash: string | null;
    role?: string;
    preferredLanguage?: string;
  }, id?: string) {
    const userId = id || this.generateId();
    const now = new Date();
    const user = {
      email: data.email,
      name: data.name,
      passwordHash: data.passwordHash ?? null,
      role: data.role || 'MEMBER',
      preferredLanguage: data.preferredLanguage || 'English',
      createdAt: now,
      updatedAt: now,
    };
    await this.col('users').doc(userId).set(user);
    return { id: userId, ...user };
  }

  async getUserById(id: string) {
    if (!id || typeof id !== 'string' || !id.trim()) return null;
    const doc = await this.col('users').doc(id).get();
    return this.snap<any>(doc);
  }

  async getUserByEmail(email: string) {
    const snap = await this.col('users').where('email', '==', email).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as any;
  }

  async getAllUsers() {
    const snap = await this.col('users').orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  }

  async updateUser(id: string, data: Record<string, any>) {
    const ref = this.col('users').doc(id);
    await ref.set({ ...data, updatedAt: new Date() }, { merge: true });
    const doc = await ref.get();
    return this.snap<any>(doc);
  }

  async countUsers(): Promise<number> {
    const snap = await this.col('users').count().get();
    return snap.data().count;
  }

  // ─── Businesses ──────────────────────────────────────────────────────────────

  /**
   * Creates a new Business workspace.
   * The ownerId is stored in memberIds[] for array-contains queries.
   */
  async createBusiness(data: { name: string; ownerId?: string }) {
    const id = this.generateId();
    const now = new Date();
    const business = {
      name: data.name,
      memberIds: data.ownerId ? [data.ownerId] : [],
      // Meta fields — populated by IntegrationsService.connectMeta()
      metaUserId: null,
      metaPageId: null,
      metaPageName: null,
      metaIgBusinessAccountId: null,
      metaAdAccountId: null,
      metaAccessToken: null,
      metaTokenExpiry: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.col('businesses').doc(id).set(business);
    return { id, ...business };
  }

  async getBusinessById(id: string) {
    if (!id || typeof id !== 'string' || !id.trim()) return null;
    const doc = await this.col('businesses').doc(id).get();
    return this.snap<any>(doc);
  }

  async updateBusiness(id: string, data: Record<string, any>) {
    if (!id) return null;
    const updateData = { ...data, updatedAt: new Date() };
    const docRef = this.col('businesses').doc(id);
    await docRef.set(updateData, { merge: true });
    const updated = await docRef.get();
    return { id, ...(updated?.data() || {}) };
  }

  async getAllBusinesses() {
    const snap = await this.col('businesses').orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  }

  async countBusinesses(): Promise<number> {
    const snap = await this.col('businesses').count().get();
    return snap.data().count;
  }

  /**
   * Returns all businesses where userId is in memberIds[].
   */
  async getBusinessesByUserId(userId: string) {
    const snap = await this.col('businesses')
      .where('memberIds', 'array-contains', userId)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  }

  // ─── Business Profiles ───────────────────────────────────────────────────────

  async getBusinessProfile(businessId: string) {
    const snap = await this.col('businessProfiles')
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as any;
  }

  async upsertBusinessProfile(businessId: string, data: Record<string, any>) {
    const existing = await this.getBusinessProfile(businessId);
    const now = new Date();
    if (existing) {
      const updateData = { ...data, businessId, updatedAt: now };
      await this.col('businessProfiles').doc((existing as any).id).update(updateData);
      const updated = await this.col('businessProfiles').doc((existing as any).id).get();
      return { id: (existing as any).id, ...updated.data() };
    }
    const id = this.generateId();
    const profile = { ...data, businessId, createdAt: now, updatedAt: now };
    await this.col('businessProfiles').doc(id).set(profile);
    return { id, ...profile };
  }

  // ─── Campaigns ──────────────────────────────────────────────────────────────

  async createCampaign(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const campaign = { ...data, createdAt: now, updatedAt: now };
    await this.col('campaigns').doc(id).set(campaign);
    return { id, ...campaign };
  }

  async getCampaignById(id: string) {
    const doc = await this.col('campaigns').doc(id).get();
    return this.snap<any>(doc);
  }

  async getCampaignsByBusinessId(businessId: string) {
    const snap = await this.col('campaigns')
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
  }

  async getAllCampaigns() {
    const snap = await this.col('campaigns').get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
  }

  async updateCampaign(id: string, data: Record<string, any>) {
    const updateData = { ...data, updatedAt: new Date() };
    await this.col('campaigns').doc(id).update(updateData);
    const updated = await this.col('campaigns').doc(id).get();
    return { id, ...updated.data() };
  }

  async countCampaigns(businessId?: string, status?: string): Promise<number> {
    let q: admin.firestore.Query = this.col('campaigns');
    if (businessId) q = q.where('businessId', '==', businessId);
    if (status) q = q.where('status', '==', status);
    const snap = await q.count().get();
    return snap.data().count;
  }

  // ─── Campaign Drafts ────────────────────────────────────────────────────────

  async createCampaignDraft(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const draft = { ...data, status: 'DRAFT', createdAt: now, updatedAt: now };
    await this.col('campaignDrafts').doc(id).set(draft);
    return { id, ...draft };
  }

  async getCampaignDraftById(id: string) {
    const doc = await this.col('campaignDrafts').doc(id).get();
    return this.snap<any>(doc);
  }

  async getCampaignDraftsByBusinessId(businessId: string) {
    const snap = await this.col('campaignDrafts')
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
  }

  async updateCampaignDraft(id: string, data: Record<string, any>) {
    const updateData = { ...data, updatedAt: new Date() };
    await this.col('campaignDrafts').doc(id).update(updateData);
    const updated = await this.col('campaignDrafts').doc(id).get();
    return { id, ...updated.data() };
  }

  // ─── AdSets ──────────────────────────────────────────────────────────────────

  async createAdSet(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const adSet = { ...data, createdAt: now, updatedAt: now };
    await this.col('adSets').doc(id).set(adSet);
    return { id, ...adSet };
  }

  async getAdSetsByCampaignId(campaignId: string) {
    const snap = await this.col('adSets').where('campaignId', '==', campaignId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  }

  async updateAdSet(id: string, data: Record<string, any>) {
    const updateData = { ...data, updatedAt: new Date() };
    await this.col('adSets').doc(id).update(updateData);
    const updated = await this.col('adSets').doc(id).get();
    return { id, ...updated.data() };
  }

  /**
   * Batch-updates all adSets belonging to a campaign (e.g. status cascades).
   */
  async updateAdSetsByCampaignId(campaignId: string, data: Record<string, any>) {
    const snap = await this.col('adSets').where('campaignId', '==', campaignId).get();
    if (snap.empty) return;
    const batch = this.db.batch();
    snap.docs.forEach((doc) => batch.update(doc.ref, { ...data, updatedAt: new Date() }));
    await batch.commit();
  }

  // ─── Ads ─────────────────────────────────────────────────────────────────────

  async createAd(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const ad = { ...data, createdAt: now, updatedAt: now };
    await this.col('ads').doc(id).set(ad);
    return { id, ...ad };
  }

  async getAdsByAdSetId(adSetId: string) {
    const snap = await this.col('ads').where('adSetId', '==', adSetId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  }

  async getAdsByBusinessId(businessId: string) {
    const snap = await this.col('ads').where('businessId', '==', businessId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
  }

  /**
   * Batch-updates all ads under a given adSet (e.g. status cascades).
   */
  async updateAdsByAdSetId(adSetId: string, data: Record<string, any>) {
    const snap = await this.col('ads').where('adSetId', '==', adSetId).get();
    if (snap.empty) return;
    const batch = this.db.batch();
    snap.docs.forEach((doc) => batch.update(doc.ref, { ...data, updatedAt: new Date() }));
    await batch.commit();
  }

  // ─── Creatives ───────────────────────────────────────────────────────────────

  async createCreative(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const creative = { ...data, createdAt: now };
    await this.col('creatives').doc(id).set(creative);
    return { id, ...creative };
  }

  async getCreativeById(id: string) {
    const doc = await this.col('creatives').doc(id).get();
    return this.snap<any>(doc);
  }

  // ─── Analytics ───────────────────────────────────────────────────────────────

  /**
   * Analytics documents include businessId for simple single-field queries,
   * avoiding the need for a composite Firestore index during development.
   * Date is stored as ISO string (YYYY-MM-DD) for string-range filtering.
   */
  async createAnalytics(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    // Ensure dateStr exists for range queries
    const dateStr = data.date instanceof Date
      ? data.date.toISOString().split('T')[0]
      : (data.dateStr || new Date().toISOString().split('T')[0]);
    const analytics = { ...data, dateStr, createdAt: now };
    await this.col('analytics').doc(id).set(analytics);
    return { id, ...analytics };
  }

  /**
   * Fetches analytics for a business from startDate onwards.
   * Filters by businessId first, then filters date in-memory
   * to avoid needing a composite Firestore index.
   */
  async getAnalyticsByBusinessId(businessId: string, startDate: Date) {
    const snap = await this.col('analytics')
      .where('businessId', '==', businessId)
      .get();
    const startStr = startDate.toISOString().split('T')[0];
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() as any }))
      .filter((d) => (d.dateStr || '') >= startStr)
      .sort((a, b) => (a.dateStr < b.dateStr ? -1 : 1));
  }

  // ─── Optimization History ─────────────────────────────────────────────────────

  async createOptimizationHistory(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const history = { ...data, createdAt: now };
    await this.col('optimizationHistories').doc(id).set(history);
    return { id, ...history };
  }

  async getOptimizationHistoryByBusinessId(businessId: string) {
    const snap = await this.col('optimizationHistories')
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
  }

  // ─── Notifications ────────────────────────────────────────────────────────────

  async createNotification(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const notification = { isRead: false, ...data, createdAt: now };
    await this.col('notifications').doc(id).set(notification);
    return { id, ...notification };
  }

  async getNotificationsByBusinessId(businessId: string) {
    const snap = await this.col('notifications')
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
  }

  async getNotificationById(id: string) {
    const doc = await this.col('notifications').doc(id).get();
    return this.snap<any>(doc);
  }

  async updateNotification(id: string, data: Record<string, any>) {
    await this.col('notifications').doc(id).update(data);
    const updated = await this.col('notifications').doc(id).get();
    return { id, ...updated.data() };
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────────

  async createSubscription(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const subscription = { ...data, createdAt: now, updatedAt: now };
    await this.col('subscriptions').doc(id).set(subscription);
    return { id, ...subscription };
  }

  async getSubscriptionsByBusinessId(businessId: string) {
    const snap = await this.col('subscriptions')
      .where('businessId', '==', businessId)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async updateSubscription(id: string, data: Record<string, any>) {
    const now = new Date();
    await this.col('subscriptions').doc(id).update({ ...data, updatedAt: now });
    const doc = await this.col('subscriptions').doc(id).get();
    return { id, ...doc.data() };
  }

  async getPaymentsByBusinessId(businessId: string) {
    const snap = await this.col('payments')
      .where('businessId', '==', businessId)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async createPaymentRecord(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const payment = { ...data, createdAt: now };
    await this.col('payments').doc(id).set(payment);
    return { id, ...payment };
  }

  async getAllSubscriptions() {
    const snap = await this.col('subscriptions').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async getAdminConfig<T = any>(key: string): Promise<T | null> {
    if (!key) return null;
    const doc = await this.col('adminConfig').doc(key).get();
    return this.snap<T>(doc);
  }

  async setAdminConfig(key: string, data: Record<string, any>) {
    if (!key) return null;
    await this.col('adminConfig').doc(key).set({ ...data, updatedAt: new Date() }, { merge: true });
    const doc = await this.col('adminConfig').doc(key).get();
    return { id: key, ...doc.data() };
  }

  async getBusinessSeoAudit(businessId: string) {
    if (!businessId) return null;
    const doc = await this.col('businessSeoProfiles').doc(businessId).get();
    return this.snap<any>(doc);
  }

  async setBusinessSeoAudit(businessId: string, data: Record<string, any>) {
    if (!businessId) return null;
    await this.col('businessSeoProfiles').doc(businessId).set({ businessId, ...data, updatedAt: new Date() }, { merge: true });
    const doc = await this.col('businessSeoProfiles').doc(businessId).get();
    return { id: businessId, ...doc.data() };
  }

  async getAllPayments() {
    const snap = await this.col('payments').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ─── Support Tickets ──────────────────────────────────────────────────────────

  async createSupportTicket(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const ticket = { status: 'OPEN', ...data, createdAt: now };
    await this.col('supportTickets').doc(id).set(ticket);
    return { id, ...ticket };
  }

  async getSupportTicketsByUserId(userId: string) {
    const snap = await this.col('supportTickets')
      .where('userId', '==', userId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
  }

  async getAllSupportTickets() {
    const snap = await this.col('supportTickets').orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async updateSupportTicket(id: string, data: Record<string, any>) {
    await this.col('supportTickets').doc(id).update(data);
    const updated = await this.col('supportTickets').doc(id).get();
    return { id, ...updated.data() };
  }

  // ─── Activity Logs (AuditLog) ─────────────────────────────────────────────────

  async createAuditLog(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const log = { ...data, createdAt: now };
    await this.col('activityLogs').doc(id).set(log);
    return { id, ...log };
  }

  async getAuditLogsByUserId(userId: string, limit = 20) {
    const snap = await this.col('activityLogs')
      .where('userId', '==', userId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0)).slice(0, limit);
  }

  async getAllAuditLogs(limit = 50) {
    const snap = await this.col('activityLogs')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async countAuditLogs(): Promise<number> {
    const snap = await this.col('activityLogs').count().get();
    return snap.data().count;
  }

  // ─── AI Conversations ─────────────────────────────────────────────────────────

  async createAIConversation(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const conversation = { ...data, createdAt: now };
    await this.col('aiConversations').doc(id).set(conversation);
    return { id, ...conversation };
  }

  async getAIConversationById(id: string) {
    const doc = await this.col('aiConversations').doc(id).get();
    return this.snap<any>(doc);
  }

  async getAIConversationsByUserAndBusiness(userId: string, businessId: string) {
    const snap = await this.col('aiConversations')
      .where('userId', '==', userId)
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
  }

  async updateAIConversation(id: string, data: Record<string, any>) {
    await this.col('aiConversations').doc(id).update(data);
    const updated = await this.col('aiConversations').doc(id).get();
    return { id, ...updated.data() };
  }

  // ─── Meta Accounts (Phase 6) ──────────────────────────────────────────────────

  /**
   * Upserts the Meta connection record for a business.
   * Stores tokens securely inside Firestore (not in .env).
   */
  async upsertMetaAccount(businessId: string, data: Record<string, any>) {
    const snap = await this.col('metaAccounts')
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
    const now = new Date();
    if (!snap.empty) {
      const doc = snap.docs[0];
      await this.col('metaAccounts').doc(doc.id).set({ ...data, businessId, updatedAt: now }, { merge: true });
      const updated = await this.col('metaAccounts').doc(doc.id).get();
      return { id: doc.id, ...(updated?.data ? updated.data() : updated) };
    }
    const id = this.generateId();
    const metaAccount = { ...data, businessId, createdAt: now, updatedAt: now };
    await this.col('metaAccounts').doc(id).set(metaAccount);
    return { id, ...metaAccount };
  }

  async getMetaAccountByBusinessId(businessId: string) {
    const snap = await this.col('metaAccounts')
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  // ─── Content Calendar ─────────────────────────────────────────────────────────

  /**
   * contentCalendar — stores weekly 5-day AI-generated content plans.
   * Each entry represents one scheduled post slot.
   */
  async createContentCalendarEntry(data: Record<string, any>) {
    const id = this.generateId();
    const entry = { ...data, status: data.status || 'SCHEDULED', createdAt: new Date() };
    await this.col('contentCalendar').doc(id).set(entry);
    return { id, ...entry };
  }

  async getContentCalendarByBusinessId(businessId: string) {
    const snap = await this.col('contentCalendar')
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return results.sort((a: any, b: any) => (a.scheduledTime?.toDate?.()?.getTime?.() || 0) - (b.scheduledTime?.toDate?.()?.getTime?.() || 0));
  }

  async updateContentCalendarEntry(id: string, data: Record<string, any>) {
    await this.col('contentCalendar').doc(id).update({ ...data, updatedAt: new Date() });
    const updated = await this.col('contentCalendar').doc(id).get();
    return { id, ...updated.data() };
  }

  async getContentCalendarEntryById(id: string) {
    if (!id) return null;
    const snap = await this.col('contentCalendar').doc(id).get();
    if (snap.exists) return { id: snap.id, ...snap.data() };

    // Fallback: Check scheduledPosts collection if entry ID originated from post scheduler
    const schedSnap = await this.col('scheduledPosts').doc(id).get();
    if (schedSnap.exists) {
      const data = schedSnap.data() as any;
      return {
        id: schedSnap.id,
        businessId: data.businessId || 'default',
        headline: data.headline || data.contentIdea || 'Scheduled Post',
        caption: data.caption || '',
        platform: data.platform || 'Instagram',
        postType: data.postType || 'Image',
        status: data.status || 'SCHEDULED',
        scheduledTime: data.scheduledTime,
        imageUrl: data.imageUrl,
        imageOverlayText: data.imageOverlayText,
        hashtags: data.hashtags || [],
        ...data,
      };
    }

    return null;
  }

  async deleteContentCalendarEntry(id: string) {
    await this.col('contentCalendar').doc(id).delete();
  }

  // ─── Generated Content ────────────────────────────────────────────────────────

  /**
   * generatedContent — individual posts, captions, hashtags, graphics prompts.
   * Linked to a contentCalendar entry via calendarEntryId.
   */
  async createGeneratedContent(data: Record<string, any>) {
    const id = this.generateId();
    const content = { ...data, createdAt: new Date() };
    await this.col('generatedContent').doc(id).set(content);
    return { id, ...content };
  }

  async getGeneratedContentByBusinessId(businessId: string) {
    const snap = await this.col('generatedContent')
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return results.sort((a: any, b: any) => (b.createdAt?.toDate?.()?.getTime?.() || 0) - (a.createdAt?.toDate?.()?.getTime?.() || 0));
  }

  async getGeneratedContentByCalendarEntryId(calendarEntryId: string) {
    const snap = await this.col('generatedContent')
      .where('calendarEntryId', '==', calendarEntryId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  // ─── Content Strategy ─────────────────────────────────────────────────────────

  async upsertContentStrategy(businessId: string, strategyData: Record<string, any>) {
    const existing = await this.getContentStrategyByBusinessId(businessId);
    const id = existing?.id || this.generateId();
    const versionNumber = (existing?.versionNumber || 0) + 1;
    const payload = {
      id,
      businessId,
      ...strategyData,
      version: `v${versionNumber}`,
      versionNumber,
      updatedAt: new Date(),
      createdAt: existing?.createdAt || new Date(),
    };

    await this.col('contentStrategies').doc(id).set(payload);
    return payload;
  }

  async getContentStrategyByBusinessId(businessId: string) {
    const snap = await this.col('contentStrategies')
      .where('businessId', '==', businessId)
      .get();
    if (snap.empty) return null;
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    docs.sort((a: any, b: any) => (b.versionNumber || 0) - (a.versionNumber || 0));
    return docs[0];
  }

  // ─── Calendar Audit Trail & Transactions ─────────────────────────────────────

  async createCalendarAuditTrail(data: {
    action: string;
    previousValue: any;
    newValue: any;
    timestamp?: Date;
    user?: string;
    businessId: string;
    calendarEntryId: string;
  }) {
    const id = this.generateId();
    const auditRecord = {
      id,
      ...data,
      timestamp: data.timestamp || new Date(),
      user: data.user || 'System/User',
      createdAt: new Date(),
    };
    await this.col('calendarHistory').doc(id).set(auditRecord);
    return auditRecord;
  }

  /**
   * Executes an atomic transaction. Supports both real Firestore transactions
   * and MockDb in-memory transaction semantics to ensure partial write safety.
   */
  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    if (process.env.FIREBASE_PROJECT_ID && this.db && typeof this.db.runTransaction === 'function') {
      return this.db.runTransaction(updateFunction);
    }

    // MockDb transaction context wrapper
    const mockTx = {
      get: async (docRef: any) => docRef.get(),
      set: async (docRef: any, data: any, options?: any) => docRef.set(data, options),
      update: async (docRef: any, data: any) => docRef.update(data),
      delete: async (docRef: any) => docRef.delete(),
    };

    return updateFunction(mockTx);
  }

  // ─── Leads ────────────────────────────────────────────────────────────────────

  /**
   * leads — Lead Ad form submissions from Meta Lead Ads.
   * Source can be META_LEAD_AD, MANUAL, WEBHOOK, etc.
   */
  async createLead(data: Record<string, any>) {
    const id = this.generateId();
    const lead = { status: 'NEW', ...data, createdAt: new Date() };
    await this.col('leads').doc(id).set(lead);
    return { id, ...lead };
  }

  async getLeadsByBusinessId(businessId: string) {
    const snap = await this.col('leads')
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const timestamp = (value: any) => {
      if (!value) return 0;
      if (value instanceof Date) return value.getTime();
      if (typeof value.toDate === 'function') return value.toDate().getTime();
      if (typeof value._seconds === 'number') return value._seconds * 1000;
      const parsed = new Date(value).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    return results.sort((a: any, b: any) => timestamp(b.createdAt) - timestamp(a.createdAt));
  }

  async getLeadById(id: string) {
    const doc = await this.col('leads').doc(id).get();
    return this.snap<any>(doc);
  }

  async updateLead(id: string, data: Record<string, any>) {
    await this.col('leads').doc(id).update({ ...data, updatedAt: new Date() });
    const updated = await this.col('leads').doc(id).get();
    return { id, ...updated.data() };
  }

  async countLeadsByBusinessId(businessId: string): Promise<number> {
    const snap = await this.col('leads').where('businessId', '==', businessId).count().get();
    return snap.data().count;
  }

  async deleteLeadsByBusinessId(businessId: string) {
    const snap = await this.col('leads').where('businessId', '==', businessId).get();
    if (snap.empty) return;
    const batch = this.db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  // ─── Onboarding Conversations (Phase 1) ─────────────────────────────────────

  async createOnboardingConversation(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const convo = { ...data, createdAt: now, updatedAt: now };
    await this.col('onboardingConversations').doc(id).set(convo);
    return { id, ...convo };
  }

  async getOnboardingConversation(businessId: string) {
    const snap = await this.col('onboardingConversations')
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  async updateOnboardingConversation(id: string, data: Record<string, any>) {
    await this.col('onboardingConversations').doc(id).update({ ...data, updatedAt: new Date() });
    const updated = await this.col('onboardingConversations').doc(id).get();
    return { id, ...updated.data() };
  }

  // ─── Scheduled Posts (Phase 3) ────────────────────────────────────────────────

  async createScheduledPost(data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const post = { status: 'SCHEDULED', ...data, createdAt: now, updatedAt: now };
    await this.col('scheduledPosts').doc(id).set(post);
    return { id, ...post };
  }

  async getScheduledPostById(id: string) {
    const doc = await this.col('scheduledPosts').doc(id).get();
    return this.snap<any>(doc);
  }

  async getScheduledPostsByBusinessId(businessId: string) {
    const snap = await this.col('scheduledPosts')
      .where('businessId', '==', businessId)
      .get();
    const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return results.sort((a: any, b: any) => {
      const aTime = a.scheduledTime instanceof Date ? a.scheduledTime.getTime() : (a.scheduledTime?._seconds ? a.scheduledTime._seconds * 1000 : 0);
      const bTime = b.scheduledTime instanceof Date ? b.scheduledTime.getTime() : (b.scheduledTime?._seconds ? b.scheduledTime._seconds * 1000 : 0);
      return aTime - bTime;
    });
  }

  async updateScheduledPost(id: string, data: Record<string, any>) {
    await this.col('scheduledPosts').doc(id).update({ ...data, updatedAt: new Date() });
    if (this.socialPostsDao) {
      try {
        await this.socialPostsDao.update(id, data as any);
      } catch (e) {
        // ignore if not present in social_posts
      }
    }
    const updated = await this.col('scheduledPosts').doc(id).get();
    return { id, ...updated.data() };
  }

  async getDueScheduledPosts(): Promise<any[]> {
    const snap = await this.col('scheduledPosts')
      .where('status', '==', 'SCHEDULED')
      .get();
    const now = new Date();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((p) => {
        const scheduled = p.scheduledTime instanceof Date
          ? p.scheduledTime
          : new Date(p.scheduledTime?._seconds ? p.scheduledTime._seconds * 1000 : p.scheduledTime);
        return scheduled <= now;
      });
  }

  // ─── Generic Document Utilities ─────────────────────────────────────────────

  async createDocument(collectionName: string, data: Record<string, any>) {
    const id = this.generateId();
    const now = new Date();
    const docData = { ...data, createdAt: now, updatedAt: now };
    await this.col(collectionName).doc(id).set(docData);
    return { id, ...docData };
  }

  async updateDocument(collectionName: string, id: string, data: Record<string, any>) {
    const updateData = { ...data, updatedAt: new Date() };
    await this.col(collectionName).doc(id).update(updateData);
    const updated = await this.col(collectionName).doc(id).get();
    return { id, ...updated.data() };
  }
}
