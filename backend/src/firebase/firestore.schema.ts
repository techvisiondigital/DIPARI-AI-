/**
 * Firestore Schema & Type Definitions for Visionpilot AI Social Media Scheduler
 */

export type UserRole = 'ADMIN' | 'MEMBER' | 'AGENCY';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'PAUSED' | 'CANCELLED';

export type ScheduleRule = 'daily_10am' | 'alternate_days_10am' | 'every_5_days_10am';

export interface UserDocument {
  id: string;
  email: string;
  name: string;
  passwordHash?: string | null;
  role: UserRole;
  status: UserStatus;
  preferredLanguage: string;
  metaAccessToken?: string | null;
  metaIgBusinessAccountId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceDocument {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  niche: string; // Business niche/industry (e.g. Retail, E-commerce, Healthcare)
  vibe: string;  // Brand tone/voice (e.g. Professional, Casual, Festive, High-Energy)
  metaPageId?: string | null;
  metaPageName?: string | null;
  metaIgBusinessAccountId?: string | null;
  metaAdAccountId?: string | null;
  metaAccessToken?: string | null;
  metaPageAccessToken?: string | null;
  metaTokenExpiry?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialPostDocument {
  id: string;
  workspaceId: string;
  authorId: string;
  caption: string;
  imageUrl?: string | null;
  scheduleTime: Date; // Scheduled publishing time
  status: PostStatus;
  publishedPostId?: string | null; // Meta Graph Post ID after successful publishing
  errorMessage?: string | null;     // Error message if status === 'FAILED'
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── DTOs for Creation & Updates ──────────────────────────────────────────────

export interface CreateUserDto {
  email: string;
  name: string;
  passwordHash?: string | null;
  role?: UserRole;
  status?: UserStatus;
  preferredLanguage?: string;
}

export interface CreateWorkspaceDto {
  name: string;
  ownerId: string;
  niche?: string;
  vibe?: string;
}

export interface CreateSocialPostDto {
  workspaceId: string;
  authorId: string;
  caption: string;
  imageUrl?: string | null;
  scheduleTime: Date;
  status?: PostStatus;
}

// ─── Organic Scheduler Types ──────────────────────────────────────────────────

/** Result from a single platform publish attempt (Facebook or Instagram) */
export interface PublishChannelResult {
  success: boolean;
  postId?: string | null;
  containerId?: string | null; // Instagram container creation_id
  error?: string | null;
}

/** Combined publish result for simultaneous Facebook + Instagram publishing */
export interface PublishResult {
  facebook?: PublishChannelResult | null;
  instagram?: PublishChannelResult | null;
  publishedAt?: string | null;
}

/** Timestamped log entry for publish attempts (audit trail) */
export interface PublishLogEntry {
  timestamp: string;
  action: string; // e.g., 'PUBLISH_START', 'FB_SUCCESS', 'IG_CONTAINER_CREATED', 'PUBLISH_COMPLETE', 'PUBLISH_FAILED'
  platform?: 'facebook' | 'instagram' | 'both';
  details?: string | null;
  postId?: string | null;
  error?: string | null;
}

/** Firestore document for a scheduled organic post targeting 10:00 AM delivery */
export interface ScheduledOrganicPostDocument {
  id: string;
  businessId: string;
  caption: string;
  headline?: string | null;
  contentDescription?: string | null;
  hashtags?: string[];
  imageUrl?: string | null;
  platform: string;             // 'facebook' | 'instagram' | 'both'
  scheduledTime: Date;           // Exact 10:00 AM in business timezone (stored as UTC)
  timezone: string;              // IANA timezone (e.g., 'Asia/Kolkata')
  scheduleRule?: ScheduleRule;   // Which rule generated this slot
  batchId?: string | null;       // Groups posts from same batch scheduling call
  postType: string;              // 'Organic 10AM Post'
  status: PostStatus;
  publishResult?: PublishResult | null;
  publishLogs?: PublishLogEntry[];
  calendarEntryId?: string | null;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
