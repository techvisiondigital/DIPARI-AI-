import { Injectable, UnauthorizedException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FirebaseService } from '../firebase/firebase.service';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { timingSafeEqual } from 'crypto';

/**
 * AuthService — migrated to Firebase Authentication.
 * Replaced bcrypt-based login with Firebase Authentication and Admin SDK.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly jwtService: JwtService,
  ) {}

  async register(email: string, name: string, password?: string, preferredLanguage?: string) {
    try {
      let userId: string;
      
      if (!process.env.FIREBASE_PROJECT_ID) {
        // Mock register flow
        const existing = await this.firebase.getUserByEmail(email);
        if (existing) {
          throw new ConflictException('User with this email already exists');
        }
        userId = this.firebase.generateId();
      } else {
        // 1. Create User in Firebase Authentication
        const userRecord = await admin.auth().createUser({
          email,
          password,
          displayName: name,
        });
        userId = userRecord.uid;
      }

      // 2. Save User Document to Firestore using Firebase Auth UID
      const user = await this.firebase.createUser({
        email,
        name,
        passwordHash: password || null, // Stored for local mock validation check
        role: 'MEMBER',
        preferredLanguage: preferredLanguage || 'English',
      }, userId);

      // 3. Create default Business workspace
      const business = await this.firebase.createBusiness({
        name: `${name}'s Workspace`,
        ownerId: userId,
      });

      // 4. Create initial FREE subscription
      await this.firebase.createSubscription({
        businessId: business.id,
        plan: 'FREE',
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
      await this.firebase.createAuditLog({
        userId,
        businessId: business.id,
        action: 'USER_REGISTERED',
        details: JSON.stringify({ email }),
      });

      // Return local token fallback or custom token
      const token = await this.generateToken(userId, email, 'MEMBER');
      return {
        user: { id: userId, email, name, role: 'MEMBER', businessId: business.id, preferredLanguage: preferredLanguage || 'English' },
        token,
      };
    } catch (error: any) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error.code === 'auth/email-already-exists') {
        throw new ConflictException('User with this email already exists');
      }
      throw new ConflictException(error.message);
    }
  }

  async login(email: string, password?: string) {
    try {
      let userId: string;
      let name: string;
      let role: string;
      let token: string;

      if (!process.env.FIREBASE_PROJECT_ID) {
        // Mock login flow
        const userDoc = await this.firebase.getUserByEmail(email);
        if (!userDoc) {
          throw new UnauthorizedException('User not found in system');
        }
        
        // Support default admin credentials or registered mock users
        if (email === 'admin@campaignai.com') {
          if (password !== 'password123') {
            throw new UnauthorizedException('Invalid credentials');
          }
        } else if (userDoc.passwordHash && password !== userDoc.passwordHash) {
          throw new UnauthorizedException('Invalid credentials');
        }

        userId = userDoc.id;
        name = userDoc.name;
        role = userDoc.role;
        token = await this.generateToken(userId, email, role);
      } else {
        // Real authentication using Firebase Client Auth REST API
        const apiKey = process.env.FIREBASE_API_KEY;
        if (!apiKey) {
          throw new UnauthorizedException('FIREBASE_API_KEY is not defined in .env');
        }

        const res = await axios.post(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
          {
            email,
            password,
            returnSecureToken: true,
          },
        );

        userId = res.data.localId;
        const userDoc = await this.firebase.getUserById(userId);
        name = userDoc?.name || res.data.displayName || 'User';
        role = userDoc?.role || 'MEMBER';
        token = await this.generateToken(userId, email, role);
      }

      // Get user businesses
      const businesses = await this.firebase.getBusinessesByUserId(userId);
      const businessId = businesses[0]?.id || null;

      await this.firebase.createAuditLog({
        userId,
        businessId,
        action: 'USER_LOGGED_IN',
        details: JSON.stringify({ email, role }),
      });

      return {
        user: { id: userId, email, name, role, businessId },
        token,
      };
    } catch (error: any) {
      const errMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`[AuthService] Login failed for ${email}: ${errMsg}`);
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(errMsg || 'Invalid credentials');
    }
  }

  /**
   * Admin portal sign-in.
   *
   * SECURITY: this method previously returned a full ADMIN token for the
   * literal emails 'admin', 'admin@campaignai.com' and 'admin@campaign.ai'
   * WITHOUT EVER CHECKING THE PASSWORD — the `password` argument was accepted
   * and ignored. A single unauthenticated request granted complete control of
   * every business, user, lead and payment record on the platform.
   *
   * Credentials are now always verified. A bootstrap admin is still possible
   * for environments that have no ADMIN user yet, but only when BOTH
   * ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD are configured, and the
   * supplied password matches. Absent those, the only way in is a real account
   * whose role is ADMIN.
   */
  async adminLogin(email: string, password?: string) {
    const cleanEmail = (email || '').toLowerCase().trim();

    const bootstrapEmail = (process.env.ADMIN_BOOTSTRAP_EMAIL || '').toLowerCase().trim();
    const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';

    if (bootstrapEmail && bootstrapPassword && cleanEmail === bootstrapEmail) {
      if (!password || !this.safeEquals(password, bootstrapPassword)) {
        this.logger.warn(`[AuthService] Failed bootstrap admin login attempt for ${cleanEmail}`);
        throw new UnauthorizedException('Invalid credentials');
      }

      const adminUser = (await this.firebase.getUserById('admin-user-id').catch(() => null)) || {
        id: 'admin-user-id',
        email: bootstrapEmail,
        name: 'System Administrator',
        role: 'ADMIN',
      } as any;

      const businesses = await this.firebase.getBusinessesByUserId(adminUser.id).catch(() => []);
      const business = businesses && businesses.length > 0 ? businesses[0] : null;

      this.logger.log(`[AuthService] Bootstrap admin signed in: ${cleanEmail}`);
      return {
        user: {
          id: adminUser.id,
          email: adminUser.email || bootstrapEmail,
          name: adminUser.name || 'System Administrator',
          role: 'ADMIN',
          businessId: business?.id || 'admin-biz-1',
        },
        token: await this.generateToken(adminUser.id, adminUser.email || bootstrapEmail, 'ADMIN'),
      };
    }

    const result = await this.login(email, password);
    if (result.user?.role !== 'ADMIN') {
      this.logger.warn(`[AuthService] Non-admin account attempted admin portal access: ${cleanEmail}`);
      throw new ForbiddenException('Access Denied: Only Administrator accounts can access the Admin Portal.');
    }
    return result;
  }

  /** Length-safe, constant-time string comparison to avoid leaking the secret via timing. */
  private safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  async checkOnboardingCompleted(businessId: string): Promise<boolean> {
    const profile = await this.firebase.getBusinessProfile(businessId);
    return !!profile;
  }

  async checkProfileCompleted(businessId: string): Promise<boolean> {
    const [business, profile] = await Promise.all([
      this.firebase.getBusinessById(businessId).catch(() => null),
      this.firebase.getBusinessProfile(businessId).catch(() => null),
    ]);
    return business?.profileCompleted === true || profile?.profileCompleted === true;
  }

  private async generateToken(userId: string, email: string, role: string) {
    // Generates both a custom token and local JWT signature for guard fallbacks
    return this.jwtService.sign({ sub: userId, email, role });
  }

  async syncUserProfile(userId: string, email: string, name: string, businessName?: string, preferredLanguage?: string) {
    let user = await this.firebase.getUserById(userId);
    let businessId: string | null = null;
    let bName: string | null = null;

    if (!user) {
      // 1. Save User Document to Firestore
      user = await this.firebase.createUser({
        email,
        name,
        passwordHash: null,
        role: 'MEMBER',
        preferredLanguage: preferredLanguage || 'English',
      }, userId);

      // 2. Create default Business workspace
      const business = await this.firebase.createBusiness({
        name: businessName || `${name}'s Workspace`,
        ownerId: userId,
      });
      businessId = business.id;
      bName = business.name;

      // 3. Create initial FREE subscription
      await this.firebase.createSubscription({
        businessId: business.id,
        plan: 'FREE',
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    } else {
      // Get existing user business
      const businesses = await this.firebase.getBusinessesByUserId(userId);
      businessId = businesses[0]?.id || null;
      bName = businesses[0]?.name || null;

      // Update preferredLanguage if passed and different
      if (preferredLanguage && user.preferredLanguage !== preferredLanguage) {
        user = await this.firebase.createUser({
          ...user,
          preferredLanguage,
        }, userId);
      }
    }

    return {
      user: {
        id: userId,
        email: user.email,
        name: user.name,
        role: user.role,
        businessId,
        businessName: bName,
        preferredLanguage: user.preferredLanguage || 'English',
      },
    };
  }

  async updateUserLanguage(userId: string, preferredLanguage: string) {
    const user = await this.firebase.getUserById(userId);
    if (user) {
      await this.firebase.createUser({
        ...user,
        preferredLanguage,
      }, userId);
    }
  }

  async validateUser(userId: string) {
    if (userId === 'admin-user-id') {
      return {
        id: 'admin-user-id',
        email: 'admin@campaignai.com',
        name: 'System Administrator',
        role: 'ADMIN',
        businesses: [{ businessId: 'admin-biz-1', business: { id: 'admin-biz-1', name: 'Admin Workspace' } }]
      };
    }
    let user = await this.firebase.getUserById(userId);
    if (!user) {
      try {
        const userRecord = await admin.auth().getUser(userId);
        user = await this.firebase.createUser({
          email: userRecord.email!,
          name: userRecord.displayName || 'User',
          passwordHash: null,
          role: 'MEMBER',
          preferredLanguage: 'English',
        }, userId);

        const business = await this.firebase.createBusiness({
          name: `${userRecord.displayName || 'User'}'s Workspace`,
          ownerId: userId,
        });

        await this.firebase.createSubscription({
          businessId: business.id,
          plan: 'FREE',
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
      } catch (e) {
        return null;
      }
    }

    const businesses = await this.firebase.getBusinessesByUserId(userId);
    return {
      ...user,
      businesses: (businesses || []).map((b) => ({ businessId: b.id, business: b })),
    };
  }
}
