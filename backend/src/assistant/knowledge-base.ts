/**
 * Visionpilot AI Knowledge Base & RAG Chunks.
 *
 * Comprehensive product documentation and indexed chunks used by RagService
 * to power the Visionpilot AI Help Bot (Meta authorised AI marketing agent).
 */

export interface KnowledgeChunk {
  id: string;
  title: string;
  module: string;
  pageUrl: string;
  keywords: string[];
  content: string;
  steps?: string[];
  nextSteps?: string;
}

export const CAMPAIGNAI_CHUNKS: KnowledgeChunk[] = [
  // --- 1. Account & Authentication ---
  {
    id: 'auth-registration',
    title: 'Account Registration & Signup',
    module: 'Account & Authentication',
    pageUrl: '/register',
    keywords: ['register', 'signup', 'create account', 'new user', 'join', 'sign up', 'registration', 'visionpilot'],
    content: 'To create a new Visionpilot AI account, visit the Registration page. You can sign up using your email and password or perform single-click sign-up with Google OAuth. Upon registration, you will be prompted to set up your business profile or run the Onboarding Wizard.',
    steps: [
      'Navigate to the Register page (/register).',
      'Enter your Full Name, Email Address, and Password (or click "Sign in with Google").',
      'Click "Create Account".',
      'Proceed to Business Onboarding to set up your marketing profile.'
    ],
    nextSteps: 'Complete the 20-question Onboarding Wizard to let AI tailor your marketing strategy.'
  },
  {
    id: 'auth-login',
    title: 'Account Login',
    module: 'Account & Authentication',
    pageUrl: '/login',
    keywords: ['login', 'sign in', 'log in', 'access account', 'credentials', 'password'],
    content: 'Existing users can log into Visionpilot AI by entering their registered email and password on the Login page, or by choosing Google Sign In.',
    steps: [
      'Navigate to the Login page (/login).',
      'Enter your registered Email Address and Password.',
      'Click "Log In" or select "Continue with Google".',
      'You will be redirected straight to your Visionpilot AI Dashboard.'
    ],
    nextSteps: 'Go to Dashboard to review active campaign metrics or connect your Meta account.'
  },
  {
    id: 'auth-forgot-password',
    title: 'Forgot Password & Password Reset',
    module: 'Account & Authentication',
    pageUrl: '/forgot-password',
    keywords: ['forgot password', 'reset password', 'change password', 'recover password', 'password link', 'reset email'],
    content: 'If you forgot your password, you can reset it via the Forgot Password option on the Login page. Visionpilot AI sends a password reset link to your registered email address via Firebase Authentication.',
    steps: [
      'On the Login page (/login), click "Forgot Password?".',
      'Enter your registered email address.',
      'Click "Send Reset Link".',
      'Check your email inbox (and spam folder) for the password reset email.',
      'Click the link in the email to set a new secure password.'
    ],
    nextSteps: 'Return to the Login page and sign in with your new password.'
  },
  {
    id: 'auth-google',
    title: 'Google Sign In',
    module: 'Account & Authentication',
    pageUrl: '/login',
    keywords: ['google sign in', 'google auth', 'google login', 'gmail login', 'oauth', 'google sso'],
    content: 'Google Sign In allows fast, passwordless access to Visionpilot AI using your Google account via Firebase OAuth integration.',
    steps: [
      'On the Login or Register page, click "Continue with Google".',
      'Select your Google Account from the popup window.',
      'Grant permissions to authenticate.',
      'Visionpilot AI will create or authenticate your user session automatically.'
    ],
    nextSteps: 'Check your Business Profile under Settings to ensure account details are accurate.'
  },
  {
    id: 'auth-admin-login',
    title: 'Admin Portal Login',
    module: 'Account & Authentication',
    pageUrl: '/admin',
    keywords: ['admin login', 'admin portal', 'system admin', 'platform metrics', 'manage users', 'admin tickets'],
    content: 'System administrators can access the Visionpilot AI Admin Portal to view system-wide metrics, manage registered users, monitor business profiles, and handle escalated support tickets.',
    steps: [
      'Navigate to the Admin Portal (/admin).',
      'Authenticate with admin credentials.',
      'View global user statistics, platform activity, and support tickets.'
    ],
    nextSteps: 'Review open tickets or monitor system performance indicators.'
  },

  // --- 2. Dashboard ---
  {
    id: 'dashboard-overview',
    title: 'Dashboard Overview & Metrics',
    module: 'Dashboard',
    pageUrl: '/dashboard',
    keywords: ['dashboard', 'metrics', 'kpi', 'spend', 'impressions', 'clicks', 'conversions', 'roas', 'cpc', 'cpm', 'ctr', 'overview'],
    content: 'The Dashboard is your main command center. It displays key campaign metrics: Total Spend, Total Impressions, Total Clicks, Conversions, CTR (Click-Through Rate), CPC (Cost Per Click), CPM (Cost Per 1000 Impressions), and ROAS (Return On Ad Spend). It also features quick action buttons, active campaign status, and real-time AI optimization recommendations.',
    steps: [
      'Click "Dashboard" in the left navigation sidebar.',
      'Review top KPI cards for spend, impressions, clicks, conversions, and ROAS.',
      'Inspect the Active Campaigns table to check campaign statuses.',
      'Read the AI Recommendations box for suggested budget adjustments or ad refreshes.'
    ],
    nextSteps: 'Click "Create Campaign" to launch a new campaign or navigate to Analytics for deeper demographic data.'
  },

  // --- 3. Business Onboarding ---
  {
    id: 'business-onboarding',
    title: 'Business Onboarding Strategy Wizard',
    module: 'Business Onboarding',
    pageUrl: '/onboarding',
    keywords: ['onboarding', 'wizard', '20 questions', 'business profile', 'strategy wizard', 'business details', 'setup strategy'],
    content: 'During Business Onboarding, Visionpilot AI uses an interactive 20-question chatbot wizard to gather comprehensive information about your business: business name, category, products/services, target audience demographics, location, monthly budget, brand tone, competitors, USP, and goals. This data powers AI ad generation, content calendar plans, and budget optimization.',
    steps: [
      'Navigate to Onboarding (/onboarding).',
      'Answer the interactive questions presented by the Onboarding AI assistant.',
      'Provide details about your products, ideal target audience, budget, and brand voice.',
      'Click "Complete Profile" once finished to finalize your marketing strategy.'
    ],
    nextSteps: 'Proceed to Meta Integration to connect your Facebook & Instagram ad accounts.'
  },

  // --- 4. Meta Business Connection ---
  {
    id: 'meta-connection',
    title: 'Meta Business Connection (Facebook & Instagram)',
    module: 'Meta Business Connection',
    pageUrl: '/settings?tab=meta',
    keywords: ['meta connection', 'connect meta', 'facebook integration', 'instagram integration', 'facebook page', 'ad account', 'oauth', 'link facebook', 'link instagram', 'meta business'],
    content: 'Connecting Meta Business enables Visionpilot AI to publish posts directly to Facebook Pages and Instagram Business accounts, manage Meta ad campaigns, capture leads from Lead Gen forms, and pull real-time campaign insights.',
    steps: [
      'Go to Settings → Meta Integration tab.',
      'Click the "Connect Meta Business" button.',
      'Log into Facebook in the OAuth popup window.',
      'Grant requested permissions (ads_management, pages_manage_posts, instagram_basic, leads_retrieval).',
      'Select your Facebook Page, Instagram Business Account, and Meta Ad Account.',
      'Click "Save & Sync Connection".'
    ],
    nextSteps: 'Go to Campaigns to create your first ad campaign or Content Calendar to schedule posts.'
  },
  {
    id: 'meta-permissions-errors',
    title: 'Meta Connection Errors & Permissions Troubleshooting',
    module: 'Meta Business Connection',
    pageUrl: '/settings?tab=meta',
    keywords: ['meta error', 'meta permission', 'token expired', 'facebook error', 'instagram error', 'connection failed', 'reconnect meta', 'troubleshoot meta'],
    content: 'If Meta integration fails or shows an error (such as "Token Expired", "Permissions Missing", or "Page Not Found"), navigate to Settings → Meta Integration, click "Disconnect Account", and reconnect Meta Business to refresh your OAuth access tokens and permissions.',
    steps: [
      'Go to Settings → Meta Integration.',
      'Click "Disconnect Meta Account".',
      'Click "Connect Meta Business" to trigger Facebook OAuth again.',
      'Ensure all permissions (pages_manage_posts, ads_management, instagram_content_publish, leads_retrieval) are checked.',
      'Re-select your Page and Ad Account, then click "Save".'
    ],
    nextSteps: 'Test post publishing or ad creation to confirm the connection is restored.'
  },

  // --- 5. Campaign Creation ---
  {
    id: 'campaign-creation',
    title: 'Creating Ads with AI Campaign Generator',
    module: 'Campaign Creation',
    pageUrl: '/campaigns/new',
    keywords: ['create campaign', 'new campaign', 'campaign wizard', 'ai generator', 'ad creation', 'target audience', 'budget', 'ad copy', 'publish ad'],
    content: 'Visionpilot AI allows you to create high-converting Meta ad campaigns in minutes using the AI Campaign Generator or step-by-step Campaign Wizard. AI automatically generates persuasive ad copy, catchy headlines, call-to-action buttons, target audience recommendations, and daily budget allocations based on your onboarding profile.',
    steps: [
      'Navigate to Campaigns → Click "Create Campaign".',
      'Select your Campaign Objective (Lead Generation, Traffic, Conversions, or Brand Awareness).',
      'Set your Daily Budget and target demographics (Age, Gender, Location, Interests).',
      'Click "Generate Ad Copy" to let AI write headlines, body copy, and CTA.',
      'Review ad creative preview for Facebook & Instagram.',
      'Click "Publish Campaign" to deploy the campaign to Meta.'
    ],
    nextSteps: 'Monitor campaign performance on the Dashboard or track detailed insights in Analytics.'
  },
  {
    id: 'campaign-auto-generator',
    title: 'AI Auto-Generate Campaign',
    module: 'Campaign Creation',
    pageUrl: '/campaigns',
    keywords: ['auto generate', 'ai campaign generator', 'automatic campaign', 'instant campaign', 'one click campaign', 'ai ads'],
    content: 'The AI Auto-Generate feature creates complete campaigns automatically using your business profile. It selects optimal audience targeting, sets suggested daily budgets, generates ad copy variants, and builds ad sets ready for one-click publishing.',
    steps: [
      'Go to Campaigns page.',
      'Click "AI Auto-Generate Campaign".',
      'Select the primary focus (e.g. Lead Generation or Website Traffic).',
      'Review the AI-generated campaign structure and ad creative.',
      'Click "Approve & Publish".'
    ],
    nextSteps: 'Check Dashboard to track initial impressions and click metrics.'
  },

  // --- 6. Content Calendar & Auto Scheduler ---
  {
    id: 'content-calendar',
    title: 'AI Content Calendar & Weekly Planner',
    module: 'AI Content Calendar',
    pageUrl: '/calendar',
    keywords: ['content calendar', 'content planner', 'weekly plan', 'ai posts', 'generate calendar', 'post generator', 'captions', 'hashtags', 'cta'],
    content: 'The AI Content Calendar automatically plans a 5-day weekly social media schedule (Monday through Friday) tailored to your industry and brand tone. Each post entry includes Caption, Headline, CTA, Hashtags, Post Type (Carousel, Image, Reel prompt), Best Posting Time, Platform (FB/IG), and AI Image Generation Prompts.',
    steps: [
      'Navigate to Content Calendar (/calendar).',
      'Click "Generate Weekly Plan" to build a fresh 5-day content strategy.',
      'Review each daily post card.',
      'Click on any post to edit caption, hashtags, or scheduled posting time.',
      'Click "Approve & Schedule All" to send posts to the Auto Scheduler.'
    ],
    nextSteps: 'View the Scheduler panel to monitor pending, published, or paused posts.'
  },
  {
    id: 'auto-scheduler',
    title: 'Auto Scheduler & Post Management',
    module: 'Auto Scheduler',
    pageUrl: '/calendar?tab=scheduler',
    keywords: ['auto scheduler', 'scheduler', 'cron', 'queue', 'pause post', 'resume post', 'reschedule', 'cancel post', 'automatic publishing'],
    content: 'The Auto Scheduler automatically publishes approved posts to Facebook and Instagram at their scheduled dates and times. An internal background engine checks the posting queue every 5 minutes. Users can pause, resume, reschedule, or cancel individual posts at any time.',
    steps: [
      'Go to Content Calendar → Scheduler tab.',
      'View scheduled posts listed by date and status (Pending, Published, Paused, Failed).',
      'To pause or cancel a post, click the action menu on the post item.',
      'To change posting time, click "Edit Schedule" and select a new date/time.'
    ],
    nextSteps: 'Check Analytics to measure engagement on published posts.'
  },

  // --- 7. Lead Management & AI Lead Assistant ---
  {
    id: 'lead-crm',
    title: 'Lead Management & CRM',
    module: 'Lead Management',
    pageUrl: '/leads',
    keywords: ['lead management', 'lead crm', 'leads', 'capture leads', 'search leads', 'filter leads', 'assign lead', 'lead status', 'meta lead gen'],
    content: 'The Lead CRM captures leads automatically from Meta Lead Gen forms and website webhooks in real time. It displays all leads in a structured CRM table containing Name, Email, Phone, Lead Status (New, Contacted, Qualified, Converted), Source, Campaign, and Date.',
    steps: [
      'Navigate to Lead Management (/leads).',
      'Use the Search bar to search by name, email, or phone number.',
      'Filter leads by Status (New, Contacted, Qualified, Converted) or date range.',
      'Click on a lead row to view full details, add notes, or reassign.'
    ],
    nextSteps: 'Use the AI Lead Assistant to generate automated follow-up drafts and call scripts.'
  },
  {
    id: 'lead-export-csv',
    title: 'Exporting Leads to CSV',
    module: 'Lead Management',
    pageUrl: '/leads',
    keywords: ['export leads', 'export csv', 'download leads', 'csv download', 'lead report', 'save leads'],
    content: 'You can export your captured lead data into a CSV file for import into external CRMs or email marketing tools.',
    steps: [
      'Navigate to Lead Management (/leads).',
      'Apply any desired status or date filters (or leave default to export all leads).',
      'Click the "Export CSV" button at the top right of the table.',
      'The CSV file will automatically download to your device.'
    ],
    nextSteps: 'Open the downloaded file in Excel or import into your sales software.'
  },
  {
    id: 'ai-lead-assistant',
    title: 'AI Lead Assistant (Scoring, WhatsApp, Email & Call Scripts)',
    module: 'AI Lead Assistant',
    pageUrl: '/leads',
    keywords: ['ai lead assistant', 'lead scoring', 'lead priority', 'whatsapp message', 'email draft', 'call script', 'lead summary', 'follow up strategy'],
    content: 'The AI Lead Assistant analyzes incoming lead details and automatically provides: 1) Executive Requirement Summary, 2) Lead Priority Score (HIGH/MEDIUM/LOW with rationale), 3) Recommended Follow-Up Strategy, 4) Personalized WhatsApp Message, 5) Professional Email Draft, and 6) Structured Call Script.',
    steps: [
      'Go to Lead Management (/leads).',
      'Click on any lead row in the CRM table.',
      'Click the "AI Assistant" button on the drawer panel.',
      'Review the Lead Score, Summary, and Recommended Follow-up Plan.',
      'Copy the generated WhatsApp message, Email draft, or Call script with one click.'
    ],
    nextSteps: 'Reach out to the lead using the generated communication scripts and update lead status to Contacted.'
  },

  // --- 8. Analytics & Reports ---
  {
    id: 'analytics-reports',
    title: 'Analytics & Performance Reports',
    module: 'Analytics',
    pageUrl: '/analytics',
    keywords: ['analytics', 'reports', 'demographic', 'gender split', 'age groups', 'facebook vs instagram', 'platform split', 'performance trends', 'roas report'],
    content: 'Visionpilot AI Analytics provides in-depth reporting on your marketing campaigns: Summary performance metrics, Demographic breakdown (Gender: Male/Female/Unknown, Age groups: 18-24, 25-34, 35-44, 45-54, 55-64, 65+), Platform breakdown (Facebook vs Instagram performance), and daily performance trends.',
    steps: [
      'Click "Analytics" in the left sidebar menu.',
      'Select a time range (Last 7 Days, Last 30 Days, Custom Range).',
      'Examine the Demographic charts for age and gender distribution.',
      'Compare Facebook vs Instagram CTR and conversion rate on the Platform chart.',
      'Click "Export Report" to download a summary report.'
    ],
    nextSteps: 'Use findings to refine campaign audience targeting or adjust channel budget allocation.'
  },

  // --- 9. Settings & Preferences ---
  {
    id: 'settings-profile',
    title: 'Settings & Business Profile Management',
    module: 'Settings',
    pageUrl: '/settings',
    keywords: ['settings', 'business profile', 'edit business', 'brand tone', 'target location', 'budget settings', 'preferences', 'dark mode', 'theme', 'notifications'],
    content: 'The Settings page allows you to update your Business Profile (name, industry category, products/services, target audience, brand voice, monthly budget), manage Meta connection status, select light/dark theme mode, and configure notification alerts.',
    steps: [
      'Click "Settings" in the bottom left navigation menu.',
      'Under "Business Profile", update business details, budget, or brand tone.',
      'Under "Preferences", toggle Light/Dark Mode theme or adjust notification settings.',
      'Click "Save Changes".'
    ],
    nextSteps: 'All future AI-generated campaigns and posts will reflect your updated business settings.'
  },

  // --- 10. Subscription Plans ---
  {
    id: 'subscription-plans',
    title: 'Subscription Plans & Billing',
    module: 'Subscription Plans',
    pageUrl: '/settings?tab=billing',
    keywords: ['subscription', 'plans', 'pricing', 'free plan', 'premium plan', 'billing', 'upgrade', 'invoice', 'api limits'],
    content: 'Visionpilot AI offers flexible subscription plans tailored to business size: Free Tier (basic campaigns, limited content generation, manual export) and Premium Tiers (unlimited AI campaign generation, full Content Calendar, AI Lead Assistant, auto-publishing, advanced analytics, priority support).',
    steps: [
      'Go to Settings → Billing & Subscription tab.',
      'View your current active plan and monthly usage quotas.',
      'Click "Upgrade Plan" to select a Premium tier.',
      'Complete billing setup to unlock unlimited AI features.'
    ],
    nextSteps: 'Manage invoices and payment methods from the billing portal.'
  },

  // --- 11. Support Tickets & Help Assistant ---
  {
    id: 'support-tickets',
    title: 'Support Tickets & Customer Support',
    module: 'Support Tickets',
    pageUrl: '/support',
    keywords: ['support', 'tickets', 'create ticket', 'help ticket', 'customer service', 'support request', 'ticket status', 'help bot'],
    content: 'If you encounter an issue or have a complex technical request, you can submit a Support Ticket directly through the platform. Track your ticket status (Open, In Progress, Resolved) and receive updates from the Visionpilot AI support team.',
    steps: [
      'Navigate to Support (/support).',
      'Click "Create Ticket".',
      'Enter Subject, Category (Billing, Technical, Meta Integration, General), and detailed Description.',
      'Click "Submit Ticket".',
      'Track ticket status and view resolution notes under My Tickets.'
    ],
    nextSteps: 'You can also ask the Visionpilot AI Help Bot anytime from the floating bottom-left chat icon!'
  },

  // --- 12. Troubleshooting & FAQs ---
  {
    id: 'troubleshooting-faqs',
    title: 'Troubleshooting & Frequently Asked Questions',
    module: 'FAQs',
    pageUrl: '/support#faq',
    keywords: ['faq', 'error', 'troubleshoot', 'help', 'issue', 'problem', 'not working', 'fix', 'cannot post', 'ad disapproved'],
    content: 'Common Visionpilot AI FAQs:\n- Q: Why did my post fail to publish?\nA: Check Settings → Meta Integration. Ensure your Facebook Page & Instagram account tokens are connected and permissions have not expired.\n- Q: How often does the Auto Scheduler run?\nA: It executes background checks every 5 minutes.\n- Q: Can I export my leads?\nA: Yes, go to Lead Management and click "Export CSV".\n- Q: Is Google Sign In supported?\nA: Yes, you can log in using Google OAuth on the Login page.',
    steps: [
      'Check if your issue is covered under the FAQs in Settings or Support.',
      'For connection issues, disconnect and reconnect Meta under Settings → Meta Integration.',
      'For general questions about features, ask the Visionpilot AI Help Bot in the chat drawer.'
    ],
    nextSteps: 'If the issue persists, submit a Support Ticket under /support.'
  }
];

export const CAMPAIGNAI_KNOWLEDGE_BASE = `
# Visionpilot AI — Official Platform Documentation (Meta Authorised AI Marketing Agent) & RAG Knowledge Base

## 1. Account & Authentication
- **Registration (/register)**: Register using email/password or Google OAuth. Creates user profile and initializes onboarding.
- **Login (/login)**: Login with registered email and password or single-click Google Sign In.
- **Forgot Password (/forgot-password)**: Request password reset link sent to registered email via Firebase Auth.
- **Google Sign In**: One-click passwordless authentication using Google OAuth.
- **Admin Login (/admin)**: Portal for platform administrators to monitor users, businesses, stats, and support tickets.

## 2. Dashboard
- **Overview Metrics (/dashboard)**: Real-time dashboard showing Total Spend, Impressions, Clicks, Conversions, CTR, CPC, CPM, and ROAS.
- **Active Campaigns**: Displays running campaigns with real-time status indicators.
- **AI Recommendations**: Automated suggestions for budget optimization, targeting refinement, and creative refresh.
- **Quick Actions**: Shortcuts to launch campaigns, view lead CRM, connect Meta, or open analytics.

## 3. Business Onboarding
- **Onboarding Wizard (/onboarding)**: Interactive 20-question chatbot strategy wizard gathering business name, category, products, audience demographics, location, monthly budget, brand tone, USP, and competitors.
- **Profile Customization**: Establishes baseline parameters for AI ad copy generator and content calendar.

## 4. Meta Business Connection
- **Meta Integration (/settings?tab=meta)**: Authorize Facebook OAuth to connect Meta Business.
- **Linked Accounts**: Connect Facebook Pages, Instagram Business Accounts, and Meta Ad Accounts.
- **Permissions**: Requires ads_management, pages_manage_posts, instagram_content_publish, leads_retrieval, read_insights.
- **Troubleshooting**: Token expiration or permission errors are resolved by clicking "Disconnect Account" and reconnecting Meta under Settings → Meta Integration.

## 5. Campaign Creation & AI Generator
- **AI Campaign Wizard (/campaigns/new)**: Step-by-step campaign builder for Lead Generation, Traffic, Conversions, or Brand Awareness.
- **AI Auto-Generate**: One-click AI campaign creation based on onboarding profile data.
- **Targeting & Budget**: Configure age, location, gender, interest targeting, and daily ad budget.
- **Publishing**: Direct publishing of ad sets and creative assets to Facebook & Instagram.

## 6. AI Content Calendar & Auto Scheduler
- **Content Calendar (/calendar)**: Generates a 5-day weekly posting strategy (Monday-Friday) complete with headlines, captions, CTAs, hashtags, posting times, and AI image prompts.
- **Auto Scheduler (/calendar?tab=scheduler)**: Background job running every 5 minutes to publish scheduled posts. Supports pause, resume, reschedule, and cancel options.

## 7. Lead Management & AI Lead Assistant
- **Lead CRM (/leads)**: CRM table displaying captured leads with Name, Email, Phone, Status (New, Contacted, Qualified, Converted), Source, and Campaign.
- **Real-Time Capture**: Captures leads instantly from Meta Lead Gen form webhooks.
- **CSV Export**: Export all filtered leads to CSV with one click.
- **AI Lead Assistant**: AI lead summary, HIGH/MEDIUM/LOW priority scoring, follow-up plan, WhatsApp message generator, Email draft generator, and structured Call Scripts.

## 8. Analytics & Reports
- **Reports (/analytics)**: Performance dashboards showing total spend, conversions, ROAS, CPC, CTR.
- **Demographic Insights**: Gender split (Male/Female/Unknown) and Age distribution (18-24, 25-34, 35-44, 45-54, 55-64, 65+).
- **Platform Performance**: Side-by-side comparison of Facebook vs Instagram engagement and conversion metrics.

## 9. Settings & Preferences
- **Business Profile (/settings)**: Update business name, products, brand tone, location, and target audience.
- **Preferences**: Light/Dark theme toggle and notification alert settings.

## 10. Subscription Plans & Pricing
- **Basic (Free 7 days trial)**: Free. Includes 3 posts (2 standard, 1 carousel) / week, graphics regeneration 3 times, No Ad campaign, Experience next generation Marketing.
- **Advance Plan**: ₹5,000. Includes 3 posts (2 standard, 1 carousel) / week, graphics regeneration 3 times, 15 days Ad campaign, 24X7 support, Visible growth in sales in 1 week.
- **Premium Plan**: ₹10,000. Includes 5 posts (2 standard, 1 carousel) / week, graphics regeneration 3 times, 30 days Ad campaign, 24X7 support, Visible growth in sales in 1 week.
- **Customized Plan**: Contact Us. Tailored customized plan created as per your budget.

## 11. Support Tickets & Support Assistant
- **Support Tickets (/support)**: Create, track, and manage customer support requests (Open, In Progress, Resolved).
- **Visionpilot AI Help Bot**: Official floating support assistant available 24/7 (Meta authorised AI marketing agent).
`;

export const ALLOWED_TOPICS = [
  'visionpilot', 'visionpilotai', 'campaignai', 'dashboard', 'campaigns', 'campaign', 'meta', 'facebook', 'instagram',
  'analytics', 'content calendar', 'content planner', 'scheduler', 'scheduling',
  'lead management', 'leads', 'crm', 'settings', 'subscription', 'billing',
  'authentication', 'login', 'signup', 'register', 'password', 'support', 'help',
  'ticket', 'onboarding', 'business profile', 'optimization', 'recommendations',
  'ad account', 'budget', 'targeting', 'audience', 'creative', 'ad copy', 'headline',
  'cta', 'posting', 'publish', 'webhook', 'integration', 'connect', 'disconnect',
  'export', 'csv', 'whatsapp', 'email', 'call script', 'ai assist', 'ai assistant',
  'notification', 'theme', 'dark mode', 'light mode', 'forgot password', 'google sign in',
  'admin', 'roas', 'cpc', 'cpm', 'ctr', 'lead gen'
];
