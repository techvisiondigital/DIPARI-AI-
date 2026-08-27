import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Plus,
  Search,
  Bell,
  User as UserIcon,
  LayoutDashboard,
  Wand2,
  TrendingUp,
  LogOut,
  Sun,
  Moon,
  Send,
  Cpu,
  Bot,
  FileText,
  AlertTriangle,
  CheckCircle,
  MessageSquare,
  Clock,
  ArrowRight,
  Shield,
  Activity,
  IndianRupee,
  MousePointerClick,
  Target,
  ChevronRight,
  Info,
  X,
  Building,
  Menu,
  Calendar as CalendarIcon,
  Settings as SettingsIcon,
  Sparkles,
  Users,
} from 'lucide-react';
import { api } from './services/api';
import { auth } from './services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { friendlyError } from './utils/errorMessages';
import { AuthScreens } from './components/AuthScreens';
import { AdminPortal } from './components/AdminPortal';
import CampaignGenerator from './components/CampaignGenerator';
import ConnectMeta from './components/ConnectMeta';
import { ContentCalendar } from './components/ContentCalendar';
import { LeadsDashboard } from './components/LeadsDashboard';
import { ProfileScreen } from './components/ProfileScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SmartInputControls } from './components/SmartInputControls';
import { BusinessBlueprintReview } from './components/BusinessBlueprintReview';


interface ToastMsg {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'alert' | 'info';
}



const DEFAULT_ONBOARDING_QUESTIONS = [
  'What is the name of your business?',
  'What category does your business fall under? (e.g., E-commerce, SaaS, Restaurant, Fashion, Healthcare, Education, Real Estate, etc.)',
  'What products or services does your business offer?',
  'Who is your ideal target audience? Describe your ideal customer.',
  'What is the age group of your target customers? (e.g., 18-24, 25-34, 35-44, 45-54, 55+)',
  'Who do you primarily target? (Male / Female / Both)',
  'What geographic locations do you serve? (City, State, Country, or Global)',
  'What are your primary business goals right now? (e.g., Increase sales, Generate leads, Build brand awareness)',
  'What is your monthly marketing budget? (in your local currency)',
  'Who are your main competitors? List 2-3 competitor names.',
  'How would you describe your brand tone? (e.g., Professional, Casual, Fun, Luxury, Friendly, Bold)',
  'How often would you like to post on social media? (e.g., Daily, 3 times/week, 5 times/week, Weekly)',
  'What languages should your marketing content be in? (e.g., English, Hindi, Spanish, or multiple)',
  'What is your business\'s Unique Selling Proposition (USP)? What makes you different from competitors?'
];

export default function App() {
  // Meta authorization codes are single-use. Keep a per-mount guard because
  // React Strict Mode runs effects twice in development.
  const processedMetaOAuthCode = useRef<string | null>(null);
  // Theme & Navigation State
  const [isLight, setIsLight] = useState(true);
  const [currentPage, setCurrentPage] = useState<'landing' | 'auth' | 'admin-login' | 'onboarding' | 'blueprint' | 'dashboard' | 'builder' | 'generator' | 'manager' | 'analytics' | 'support' | 'admin' | 'connect-meta' | 'calendar' | 'settings' | 'profile' | 'leads'>(() => {
    const saved = (localStorage.getItem('visionpilot_active_page') || localStorage.getItem('dipari_active_page'));
    return (saved && saved !== 'auth' && saved !== 'admin-login' && saved !== 'scheduler' && saved !== 'instant-posts') ? (saved as any) : 'landing';
  });

  useEffect(() => {
    if (currentPage && currentPage !== 'auth' && currentPage !== 'admin-login') {
      localStorage.setItem('visionpilot_active_page', currentPage);
    }
  }, [currentPage]);

  // Auth state
  const [user, setUser] = useState<any>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Mandatory Profile Gate Navigation Helper
  const navigateWithProfileCheck = (targetPage: typeof currentPage) => {
    const isProfileComplete = user?.profileCompleted || false;
    if (!isProfileComplete && ['dashboard', 'builder', 'generator', 'manager', 'analytics', 'calendar', 'leads', 'connect-meta', 'support', 'settings'].includes(targetPage)) {
      addToast('Profile Incomplete', 'Please fill and save your Profile details (Logo, Contact Number, Website, Business Name) to unlock dashboard features.', 'alert');
      setCurrentPage('profile');
      return;
    }
    setCurrentPage(targetPage);
  };
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      setGlobalError(`${event.message} at ${event.filename}:${event.lineno}`);
    };
    window.addEventListener('error', handleGlobalError);
    return () => window.removeEventListener('error', handleGlobalError);
  }, []);
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  
  // Workspace selection
  const activeWorkspace = user?.businessName || 'Omni Retail Inc.';
  
  // Chat Assistant sliding drawer state
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([
    { role: 'model', content: "Hello! 👋 I am the official Visionpilot AI Help Assistant (Meta authorised AI marketing agent). How can I help you with Visionpilot AI today? Ask me about account setup, Meta integration, creating campaigns, content scheduling, lead CRM, analytics, or platform features!" }
  ]);
  const [assistantInput, setAssistantInput] = useState('');
  const [currentConvoId, setCurrentConvoId] = useState<string | undefined>(undefined);
  
  // --- Sequential Onboarding Wizard State ---
  const [onboardingQuestions, setOnboardingQuestions] = useState<string[]>(DEFAULT_ONBOARDING_QUESTIONS);
  const [currentOnboardingIndex, setCurrentOnboardingIndex] = useState<number>(0);
  const [onboardingAnswers, setOnboardingAnswers] = useState<{ q: string; a: string }[]>([]);
  const [chatbotMessages, setChatbotMessages] = useState<any[]>([]);
  const [chatbotInput, setChatbotInput] = useState('');
  const [currentFieldKey, setCurrentFieldKey] = useState<string>('businessName');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isOnboardingCompleted, setIsOnboardingCompleted] = useState(false);
  const [isStrategyGenerating, setIsStrategyGenerating] = useState(false);
  const [onboardingProgress, setOnboardingProgress] = useState(0);

  const fieldKeyOrder = [
    'businessName',
    'businessCategory',
    'productsServices',
    'targetAudience',
    'customerAgeGroup',
    'genderTarget',
    'location',
    'businessGoals',
    'monthlyBudget',
    'competitors',
    'brandTone',
    'postingFrequency',
    'languages',
    'businessUSP'
  ];

  const initOnboarding = async (bId: string) => {
    try {
      console.log('[BusinessPlanner] Initialising onboarding for business:', bId);

      // Step 1: Get the questions list (for local fallback display)
      let questions = DEFAULT_ONBOARDING_QUESTIONS;
      try {
        const qList = await api.business.getQuestions();
        if (Array.isArray(qList) && qList.length > 0 && typeof qList[0] === 'string') {
          questions = qList;
        }
      } catch (err) {
        console.warn('[BusinessPlanner] Using default questions fallback:', err);
      }
      setOnboardingQuestions(questions);

      // Step 2: Call startOnboarding to create or RESUME the backend conversation.
      // This returns the full message history + current field index + progress
      // so a page refresh correctly restores where the user left off.
      try {
        const startResp = await api.business.startOnboarding(bId);

        if (startResp.completed) {
          // Onboarding already completed on backend — go to blueprint/dashboard
          setCurrentPage('blueprint');
          return;
        }

        // Restore the conversation history from the backend
        const backendMessages: any[] = Array.isArray(startResp.messages) && startResp.messages.length > 0
          ? startResp.messages
          : [
              {
                role: 'model',
                content: `Welcome to Visionpilot AI! 🚀 (Meta authorised AI marketing agent) I'm your AI Marketing Manager. Let's learn about your business so I can build your customized marketing strategy.\n\n📌 Question 1 of ${questions.length}:\n${questions[0]}`
              }
            ];

        setChatbotMessages(backendMessages);

        // Restore the current field index from the backend so answers go to the right field
        const answeredCount = typeof startResp.answeredFields === 'number' ? startResp.answeredFields : 0;
        const currentIdx = Math.min(answeredCount, questions.length - 1);
        setCurrentOnboardingIndex(currentIdx);

        // Restore field key: use the field returned by backend if available
        if (startResp.currentField && fieldKeyOrder.includes(startResp.currentField)) {
          setCurrentFieldKey(startResp.currentField);
        } else {
          setCurrentFieldKey(fieldKeyOrder[currentIdx] || fieldKeyOrder[0]);
        }

        // Restore progress from backend
        setOnboardingProgress(typeof startResp.progress === 'number' ? startResp.progress : 0);
        setOnboardingAnswers([]);
      } catch (startErr) {
        // Backend startOnboarding failed — fall back to local fresh state
        console.warn('[BusinessPlanner] startOnboarding API failed, using local init fallback:', startErr);
        setCurrentOnboardingIndex(0);
        setCurrentFieldKey(fieldKeyOrder[0]);
        setOnboardingAnswers([]);
        setOnboardingProgress(0);
        setChatbotMessages([
          {
            role: 'model',
            content: `Welcome to Visionpilot AI! 🚀 (Meta authorised AI marketing agent) I'm your AI Marketing Manager. Let's learn about your business so I can build your customized marketing strategy.\n\n📌 Question 1 of ${questions.length}:\n${questions[0]}`
          }
        ]);
      }

      setCurrentPage('onboarding');
    } catch (err: any) {
      console.error('[BusinessPlanner] Failed to initialise onboarding:', err);
      addToast('Onboarding Error', err.message || 'Failed to start AI Business Planner', 'alert');
    }
  };

  // App metrics & lists loaded from DB
  const [metrics, setMetrics] = useState<any>({
    totalSpend: 0,
    totalImpressions: 0,
    totalClicks: 0,
    totalConversions: 0,
    totalRevenue: 0,
    cpc: 0,
    cpm: 0,
    ctr: 0,
    roas: 0,
    campaignsCount: 0,
    activeCampaigns: 0
  });
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [optimizations, setOptimizations] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  
  // New campaign wizard form state
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    objective: 'CONVERSIONS',
    dailyBudget: 100,
    creativePrompt: '',
    targetAgeMin: 21,
    targetAgeMax: 45,
    targetLocation: 'United States'
  });
  const [isBuildingCampaign, setIsBuildingCampaign] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [previewCreative, setPreviewCreative] = useState<any>(null);

  // Support ticket form state
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');

  // Admin state
  const [adminBusinesses, setAdminBusinesses] = useState<any[]>([]);
  const [adminTickets, setAdminTickets] = useState<any[]>([]);
  const [adminStats, setAdminStats] = useState<any>(null);
  const [adminLogs, setAdminLogs] = useState<any[]>([]);

  // Admin Modal state
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminInputUsername, setAdminInputUsername] = useState('');
  const [adminInputPassword, setAdminInputPassword] = useState('');
  const [adminModalError, setAdminModalError] = useState('');

  // UI status helpers
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [alertModal, setAlertModal] = useState<{ title: string; message: string } | null>(null);
  const [isNotificationTrayOpen, setIsNotificationTrayOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // --- Handle Meta OAuth Callback from URL params ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    const success = params.get('success');

    // Handle admin login route
    if (window.location.pathname === '/admin/login') {
      setCurrentPage('auth');
      return;
    }
    
    if (window.location.pathname === '/meta/callback') {
      if (error) {
        addToast('Meta Connection Failed', error, 'alert');
        window.history.replaceState({}, '', '/connect-meta');
        setCurrentPage('connect-meta');
        return;
      }
      
      if (code && state) {
        if (processedMetaOAuthCode.current === code) {
          return;
        }
        processedMetaOAuthCode.current = code;

        try {
          const stateData = JSON.parse(atob(state));
          const businessId = stateData.businessId;
          
          // Exchange code via backend
          api.meta.connect(code, businessId)
            .then(async () => {
              const calendar = await api.content.ensureInitialWeek(businessId);
              // Posting days come from the plan (3 posts/week = Tue, Thu, Sat).
              const planDays: string[] = Array.isArray(calendar.selectedDays) ? calendar.selectedDays : [];
              const calendarMessage = calendar.created
                ? planDays.length
                  ? `Your first ${planDays.join(', ')} content plan is ready.`
                  : 'Your first weekly content plan is ready.'
                : 'Your existing content calendar is ready.';
              addToast('Meta Connected', calendarMessage, 'success');
              window.history.replaceState({}, '', '/connect-meta');
              setCurrentPage('connect-meta');
            })
            .catch((err: any) => {
              addToast('Meta Connection Failed', err.message, 'alert');
              window.history.replaceState({}, '', '/connect-meta');
              setCurrentPage('connect-meta');
            });
        } catch (e) {
          addToast('Invalid OAuth State', 'Could not process Meta callback', 'alert');
          window.history.replaceState({}, '', '/connect-meta');
          setCurrentPage('connect-meta');
        }
      }
    } else if (window.location.pathname === '/connect-meta') {
      if (success === 'true') {
        addToast('Meta Connected', 'Successfully connected to Meta Ads', 'success');
        window.history.replaceState({}, '', '/connect-meta');
      } else if (error) {
        addToast('Meta Connection Failed', error, 'alert');
        window.history.replaceState({}, '', '/connect-meta');
      }
    }
  }, []);

  // --- Load Profile and Data ---
  useEffect(() => {
    let unsubscribe: any = null;

    const setupAuth = () => {
      if (!auth) {
        const token = localStorage.getItem('campaignai_token');
        if (token) {
          api.auth.getProfile()
            .then(async (res) => {
              setUser(res);
              if (res.role === 'ADMIN') {
                try {
                  const businesses = await api.admin.getBusinesses();
                  setAdminBusinesses(businesses);
                  const tkts = await api.admin.getTickets();
                  setAdminTickets(tkts);
                  const stats = await api.admin.getStats();
                  setAdminStats(stats);
                  const logs = await api.admin.getAuditLogs();
                  setAdminLogs(logs);
                } catch {
                  // Fallback
                }
                const savedPage = (localStorage.getItem('visionpilot_active_page') || localStorage.getItem('dipari_active_page'));
                setCurrentPage((savedPage && savedPage !== 'auth' && savedPage !== 'landing') ? (savedPage as any) : 'admin');
              } else if (!res.onboardingCompleted) {
                await initOnboarding(res.businessId);
              } else if (!res.profileCompleted) {
                setCurrentPage('profile');
                addToast('Profile Incomplete', 'Please fill and save your Profile details to unlock features.', 'info');
              } else {
                if (window.location.pathname === '/connect-meta') {
                  setCurrentPage('connect-meta');
                } else {
                  const savedPage = (localStorage.getItem('visionpilot_active_page') || localStorage.getItem('dipari_active_page'));
                  setCurrentPage((savedPage && savedPage !== 'auth' && savedPage !== 'landing') ? (savedPage as any) : 'dashboard');
                }
              }
              addToast('Welcome Back', `Successfully logged in as ${res.name}`, 'success');
            })
            .catch(() => {
              localStorage.removeItem('campaignai_token');
              setCurrentPage('landing');
            });
        }
        return;
      }

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          // Firebase signs a newly registered user in the instant the account is
          // created, before they have opened the emailed verification link.
          // Without this gate they were dropped straight into onboarding and
          // never saw the "check your inbox" step.  Google accounts arrive
          // pre-verified and pass straight through.
          const usesPassword = firebaseUser.providerData.some(
            (provider: any) => provider?.providerId === 'password',
          );
          if (usesPassword && !firebaseUser.emailVerified) {
            localStorage.removeItem('campaignai_token');
            setUser(null);
            // Stay put if they are already on the auth screen — it is showing
            // the "verify your email" step right now.
            setCurrentPage((prev) => (prev === 'auth' || prev === 'landing' ? prev : 'auth'));
            return;
          }

          try {
            const token = await firebaseUser.getIdToken();
            localStorage.setItem('campaignai_token', token);
            const res = await api.auth.getProfile();
            setUser(res);
            
            const savedPage = (localStorage.getItem('visionpilot_active_page') || localStorage.getItem('dipari_active_page'));
            if (res.role === 'ADMIN') {
              try {
                const businesses = await api.admin.getBusinesses();
                setAdminBusinesses(businesses);
                const tickets = await api.admin.getTickets();
                setAdminTickets(tickets);
                const stats = await api.admin.getStats();
                setAdminStats(stats);
                const logs = await api.admin.getAuditLogs();
                setAdminLogs(logs);
              } catch {
                // Fallback
              }
              setCurrentPage((savedPage && savedPage !== 'auth' && savedPage !== 'landing') ? (savedPage as any) : 'admin');
            } else if (!res.onboardingCompleted) {
              await initOnboarding(res.businessId);
            } else if (!res.profileCompleted) {
              setCurrentPage('profile');
              addToast('Profile Incomplete', 'Please fill and save your Profile details to unlock features.', 'info');
            } else {
              if (window.location.pathname === '/connect-meta') {
                setCurrentPage('connect-meta');
              } else {
                setCurrentPage((savedPage && savedPage !== 'auth' && savedPage !== 'landing') ? (savedPage as any) : 'dashboard');
              }
            }
          } catch (e) {
            console.error('Failed to sync profile', e);
            localStorage.removeItem('campaignai_token');
            setUser(null);
            setCurrentPage('landing');
          }
        } else {
          const hasToken = !!localStorage.getItem('campaignai_token');
          if (!hasToken) {
            const protectedPages = ['dashboard', 'builder', 'manager', 'analytics', 'support', 'admin', 'onboarding', 'connect-meta', 'leads', 'calendar', 'scheduler', 'instant-posts', 'settings', 'profile'];
            setUser(null);
            localStorage.removeItem('campaignai_token');
            if (protectedPages.includes(currentPage)) {
              setCurrentPage('landing');
            }
          }
        }
      });
    };

    setupAuth();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Fetch campaign dashboard data whenever workspace changes
  useEffect(() => {
    if (user && user.businessId) {
      loadDashboardData();
    }
  }, [user]);

  const loadDashboardData = async () => {
    if (!user || !user.businessId) return;
    try {
      const bid = user.businessId;
      const summ = await api.campaigns.getSummary(bid);
      setMetrics(summ);

      await api.campaigns.getDaily(bid);

      const cmps = await api.campaigns.getCampaigns(bid);
      setCampaigns(cmps);

      const notifs = await api.support.getNotifications(bid);
      setNotifications(notifs);

      const opts = await api.campaigns.getOptimizations(bid);
      setOptimizations(opts);

      const recs = await api.campaigns.getRecommendations(bid);
      setRecommendations(recs);

      const tkts = await api.support.getTickets();
      setTickets(tkts);
    } catch (e) {
      console.error("Error loading dashboard data", e);
    }
  };

  // Toast dispatch.
  // Errors are shown as a centred modal the user must acknowledge — a corner
  // toast that vanishes after 4s is too easy to miss for something that needs
  // action.  Successes and info stay as toasts so they don't interrupt.
  const addToast = (title: string, message: string, type: 'success' | 'alert' | 'info') => {
    if (type === 'alert') {
      setAlertModal({ title, message: friendlyError(message, message) });
      return;
    }
    const id = Math.random().toString();
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // Toggle Theme
  const toggleTheme = () => {
    setIsLight(!isLight);
    document.documentElement.classList.toggle('dark');
  };



  const handleLogout = () => {
    api.auth.logout();
    setUser(null);
    // Clear saved page so the next session starts at the landing page
    // (prevents stale dashboard/onboarding showing before auth resolves)
    localStorage.removeItem('visionpilot_active_page'); localStorage.removeItem('dipari_active_page');
    setChatbotMessages([]);
    setCurrentOnboardingIndex(0);
    setOnboardingProgress(0);
    setCurrentPage('landing');
    addToast('Logged Out', 'You have been safely disconnected.', 'info');
  };

  // --- Onboarding chatbot wizard ---
  const handleChatbotSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatbotInput.trim() || isStrategyGenerating) return;

    const userMessage = chatbotInput.trim();
    setValidationError(null);

    const currentQ = onboardingQuestions[currentOnboardingIndex] || `Question ${currentOnboardingIndex + 1}`;
    const updatedAnswers = [...onboardingAnswers, { q: currentQ, a: userMessage }];
    setOnboardingAnswers(updatedAnswers);

    // 1. Display user answer in chat window
    setChatbotMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatbotInput('');

    const nextIndex = currentOnboardingIndex + 1;
    const totalQ = onboardingQuestions.length || 14;

    if (nextIndex < totalQ) {
      setCurrentOnboardingIndex(nextIndex);
      setCurrentFieldKey(fieldKeyOrder[nextIndex] || 'businessCategory');
      const progress = Math.round((nextIndex / totalQ) * 100);
      setOnboardingProgress(progress);

      // Async sync with backend
      if (user?.businessId) {
        api.business.chatOnboarding(user.businessId, userMessage).catch(() => {});
      }

      setTimeout(() => {
        const questionText = (onboardingQuestions && onboardingQuestions[nextIndex]) || DEFAULT_ONBOARDING_QUESTIONS[nextIndex] || 'Please provide details for this step.';
        setChatbotMessages(prev => [
          ...prev,
          {
            role: 'model',
            content: `📌 Question ${nextIndex + 1} of ${totalQ}:\n${questionText}`
          }
        ]);
      }, 350);
    } else {
      // 2. All questions completed!
      setIsOnboardingCompleted(true);
      setIsStrategyGenerating(true);
      setOnboardingProgress(100);

      setChatbotMessages(prev => [
        ...prev,
        {
          role: 'model',
          content: "🎉 Excellent! All 14 business onboarding questions completed! Building your target demographics, SWOT maps, and AI Business Blueprint..."
        }
      ]);

      try {
        if (user?.businessId) {
          await api.business.submitAnswers(user.businessId, updatedAnswers);
          await api.business.chatOnboarding(user.businessId, userMessage).catch(() => {});
        }
        setIsStrategyGenerating(false);

        setUser((prev: any) => (prev ? { ...prev, onboardingCompleted: true } : null));

        setChatbotMessages(prev => [
          ...prev,
          {
            role: 'model',
            content: "✅ AI Strategy Engine completed! Your Business Blueprint has been generated. Reviewing blueprint now..."
          }
        ]);

        setTimeout(() => {
          setCurrentPage('blueprint');
        }, 1500);
      } catch (err: any) {
        console.error('[BusinessPlanner] Submit answers failed:', err);
        setIsStrategyGenerating(false);
        setTimeout(() => {
          setCurrentPage('blueprint');
        }, 1500);
      }
    }
  };

  // --- AI Campaign builder steps ---
  const handleBuildCampaignStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setWizardStep(2);
  };

  const handleGenerateAdDraft = async () => {
    if (!newCampaign.creativePrompt) {
      addToast('Missing prompt', 'Please describe the focus of your creative first', 'alert');
      return;
    }
    setIsBuildingCampaign(true);
    try {
      // Build campaign trigger (handles AI creative generation and saves state)
      const res = await api.campaigns.buildCampaign(user.businessId, newCampaign);
      setPreviewCreative(res.creative);
      setWizardStep(3);
      setIsBuildingCampaign(false);
      addToast('AI Copies Generated', 'Review generated text & headlines', 'success');
    } catch (err: any) {
      addToast('Generation failed', err.message, 'alert');
      setIsBuildingCampaign(false);
    }
  };

  const handlePublishCampaign = async () => {
    await loadDashboardData();
    setWizardStep(1);
    // Reset wizard
    setNewCampaign({
      name: '',
      objective: 'CONVERSIONS',
      dailyBudget: 100,
      creativePrompt: '',
      targetAgeMin: 21,
      targetAgeMax: 45,
      targetLocation: 'United States'
    });
    setPreviewCreative(null);
    setCurrentPage('dashboard');
    addToast('Campaign Published', 'Now active on Meta Ads and sync logs initialized', 'success');
  };

  // --- Meta campaigns status slider ---
  const toggleCampaignStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    try {
      await api.campaigns.updateStatus(id, nextStatus);
      addToast('Status Updated', `Campaign status changed to ${nextStatus}`, 'success');
      loadDashboardData();
    } catch (err: any) {
      addToast('Error', err.message, 'alert');
    }
  };

  // --- Tickets ---
  const submitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSubject || !ticketDesc) return;
    try {
      await api.support.createTicket(ticketSubject, ticketDesc);
      addToast('Ticket Submitted', 'Our engineering team will review shortly.', 'success');
      setTicketSubject('');
      setTicketDesc('');
      loadDashboardData();
    } catch (err: any) {
      addToast('Ticket Error', err.message, 'alert');
    }
  };

  // --- AI chat assistant responses ---
  const sendAssistantMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assistantInput.trim()) return;

    const msg = assistantInput;
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setAssistantInput('');

    try {
      const res = await api.assistant.sendMessage(user.businessId, msg, currentConvoId);
      setCurrentConvoId(res.conversationId);
      setChatMessages(prev => [...prev, { role: 'model', content: res.reply }]);
    } catch (err: any) {
      addToast('Assistant connection failed', err.message, 'alert');
    }
  };

  // --- Admin actions ---
  const loadAdminDashboard = async () => {
    try {
      await api.admin.getUsers();
      const businesses = await api.admin.getBusinesses();
      setAdminBusinesses(businesses);
      const tickets = await api.admin.getTickets();
      setAdminTickets(tickets);
      const stats = await api.admin.getStats();
      setAdminStats(stats);
      const logs = await api.admin.getAuditLogs();
      setAdminLogs(logs);
      setCurrentPage('admin');
    } catch (err: any) {
      addToast('Admin Privileges Required', 'Only system administrators can load this view.', 'alert');
    }
  };

  const updateTicketAdmin = async (id: string, status: string) => {
    try {
      await api.admin.updateTicketStatus(id, status);
      addToast('Ticket Updated', `Status changed to ${status}`, 'success');
      loadAdminDashboard();
    } catch (err: any) {
      addToast('Error updating ticket', err.message, 'alert');
    }
  };

  const handleAdminModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = adminInputUsername.trim().toLowerCase();
    const p = adminInputPassword.trim();
    const isAdminUser = u === 'admin' || u === 'admin@campaignai.com' || u === 'admin@campaign.ai';

    setAdminModalError('');
    try {
      if (isAdminUser && (p === 'admin' || p === 'admin123' || p === 'password123' || p === '••••••••')) {
        const res = await api.auth.adminLogin('admin', 'admin');
        setUser(res.user);
        setIsAdminModalOpen(false);
        setAdminInputUsername('');
        setAdminInputPassword('');
        addToast('Admin Access Granted', 'Logged in to Admin Console.', 'success');
        await loadAdminDashboard();
      } else {
        const res = await api.auth.adminLogin(adminInputUsername.trim(), p);
        setUser(res.user);
        setIsAdminModalOpen(false);
        setAdminInputUsername('');
        setAdminInputPassword('');
        addToast('Admin Access Granted', 'Logged in to Admin Console.', 'success');
        await loadAdminDashboard();
      }
    } catch (err: any) {
      setAdminModalError(err.message || 'Invalid admin credentials. Use "admin" for both username and password.');
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column' }}>
      {globalError && (
        <div style={{ padding: '24px', background: '#fee2e2', color: '#991b1b', borderBottom: '1px solid #f87171', fontFamily: 'monospace', zIndex: 99999 }}>
          <h3 style={{ margin: '0 0 8px 0' }}>Captured React Render Crash:</h3>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{globalError}</pre>
          <button onClick={() => { setGlobalError(null); window.location.reload(); }} style={{ marginTop: '12px', padding: '6px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Dismiss</button>
        </div>
      )}
      
      {/* --- TOAST NOTIFICATIONS WRAPPER --- */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className="toast" style={{
            borderLeft: toast.type === 'success' ? '4px solid var(--color-success)' :
                        toast.type === 'alert' ? '4px solid var(--color-danger)' : '4px solid var(--color-secondary)'
          }}>
            {toast.type === 'success' && <CheckCircle size={18} style={{ color: 'var(--color-success)' }} />}
            {toast.type === 'alert' && <AlertTriangle size={18} style={{ color: 'var(--color-danger)' }} />}
            {toast.type === 'info' && <Info size={18} style={{ color: 'var(--color-secondary)' }} />}
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{toast.title}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>{toast.message}</div>
            </div>
          </div>
        ))}
      </div>

      {/* --- ERROR MODAL --- */}
      {alertModal && (
        <div
          onClick={() => setAlertModal(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100000,
            background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="alert-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--color-bg-end, #ffffff)', color: 'var(--color-text, #0f172a)',
              borderRadius: 16, padding: '28px 28px 22px', width: '100%', maxWidth: 420,
              boxShadow: '0 24px 60px rgba(0,0,0,0.28)', border: '1px solid var(--color-border, #e2e8f0)',
              textAlign: 'center',
            }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px',
            }}>
              <AlertTriangle size={28} style={{ color: 'var(--color-danger, #ef4444)' }} />
            </div>
            <h3 id="alert-modal-title" style={{ margin: '0 0 10px', fontSize: '1.15rem', fontWeight: 700 }}>
              {alertModal.title}
            </h3>
            <p style={{ margin: '0 0 24px', fontSize: '0.92rem', lineHeight: 1.6, opacity: 0.85 }}>
              {alertModal.message}
            </p>
            <button
              autoFocus
              onClick={() => setAlertModal(null)}
              style={{
                width: '100%', padding: '12px 20px', borderRadius: 10, border: 'none',
                background: 'var(--color-primary, #6366f1)', color: '#fff',
                fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* --- 1. LANDING PAGE --- */}
      {currentPage === 'landing' && (
        <div style={{ overflow: 'hidden' }}>
          {/* Header */}
          <header style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '24px 8%', borderBottom: '1px solid var(--color-border)',
            position: 'sticky', top: 0, backdropFilter: 'blur(20px)', zIndex: 100
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.8rem' }}>🚀</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-0.04em', lineHeight: 1.1 }}>
                  Visionpilot <span className="text-gradient">AI</span>
                </span>
                <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.02em' }}>
                  Meta authorised AI marketing agent
                </span>
              </div>
            </div>
            <nav style={{ display: 'flex', gap: 32, fontWeight: 500, fontSize: '0.95rem' }}>
              <a href="#features" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', transition: 'var(--transition-smooth)' }}>Features</a>
              <a href="#pricing" style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>Pricing</a>
              <a href="#faq" style={{ color: 'var(--color-text-muted)', textDecoration: 'none' }}>FAQ</a>
            </nav>
            <div style={{ display: 'flex', gap: 16 }}>
              <button className="btn-secondary" onClick={() => { setAuthView('login'); setCurrentPage('auth'); }}>Sign In</button>
              <button className="btn-primary" onClick={() => { setAuthView('register'); setCurrentPage('auth'); }}>Start Free</button>
            </div>
          </header>

          {/* Hero Section */}
          <section style={{ padding: '120px 8% 80px 8%', textAlign: 'center', position: 'relative' }}>
            <div className="glow-aura" style={{ top: '10%', left: '50%', transform: 'translateX(-50%)' }}></div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 16px',
              borderRadius: '99px', border: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.03)',
              marginBottom: 32, fontSize: '0.85rem'
            }}>
              <span style={{ color: 'var(--color-secondary)' }}>●</span> Meta Authorised AI Marketing Agent
            </div>
            <h1 style={{
              fontSize: '4.5rem', fontWeight: 800, fontFamily: 'var(--font-display)',
              lineHeight: 1.1, letterSpacing: '-0.05em', maxWidth: 900, margin: '0 auto 24px auto'
            }}>
              Autonomous Meta Ads <br />
              <span className="text-gradient">Engineered to Convert</span>
            </h1>
            <p style={{
              fontSize: '1.25rem', color: 'var(--color-text-muted)', maxWidth: 650,
              margin: '0 auto 40px auto', fontWeight: 400
            }}>
              Connect your brand details, and our automated workflows write the copy, target optimal user segments, and manage hourly bid adjustments autonomously.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
              <button className="btn-primary" style={{ padding: '16px 36px', fontSize: '1.05rem' }} onClick={() => { setAuthView('register'); setCurrentPage('auth'); }}>
                Launch Autonomous Campaign <ArrowRight size={18} />
              </button>
            </div>

            {/* Dashboard Mockup Showcase */}
            <div id="features" style={{
              marginTop: 80, border: '1px solid var(--color-border)', borderRadius: 24,
              overflow: 'hidden', padding: 12, background: 'rgba(255, 255, 255, 0.02)',
              boxShadow: '0 30px 100px rgba(0,0,0,0.8)'
            }}>
              <div style={{
                borderRadius: 16, background: '#090d16', border: '1px solid var(--color-border)',
                height: 480, display: 'flex', flexDirection: 'column', overflow: 'hidden'
              }}>
                {/* Fake App header */}
                <div style={{ height: 50, borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }}></div>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b' }}></div>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }}></div>
                  <div style={{ marginLeft: 24, width: 250, height: 20, background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}></div>
                </div>
                {/* Fake App body */}
                <div style={{ display: 'flex', flex: 1 }}>
                  <div style={{ width: 200, borderRight: '1px solid var(--color-border)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ height: 24, background: 'var(--color-primary)', borderRadius: 6, opacity: 0.15 }}></div>
                    <div style={{ height: 24, background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}></div>
                    <div style={{ height: 24, background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}></div>
                    <div style={{ height: 24, background: 'rgba(255,255,255,0.05)', borderRadius: 6 }}></div>
                  </div>
                  <div style={{ flex: 1, padding: 30, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                      <div className="glass-panel" style={{ padding: 20 }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>MOCK MONTHLY ROAS</div>
                        <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>3.42x</div>
                      </div>
                      <div className="glass-panel" style={{ padding: 20 }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>MOCK ACQUISITION CPA</div>
                        <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>₹12.40</div>
                      </div>
                      <div className="glass-panel" style={{ padding: 20 }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>MOCK SPEND RATIO</div>
                        <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>₹4,821.50</div>
                      </div>
                    </div>
                    {/* Fake line chart */}
                    <div className="glass-panel" style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: 20 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Performance Scale Matrix</div>
                      <svg viewBox="0 0 500 150" style={{ width: '100%', height: '80%', marginTop: 10 }}>
                        <defs>
                          <linearGradient id="glowGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d="M0,120 Q80,40 160,80 T320,30 T480,10 L480,150 L0,150 Z" fill="url(#glowGrad)"></path>
                        <path d="M0,120 Q80,40 160,80 T320,30 T480,10" fill="none" stroke="var(--color-primary)" strokeWidth="3"></path>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Pricing Grid */}
          <section id="pricing" style={{ padding: '80px 8%', textAlign: 'center', borderTop: '1px solid var(--color-border)' }}>
            <h2 style={{ fontSize: '2.5rem', fontFamily: 'var(--font-display)', marginBottom: 12 }}>Transparent Scaling Plans</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 60 }}>Choose the strategy that aligns with your ad accounts budget caps.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24, maxWidth: 1240, margin: '0 auto', alignItems: 'stretch' }}>
              {/* Tile 1: Basic */}
              <div className="glass-panel" style={{ padding: '32px 26px', textAlign: 'left', display: 'flex', flexDirection: 'column', borderRadius: 20, position: 'relative' }}>
                <div style={{ minHeight: 120 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Free Plan</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, minHeight: 32 }}>Basic (Free 7 days trial)</div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 900, marginTop: 12 }}>Free</div>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, margin: '24px 0', fontSize: '0.86rem', color: 'var(--color-text-muted)', flex: 1, padding: 0 }}>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>3 post (2 standard, 1 carrousal) / week</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>graphics regeneration 3 times</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '1.1rem', lineHeight: 1 }}>✕</span>
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>No Ad campaign</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>Experience the next generation Marketing</span>
                  </li>
                </ul>
                <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', padding: '12px', fontWeight: 700 }} onClick={() => {
                  if (user) {
                    navigateWithProfileCheck('generator');
                    addToast('Free Trial Active', 'You have access to the Basic Free 7-Day trial features.', 'info');
                  } else {
                    setAuthView('register');
                    setCurrentPage('auth');
                  }
                }}>
                  Start Free Trial
                </button>
              </div>

              {/* Tile 2: Advance */}
              <div className="glass-panel" style={{ padding: '32px 26px', textAlign: 'left', display: 'flex', flexDirection: 'column', borderRadius: 20, border: '2px solid var(--color-primary)', boxShadow: '0 0 35px rgba(99, 102, 241, 0.15)', position: 'relative' }}>
                <div style={{ minHeight: 120 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pro Campaign</span>
                    <span style={{ background: 'var(--color-primary)', fontSize: '0.68rem', padding: '3px 9px', borderRadius: 99, color: 'white', fontWeight: 800 }}>POPULAR</span>
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, minHeight: 32 }}>Advance</div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 900, marginTop: 12, color: 'var(--color-primary-light)' }}>₹5,000</div>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, margin: '24px 0', fontSize: '0.86rem', color: 'var(--color-text-muted)', flex: 1, padding: 0 }}>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>3 post (2 standard, 1 carrousal) / week</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>graphics regeneration 3 times</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>15 days Ad campaign</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>24X7 support</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>Visible growth in sales in 1 week</span>
                  </li>
                </ul>
                <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px', fontWeight: 700 }} onClick={() => {
                  if (user) {
                    navigateWithProfileCheck('profile');
                    addToast('Plan Upgrade', 'Select Advance (₹5,000) to proceed to Cashfree checkout.', 'info');
                  } else {
                    setAuthView('register');
                    setCurrentPage('auth');
                  }
                }}>
                  Select Plan
                </button>
              </div>

              {/* Tile 3: Premium */}
              <div className="glass-panel" style={{ padding: '32px 26px', textAlign: 'left', display: 'flex', flexDirection: 'column', borderRadius: 20, position: 'relative' }}>
                <div style={{ minHeight: 120 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Enterprise Scale</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, minHeight: 32 }}>Premium</div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 900, marginTop: 12 }}>₹10,000</div>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, margin: '24px 0', fontSize: '0.86rem', color: 'var(--color-text-muted)', flex: 1, padding: 0 }}>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>5 post (2 standard, 1 carrousal) / week</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>graphics regeneration 3 times</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>30 days Ad campaign</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>24X7 support</span>
                  </li>
                  <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.4 }}>
                    <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1rem', lineHeight: 1 }}>✓</span>
                    <span>Visible growth in sales in 1 week</span>
                  </li>
                </ul>
                <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', background: 'var(--color-secondary)', padding: '12px', fontWeight: 700 }} onClick={() => {
                  if (user) {
                    navigateWithProfileCheck('profile');
                    addToast('Plan Upgrade', 'Select Premium (₹10,000) to proceed to Cashfree checkout.', 'info');
                  } else {
                    setAuthView('register');
                    setCurrentPage('auth');
                  }
                }}>
                  Choose Premium
                </button>
              </div>

              {/* Tile 4: Customized */}
              <div className="glass-panel" style={{ padding: '32px 26px', textAlign: 'left', display: 'flex', flexDirection: 'column', borderRadius: 20, position: 'relative' }}>
                <div style={{ minHeight: 120 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Flexible Budget</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, minHeight: 32 }}>Customized</div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 900, marginTop: 12, color: 'var(--color-text)' }}>Contact us</div>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, margin: '24px 0', fontSize: '0.88rem', color: 'var(--color-text-muted)', flex: 1, padding: 0 }}>
                  <li style={{ lineHeight: 1.6, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid var(--color-border)' }}>
                    Want to create a customized plan as per your budget? Please contact our team.
                  </li>
                </ul>
                <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', background: '#22c55e', border: 'none', padding: '12px', fontWeight: 700, boxShadow: '0 4px 14px rgba(34, 197, 94, 0.3)' }} onClick={() => {
                  setIsAssistantOpen(true);
                  setAssistantInput('Hi! I would like to create a customized marketing plan for our business based on our budget.');
                  addToast('Customization Request', 'Our AI Assistant is ready to help customize your plan, or email support@visionpilotai.com', 'info');
                }}>
                  Contact Us
                </button>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section id="faq" style={{ padding: '80px 8%', borderTop: '1px solid var(--color-border)', maxWidth: 800, margin: '0 auto' }}>
            <h2 style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: 40, fontFamily: 'var(--font-display)' }}>Frequently Asked Questions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <h4 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Do I need a credit card to sign up?</h4>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>No, you can sign up and explore the strategy generation engine. Credentials and payment configurations are only required when publishing live campaigns to Meta Ad Accounts.</p>
              </div>
              <div>
                <h4 style={{ fontSize: '1.1rem', marginBottom: 8 }}>How does the daily bid optimization operate?</h4>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>Our platform hooks into the Meta Marketing API, parsing click details and conversion events. If the hourly ROAS threshold is met, the system progressively boosts target sets, while automatically capping bids on underperforming audiences.</p>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer style={{ borderTop: '1px solid var(--color-border)', padding: '40px 8%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            <span>© 2026 Visionpilot AI Technologies • Meta Authorised AI Marketing Agent. All rights reserved.</span>
            <button
              onClick={() => {
                setAdminModalError('');
                setIsAdminModalOpen(true);
              }}
              style={{ background: 'rgba(99, 102, 241, 0.1)', border: '1px solid var(--color-border)', color: 'var(--color-primary)', cursor: 'pointer', fontSize: '0.8rem', padding: '6px 14px', borderRadius: '6px', fontWeight: 600 }}
            >
              ADMIN
            </button>
          </footer>
        </div>
      )}

      {/* --- 2. AUTHENTICATION PAGES --- */}
      {currentPage === 'auth' && (
        <AuthScreens
          defaultView={authView}
          onBackToHome={() => setCurrentPage('landing')}
          onAuthSuccess={async (syncedUser) => {
            setUser(syncedUser);
            // ADMIN users who accidentally use the business login portal
            // are redirected to the admin console
            if (syncedUser.role === 'ADMIN') {
              try {
                await api.admin.getUsers();
                const businesses = await api.admin.getBusinesses();
                setAdminBusinesses(businesses);
                const tickets = await api.admin.getTickets();
                setAdminTickets(tickets);
                const stats = await api.admin.getStats();
                setAdminStats(stats);
                const logs = await api.admin.getAuditLogs();
                setAdminLogs(logs);
                setCurrentPage('admin');
              } catch {
                // Fall through to dashboard if admin data fails
                setCurrentPage('dashboard');
              }
              return;
            }
            if (!syncedUser.onboardingCompleted) {
              await initOnboarding(syncedUser.businessId);
            } else if (!syncedUser.profileCompleted) {
              setCurrentPage('profile');
              addToast('Profile Incomplete', 'Please fill and save your Profile details to unlock the dashboard.', 'info');
            } else {
              setCurrentPage('dashboard');
            }
          }}
          addToast={addToast}
        />
      )}



      {/* --- 2.5 ADMIN PORTAL --- */}
      {currentPage === 'admin' && (
        <AdminPortal user={user} onLogout={handleLogout} addToast={addToast} />
      )}

      {/* --- 3. ONBOARDING CHATBOT PAGE --- */}
      {currentPage === 'onboarding' && (
        <div style={{ display: 'flex', flex: 1, minHeight: '100vh', background: 'var(--color-bg-end)' }}>
          {/* Left instructions */}
          <div style={{ width: 340, borderRight: '1px solid var(--color-border)', padding: 40, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 40 }}>
                <span style={{ fontSize: '1.4rem' }}>🚀</span>
                <div><div style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>Visionpilot AI</div><div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Meta authorised AI marketing agent</div></div>
              </div>
              <h3 style={{ fontSize: '1.2rem', marginBottom: 12 }}>Onboarding Chatbot</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                Our AI Planner is gathering business objectives to configure SWOT analysis grids and create target demographic parameters.
              </p>
            </div>
            
            {/* Progress bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 6 }}>
                <span>Strategy Profile Progress</span>
                <span>{onboardingProgress}%</span>
              </div>
              <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', background: 'var(--color-primary)',
                  width: `${onboardingProgress}%`,
                  transition: 'width 0.3s'
                }}></div>
              </div>
            </div>
          </div>

          {/* Right chat interface */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, padding: '40px 10%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {chatbotMessages.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                }}>
                  <div className="glass-panel" style={{
                    padding: '16px 20px',
                    borderRadius: 16,
                    maxWidth: '70%',
                    background: msg.role === 'user' ? 'rgba(99, 102, 241, 0.15)' : 'var(--color-card-bg)',
                    border: msg.role === 'user' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                    whiteSpace: 'pre-line',
                    lineHeight: 1.5,
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}

              {isStrategyGenerating && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 28px',
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))',
                  border: '1px solid rgba(99,102,241,0.25)', borderRadius: 16, maxWidth: '80%',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: '0.95rem', color: '#6366f1' }}>
                    <Sparkles size={18} style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
                    AI Strategy Engine Working...
                  </div>
                  {['Analyzing your business profile', 'Building competitive SWOT maps', 'Crafting brand positioning strategy', 'Generating content blueprints'].map((step, idx) => (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem',
                      color: '#475569', animation: `fadeIn 0.5s ease ${idx * 0.6}s both`,
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#6366f1',
                        animation: `pulse 1.2s ease-in-out ${idx * 0.3}s infinite`,
                      }} />
                      {step}...
                    </div>
                  ))}
                  <div style={{
                    height: 4, borderRadius: 4, background: 'rgba(99,102,241,0.15)',
                    overflow: 'hidden', marginTop: 4,
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      background: 'linear-gradient(90deg, #6366f1, #a855f7, #6366f1)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 1.5s ease-in-out infinite',
                      width: '70%',
                    }} />
                  </div>
                </div>
              )}
            </div>

            {/* Validation Banner */}
            {validationError && (
              <div style={{ margin: '0 10% 10px 10%', padding: '10px 16px', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid #f59e0b', color: '#f59e0b', borderRadius: 8, fontSize: '0.85rem' }}>
                ⚠️ {validationError}
              </div>
            )}

            {/* Input area & Smart UI Controls */}
            <div style={{ padding: '20px 10% 40px 10%', borderTop: '1px solid var(--color-border)' }}>
              {!isOnboardingCompleted ? (
                <div>
                  {/* Smart UI Input Controls per field */}
                  <div style={{ marginBottom: 12 }}>
                    <SmartInputControls
                      currentField={currentFieldKey}
                      value={chatbotInput}
                      onSelectOption={(opt) => {
                        setChatbotInput(opt);
                        setValidationError(null);
                      }}
                    />
                  </div>

                  <form onSubmit={handleChatbotSend} style={{ display: 'flex', gap: 12 }}>
                    <input
                      style={{
                        flex: 1, padding: '14px 18px', borderRadius: 12,
                        border: '1.5px solid #cbd5e1', background: '#ffffff', color: '#1e293b',
                        fontSize: '0.92rem', outline: 'none', transition: 'border-color 0.2s',
                      }}
                      onFocus={e => e.currentTarget.style.borderColor = '#6366f1'}
                      onBlur={e => e.currentTarget.style.borderColor = '#cbd5e1'}
                      placeholder="Type your response here..."
                      value={chatbotInput}
                      onChange={e => {
                        setChatbotInput(e.target.value);
                        setValidationError(null);
                      }}
                    />
                    <button className="btn-primary" type="submit" disabled={isStrategyGenerating}>
                      <Send size={16} />
                    </button>
                  </form>
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  <button className="btn-primary" style={{ padding: '16px 40px' }} onClick={() => {
                    setCurrentPage('blueprint');
                  }}>
                    Review AI Business Blueprint <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- 3.5 BUSINESS BLUEPRINT REVIEW & APPROVAL PAGE --- */}
      {currentPage === 'blueprint' && (
        <BusinessBlueprintReview
          businessId={user?.businessId}
          onApproved={async () => {
            await loadDashboardData();
            setCurrentPage('profile');
            addToast('Profile Setup Required', 'Please fill and save your Profile details (Logo, Contact Number, Website, Business Name) to unlock the app.', 'info');
          }}
          onEditAnswers={() => {
            setCurrentPage('onboarding');
          }}
        />
      )}

      {/* --- 4. ENTERPRISE APP SHELL: DASHBOARD & WORKSPACES --- */}
      {['dashboard', 'builder', 'generator', 'manager', 'analytics', 'support', 'connect-meta', 'leads', 'calendar', 'settings', 'profile'].includes(currentPage) && (
        <div style={{ display: 'flex', flex: 1 }}>
          
          {/* SIDEBAR NAVIGATION */}
          <aside style={{
            width: sidebarCollapsed ? 70 : 260,
            borderRight: '1px solid var(--color-border)',
            background: 'var(--color-bg-start)',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
              {/* Logo / Collapse Button */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {!sidebarCollapsed && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.4rem' }}>🚀</span>
                    <div><div style={{ fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: '1.05rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Visionpilot AI</div><div style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Meta authorised AI marketing agent</div></div>
                  </div>
                )}
                <button style={{
                  background: 'none', border: 'none', color: 'var(--color-text-muted)',
                  cursor: 'pointer', display: 'flex', margin: sidebarCollapsed ? '0 auto' : 'none'
                }} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
                  <Menu size={18} />
                </button>
              </div>

              {/* Workspace Selector */}
              {!sidebarCollapsed && (
                <div className="glass-panel" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem' }}>
                  <Building size={16} style={{ color: 'var(--color-primary)' }} />
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <strong>{activeWorkspace}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Meta Ad Account</div>
                  </div>
                </div>
              )}

              {/* Nav links */}
              <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => navigateWithProfileCheck('dashboard')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'dashboard' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'dashboard' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <LayoutDashboard size={18} />
                  {!sidebarCollapsed && <span>Dashboard</span>}
                </button>
                <button onClick={() => navigateWithProfileCheck('builder')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'builder' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'builder' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <Wand2 size={18} />
                  {!sidebarCollapsed && <span>Campaign Wizard</span>}
                </button>
                <button onClick={() => navigateWithProfileCheck('generator')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'generator' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'generator' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <Cpu size={18} />
                  {!sidebarCollapsed && <span>AI Campaign Generator</span>}
                </button>
                <button onClick={() => navigateWithProfileCheck('manager')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'manager' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'manager' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <Activity size={18} />
                  {!sidebarCollapsed && <span>Ads Manager</span>}
                </button>
                <button onClick={() => navigateWithProfileCheck('analytics')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'analytics' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'analytics' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <TrendingUp size={18} />
                  {!sidebarCollapsed && <span>Analytics</span>}
                </button>
                <button onClick={() => navigateWithProfileCheck('calendar')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'calendar' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'calendar' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <CalendarIcon size={18} />
                  {!sidebarCollapsed && <span>Content Calendar</span>}
                </button>

                <button onClick={() => navigateWithProfileCheck('leads')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'leads' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'leads' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <Users size={18} />
                  {!sidebarCollapsed && <span>Leads CRM</span>}
                </button>

                <button onClick={() => navigateWithProfileCheck('connect-meta')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'connect-meta' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'connect-meta' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <Activity size={18} />
                  {!sidebarCollapsed && <span>Connect Meta</span>}
                </button>
                <button onClick={() => navigateWithProfileCheck('support')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'support' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'support' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <FileText size={18} />
                  {!sidebarCollapsed && <span>Support Tickets</span>}
                </button>
                <button onClick={() => navigateWithProfileCheck('settings')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'settings' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'settings' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <SettingsIcon size={18} />
                  {!sidebarCollapsed && <span>Settings</span>}
                </button>
                <button onClick={() => navigateWithProfileCheck('profile')} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                  border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'profile' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                  color: currentPage === 'profile' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                }}>
                  <UserIcon size={18} />
                  {!sidebarCollapsed && <span>Profile</span>}
                </button>
                {user?.role === 'ADMIN' && (
                  <button onClick={loadAdminDashboard} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', width: '100%',
                    border: 'none', borderRadius: 10, cursor: 'pointer', background: currentPage === 'admin' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                    color: currentPage === 'admin' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    transition: 'var(--transition-smooth)', textAlign: 'left', fontSize: '0.9rem'
                  }}>
                    <Shield size={18} />
                    {!sidebarCollapsed && <span>Admin Console</span>}
                  </button>
                )}
              </nav>
            </div>

            {/* Profile area */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'var(--color-primary)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', color: '#fff'
                  }}>
                    <UserIcon size={16} />
                  </div>
                  {!sidebarCollapsed && (
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>PRO Tier</div>
                    </div>
                  )}
                </div>
                {!sidebarCollapsed && (
                  <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                    <LogOut size={16} />
                  </button>
                )}
              </div>
            </div>
          </aside>

          {/* MAIN PAGE WRAPPER */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-end)', overflowY: 'auto' }}>
            
            {/* TOP NAVIGATION BAR */}
            <header style={{
              height: 70, borderBottom: '1px solid var(--color-border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0 40px', background: 'var(--color-bg-start)',
              position: 'sticky', top: 0, zIndex: 10
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Search size={16} style={{ color: 'var(--color-text-muted)' }} />
                <input placeholder="Search campaigns, creatives or recommendations..." style={{
                  background: 'none', border: 'none', color: 'var(--color-text-main)',
                  fontSize: '0.85rem', width: 280, outline: 'none'
                }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <button onClick={toggleTheme} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                  {isLight ? <Moon size={18} /> : <Sun size={18} />}
                </button>
                
                {/* Notification Tray Toggle */}
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setIsNotificationTrayOpen(!isNotificationTrayOpen)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', position: 'relative' }}>
                    <Bell size={18} />
                    {notifications.filter(n => !n.isRead).length > 0 && (
                      <span style={{
                        position: 'absolute', top: -4, right: -4, width: 8, height: 8,
                        background: 'var(--color-danger)', borderRadius: '50%'
                      }}></span>
                    )}
                  </button>
                  {isNotificationTrayOpen && (
                    <div className="glass-panel" style={{
                      position: 'absolute', right: 0, top: 30, width: 320, padding: 16,
                      display: 'flex', flexDirection: 'column', gap: 12, zIndex: 100
                    }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', borderBottom: '1px solid var(--color-border)', paddingBottom: 8 }}>Notifications</div>
                      {notifications.length === 0 ? (
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>No unread updates.</div>
                      ) : (
                        notifications.map(n => (
                          <div key={n.id} style={{ fontSize: '0.8rem', opacity: n.isRead ? 0.6 : 1 }}>
                            <div style={{ fontWeight: 500 }}>{n.title}</div>
                            <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{n.message}</div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </header>

            {/* --- PAGE: DASHBOARD VIEW --- */}
            {currentPage === 'dashboard' && (
              <main style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 32 }}>
                
                {/* Dashboard metrics Bento grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                  <div className="glass-panel" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      <span>SPEND</span>
                      <IndianRupee size={14} />
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '8px 0' }}>
                      ₹{metrics.totalSpend?.toLocaleString(undefined, { maximumFractionDigits: 2 }) || '0.00'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>● Sync Active</div>
                  </div>
                  <div className="glass-panel" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      <span>ROAS</span>
                      <Activity size={14} />
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '8px 0' }}>
                      {metrics.roas?.toFixed(2) || '0.00'}x
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>+14.2% vs target limit</div>
                  </div>
                  <div className="glass-panel" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      <span>CPC</span>
                      <MousePointerClick size={14} />
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '8px 0' }}>
                      ₹{metrics.cpc?.toFixed(2) || '0.00'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>-8% cost reduction</div>
                  </div>
                  <div className="glass-panel" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      <span>CONVERSIONS</span>
                      <Target size={14} />
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700, margin: '8px 0' }}>
                      {metrics.totalConversions || '0'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>CTR: {((metrics.ctr || 0) * 100).toFixed(2)}%</div>
                  </div>
                </div>

                {/* Dashboard Chart & Campaigns listing */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
                  {/* Left SVG Line Chart */}
                  <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <h3 style={{ fontSize: '1.1rem' }}>ROAS Trajectory Analytics</h3>
                    <div style={{ flex: 1, minHeight: 240, position: 'relative' }}>
                      <svg viewBox="0 0 500 180" style={{ width: '100%', height: '100%' }}>
                        <defs>
                          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        {/* Fake grid lines */}
                        <line x1="0" y1="30" x2="500" y2="30" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                        <line x1="0" y1="90" x2="500" y2="90" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                        <line x1="0" y1="150" x2="500" y2="150" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />

                        {/* Chart path */}
                        <path d="M0,150 Q50,110 100,120 T200,80 T300,95 T400,60 T500,45 L500,180 L0,180 Z" fill="url(#chartGrad)"></path>
                        <path d="M0,150 Q50,110 100,120 T200,80 T300,95 T400,60 T500,45" fill="none" stroke="var(--color-primary)" strokeWidth="3" />
                      </svg>
                    </div>
                  </div>

                  {/* Right AI recommendations column */}
                  <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Cpu size={18} style={{ color: 'var(--color-primary)' }} /> AI Recommendations
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 280 }}>
                      {recommendations.map(rec => (
                        <div key={rec.id} style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{rec.title}</div>
                          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{rec.description}</p>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-accent)', fontWeight: 500 }}>{rec.impact}</span>
                            <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={() => addToast('Recommendation Applied', 'Optimization logic updated', 'success')}>{rec.actionLabel}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Optimizations History Log */}
                <div className="glass-panel" style={{ padding: 24 }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}>Optimization Log</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {optimizations.map(opt => (
                      <div key={opt.id} style={{ display: 'flex', gap: 16, borderBottom: '1px solid var(--color-border)', paddingBottom: 12, fontSize: '0.85rem' }}>
                        <Clock size={16} style={{ color: 'var(--color-primary)', marginTop: 2 }} />
                        <div>
                          <strong>{opt.action}</strong>
                          <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{opt.reason}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-accent)', marginTop: 4 }}>Impact: {opt.impactMetric}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </main>
            )}

            {/* --- PAGE: CAMPAIGN WIZARD --- */}
            {currentPage === 'builder' && (
              <main style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
                <div className="glass-panel" style={{ maxWidth: 640, width: '100%', padding: 40 }}>
                  <h2 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)', marginBottom: 8 }}>Autonomous Campaign Builder</h2>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: 32 }}>Provide campaign specifications, and our AI copies wizard will do the rest.</p>
                  
                  {/* Step indicators */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 40 }}>
                    <div style={{ flex: 1, height: 4, background: wizardStep >= 1 ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)' }}></div>
                    <div style={{ flex: 1, height: 4, background: wizardStep >= 2 ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)' }}></div>
                    <div style={{ flex: 1, height: 4, background: wizardStep >= 3 ? 'var(--color-primary)' : 'rgba(255,255,255,0.05)' }}></div>
                  </div>

                  {wizardStep === 1 && (
                    <form onSubmit={handleBuildCampaignStep1} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      <div>
                        <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Campaign Name</label>
                        <input className="form-input" placeholder="e.g. Summer Organic Linen launch" value={newCampaign.name} onChange={e => setNewCampaign({...newCampaign, name: e.target.value})} required />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Objective</label>
                          <select className="form-input" value={newCampaign.objective} onChange={e => setNewCampaign({...newCampaign, objective: e.target.value})}>
                            <option value="CONVERSIONS">Conversions (Sales)</option>
                            <option value="LEAD_GEN">Lead Generation</option>
                            <option value="TRAFFIC">Traffic</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Daily Budget (₹)</label>
                          <input className="form-input" type="number" value={newCampaign.dailyBudget} onChange={e => setNewCampaign({...newCampaign, dailyBudget: parseFloat(e.target.value)})} required />
                        </div>
                      </div>
                      <button className="btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }}>Continue to Target <ArrowRight size={16} /></button>
                    </form>
                  )}

                  {wizardStep === 2 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                        <div>
                          <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Target Age Min</label>
                          <input className="form-input" type="number" value={newCampaign.targetAgeMin} onChange={e => setNewCampaign({...newCampaign, targetAgeMin: parseInt(e.target.value)})} />
                        </div>
                        <div>
                          <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Target Age Max</label>
                          <input className="form-input" type="number" value={newCampaign.targetAgeMax} onChange={e => setNewCampaign({...newCampaign, targetAgeMax: parseInt(e.target.value)})} />
                        </div>
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Geographic Locations</label>
                        <input className="form-input" placeholder="e.g. United States, Canada" value={newCampaign.targetLocation} onChange={e => setNewCampaign({...newCampaign, targetLocation: e.target.value})} />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>AI Creative Creative Prompt</label>
                        <textarea className="form-input" rows={4} placeholder="Describe the style/subject of the creative image and main product angles..." value={newCampaign.creativePrompt} onChange={e => setNewCampaign({...newCampaign, creativePrompt: e.target.value})} required />
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setWizardStep(1)}>Back</button>
                        <button className="btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={handleGenerateAdDraft} disabled={isBuildingCampaign}>
                          {isBuildingCampaign ? <Cpu size={16} className="animate-spin" /> : 'Generate AI Copy & Assets'}
                        </button>
                      </div>
                    </div>
                  )}

                  {wizardStep === 3 && previewCreative && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                      <div style={{ border: '1px solid var(--color-border)', borderRadius: 16, overflow: 'hidden', background: '#090d16' }}>
                        <img src={previewCreative.imageUrl} alt="Ad Preview" style={{ width: '100%', height: 260, objectFit: 'cover' }} />
                        <div style={{ padding: 20 }}>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>{previewCreative.cta}</div>
                          <h4 style={{ fontSize: '1.2rem', margin: '4px 0 8px 0' }}>{previewCreative.headline}</h4>
                          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{previewCreative.description}</p>
                          <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 12, paddingTop: 12, fontSize: '0.8rem' }}>
                            <strong>Primary copy: </strong>{previewCreative.primaryText}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setWizardStep(2)}>Re-generate</button>
                        <button className="btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={handlePublishCampaign}>
                          Publish & Launch on Meta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </main>
            )}

            {/* --- PAGE: AI CAMPAIGN GENERATOR --- */}
            {currentPage === 'generator' && (
              <main style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 24 }}>
                <CampaignGenerator
                  businessId={user?.businessId}
                  addToast={addToast}
                  onDraftGenerated={() => {
                    setCurrentPage('manager');
                    loadDashboardData();
                  }}
                />
              </main>
            )}

            {/* --- PAGE: ADS MANAGER VIEW --- */}
            {currentPage === 'manager' && (
              <main style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-display)' }}>Meta Campaign Manager</h2>
                  <button className="btn-primary" onClick={() => setCurrentPage('builder')}><Plus size={16} /> New Campaign</button>
                </div>

                <div className="glass-panel" style={{ overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.02)' }}>
                        <th style={{ padding: 20 }}>CAMPAIGN NAME</th>
                        <th style={{ padding: 20 }}>STATUS</th>
                        <th style={{ padding: 20 }}>OBJECTIVE</th>
                        <th style={{ padding: 20 }}>DAILY BUDGET</th>
                        <th style={{ padding: 20 }}>HEALTH</th>
                        <th style={{ padding: 20 }}>META ID</th>
                        <th style={{ padding: 20 }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.length === 0 ? (
                        <tr>
                          <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>No campaigns launched yet. Run the builder wizard!</td>
                        </tr>
                      ) : (
                        campaigns.map(c => (
                          <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td style={{ padding: 20, fontWeight: 600 }}>{c.name}</td>
                            <td style={{ padding: 20 }}>
                              <span style={{
                                padding: '4px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 500,
                                background: c.status === 'ACTIVE' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                color: c.status === 'ACTIVE' ? 'var(--color-accent)' : 'var(--color-danger)'
                              }}>
                                {c.status}
                              </span>
                            </td>
                            <td style={{ padding: 20 }}>{c.objective}</td>
                            <td style={{ padding: 20, fontWeight: 500 }}>₹{c.dailyBudget}/day</td>
                            <td style={{ padding: 20, color: 'var(--color-accent)', fontWeight: 600 }}>{c.healthScore}%</td>
                            <td style={{ padding: 20, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{c.metaCampaignId}</td>
                            <td style={{ padding: 20 }}>
                              <button onClick={() => toggleCampaignStatus(c.id, c.status)} style={{
                                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-main)'
                              }}>
                                {c.status === 'ACTIVE' ? <Pause size={16} /> : <Play size={16} />}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </main>
            )}

            {/* --- PAGE: DEEP ANALYTICS VIEW --- */}
            {currentPage === 'analytics' && (
              <main style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 32 }}>
                <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-display)' }}>Marketing Channel Funnel</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                  <div className="glass-panel" style={{ padding: 24, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>IMPRESSIONS</div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 800, margin: '8px 0' }}>{metrics.totalImpressions?.toLocaleString() || '0'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-accent)' }}>100% Top of Funnel</div>
                  </div>
                  <div className="glass-panel" style={{ padding: 24, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>CLICKS</div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 800, margin: '8px 0' }}>{metrics.totalClicks?.toLocaleString() || '0'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>{((metrics.totalClicks / (metrics.totalImpressions || 1)) * 100).toFixed(2)}% Conversion rate</div>
                  </div>
                  <div className="glass-panel" style={{ padding: 24, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>CONVERSIONS</div>
                    <div style={{ fontSize: '2.2rem', fontWeight: 800, margin: '8px 0' }}>{metrics.totalConversions || '0'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>{((metrics.totalConversions / (metrics.totalClicks || 1)) * 100).toFixed(2)}% Purchase rate</div>
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: 24 }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: 20 }}>Export Reporting Sheets</h3>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <button className="btn-primary" onClick={() => addToast('Exporting PDF', 'Preparing platform summary documents...', 'success')}>Export Campaign PDF</button>
                    <button className="btn-secondary" onClick={() => addToast('Exporting CSV', 'Preparing raw stats spreadsheet...', 'success')}>Export Analytics CSV</button>
                  </div>
                </div>
              </main>
            )}

            {/* --- PAGE: SUPPORT PANEL --- */}
            {currentPage === 'support' && (
              <main style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
                <div className="glass-panel" style={{ maxWidth: 640, width: '100%', padding: 40 }}>
                  <h2 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)', marginBottom: 8 }}>Help Desk & Verification</h2>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: 32 }}>Verify ad accounts, set domain pixels or report billing inquiries.</p>
                  
                  <form onSubmit={submitTicket} style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 40 }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Ticket Subject</label>
                      <input className="form-input" placeholder="e.g. Help verifying pixel conversion events" value={ticketSubject} onChange={e => setTicketSubject(e.target.value)} required />
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 500 }}>Details</label>
                      <textarea className="form-input" rows={4} placeholder="Describe the configuration failure or custom setup support required..." value={ticketDesc} onChange={e => setTicketDesc(e.target.value)} required />
                    </div>
                    <button className="btn-primary" type="submit">Submit Support Ticket</button>
                  </form>

                  <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}>Your Active Tickets</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {tickets.length === 0 ? (
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>No support tickets active.</div>
                    ) : (
                      tickets.map(t => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 12 }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t.subject}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{t.description}</div>
                          </div>
                          <span style={{
                            padding: '4px 10px', borderRadius: 99, fontSize: '0.7rem',
                            background: t.status === 'OPEN' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                            color: t.status === 'OPEN' ? 'var(--color-warning)' : 'var(--color-success)'
                          }}>{t.status}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </main>
            )}

            {/* --- PAGE: CONTENT CALENDAR VIEW --- */}
            {currentPage === 'calendar' && user?.businessId && (
              <main style={{ padding: 40 }}>
                <ContentCalendar businessId={user.businessId} onToast={addToast} />
              </main>
            )}

            {currentPage === 'leads' && user?.businessId && (
              <LeadsDashboard businessId={user.businessId} onToast={addToast} />
            )}

            {/* --- PAGE: PROFILE --- */}
            {currentPage === 'profile' && user && (
              <ErrorBoundary>
                <div style={{ padding: '0 40px 40px 40px' }}>
                  {!user?.profileCompleted && (
                    <div style={{
                      padding: '16px 24px', margin: '24px 0 0 0', borderRadius: 12,
                      background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#ef4444', display: 'flex', alignItems: 'center', gap: 12, fontWeight: 600
                    }}>
                      <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                      <span>Action Required: Please fill out all business profile details below (Logo, Business Name, Contact Number & Website) and click "Save Changes" to unlock your dashboard.</span>
                    </div>
                  )}
                  <ProfileScreen
                    businessId={user.businessId || 'default_business'}
                    onToast={addToast}
                    onProfileCompleted={() => {
                      setUser((prev: any) => ({ ...prev, profileCompleted: true }));
                      setCurrentPage('connect-meta');
                      addToast('Profile Completed!', 'Your business profile details are saved. Next, connect your Meta account.', 'success');
                    }}
                  />
                </div>
              </ErrorBoundary>
            )}

            {/* --- PAGE: CONNECT META --- */}
            {currentPage === 'connect-meta' && user?.businessId && (
              <ConnectMeta
                businessId={user.businessId}
                addToast={addToast}
                onNavigate={(page) => setCurrentPage(page as any)}
              />
            )}

            {/* --- PAGE: SETTINGS --- */}
            {currentPage === 'settings' && (
              <main style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 32 }}>
                <div>
                  <h1 style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', marginBottom: 8 }}>Settings</h1>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>Manage your account, business profile, and integrations.</p>
                </div>

                {/* Account Info */}
                <div className="glass-panel" style={{ padding: 28 }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserIcon size={18} style={{ color: 'var(--color-primary)' }} /> Account Information
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>FULL NAME</label>
                      <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>{user?.name || '—'}</div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>EMAIL</label>
                      <div style={{ fontSize: '0.95rem' }}>{user?.email || '—'}</div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>ROLE</label>
                      <span style={{
                        display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: '0.75rem', fontWeight: 700,
                        background: user?.role === 'ADMIN' ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)',
                        color: user?.role === 'ADMIN' ? '#ef4444' : 'var(--color-primary)'
                      }}>{user?.role || 'MEMBER'}</span>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>BUSINESS WORKSPACE</label>
                      <div style={{ fontSize: '0.95rem' }}>{user?.businessName || '—'}</div>
                    </div>
                  </div>
                </div>

                {/* Meta Integration shortcut */}
                <div className="glass-panel" style={{ padding: 28 }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Activity size={18} style={{ color: 'var(--color-primary)' }} /> Meta Integration
                  </h3>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: 16 }}>
                    Connect your Facebook Business Manager to enable campaign publishing and analytics sync.
                  </p>
                  <button className="btn-secondary" onClick={() => setCurrentPage('connect-meta')} style={{ gap: 8 }}>
                    <Activity size={14} /> Manage Meta Connection
                  </button>
                </div>

                {/* Subscription */}
                <div className="glass-panel" style={{ padding: 28 }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Shield size={18} style={{ color: 'var(--color-primary)' }} /> Subscription Plan
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{
                      padding: '6px 16px', borderRadius: 99, fontSize: '0.85rem', fontWeight: 700,
                      background: 'rgba(99,102,241,0.15)', color: 'var(--color-primary)',
                      border: '1px solid rgba(99,102,241,0.3)'
                    }}>FREE TIER</span>
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Upgrade to unlock advanced AI features and higher limits.</span>
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="glass-panel" style={{ padding: 28, borderColor: 'rgba(239,68,68,0.2)' }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: 12, color: 'var(--color-danger)' }}>Session</h3>
                  <button
                    onClick={handleLogout}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
                      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                      borderRadius: 10, color: 'var(--color-danger)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600
                    }}
                  >
                    <LogOut size={14} /> Sign Out
                  </button>
                </div>
              </main>
            )}

            {/* --- PAGE: ADMIN PLATFORM PANEL --- */}
            {currentPage === 'admin' && (
              <main style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 32 }}>
                <h2 style={{ fontSize: '1.6rem', fontFamily: 'var(--font-display)' }}>Superuser Admin Panel</h2>

                {adminStats && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
                    <div className="glass-panel" style={{ padding: 20 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>GLOBAL REGISTERED USERS</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 4 }}>{adminStats.totalUsers}</div>
                    </div>
                    <div className="glass-panel" style={{ padding: 20 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>ACTIVE BUSINESSES</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 4 }}>{adminStats.totalBusinesses}</div>
                    </div>
                    <div className="glass-panel" style={{ padding: 20 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>RUNNING META ADS</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 4 }}>{adminStats.activeCampaigns}</div>
                    </div>
                    <div className="glass-panel" style={{ padding: 20 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>ACTIVE SUBSCRIBERS</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: 4 }}>{adminStats.activeSubscribers}</div>
                    </div>
                  </div>
                )}

                {/* Users List & Tickets management */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                  <div className="glass-panel" style={{ padding: 24 }}>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}>Platform Subscriptions</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {adminBusinesses.map(b => (
                        <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 10, fontSize: '0.85rem' }}>
                          <div>
                            <strong>{b.name}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>ID: {b.id}</div>
                          </div>
                          <span>{b.subscriptions[0]?.plan || 'FREE'}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="glass-panel" style={{ padding: 24 }}>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}>Resolve Platform Tickets</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {adminTickets.map(t => (
                        <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: 10, fontSize: '0.85rem' }}>
                          <div>
                            <strong>{t.subject}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>User: {t.user?.email}</div>
                          </div>
                          {t.status === 'OPEN' ? (
                            <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={() => updateTicketAdmin(t.id, 'RESOLVED')}>Resolve</button>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>RESOLVED</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Audit Logs list */}
                <div className="glass-panel" style={{ padding: 24 }}>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}>Operational Audit logs</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 200, overflowY: 'auto' }}>
                    {adminLogs.map(l => (
                      <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 6, fontSize: '0.8rem' }}>
                        <span><strong>{l.action}</strong>: {l.details}</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>User: {l.user?.email}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </main>
            )}
          </div>
        </div>
      )}

      {/* --- FLOATING PERSISTENT AI CHAT ASSISTANT --- */}
      <div style={{
        position: 'fixed', bottom: 24, left: 24, zIndex: 999
      }}>
        {/* Round floating button */}
        <button onClick={() => setIsAssistantOpen(!isAssistantOpen)} style={{
          width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-light))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', border: 'none', cursor: 'pointer',
          boxShadow: '0 8px 30px rgba(99, 102, 241, 0.4)', transition: 'var(--transition-smooth)'
        }}>
          {isAssistantOpen ? <X size={22} /> : <MessageSquare size={22} />}
        </button>

        {/* Sliding drawer panel */}
        {isAssistantOpen && (
          <div style={{
            position: 'absolute', bottom: 74, left: 0, width: 390, height: 530,
            display: 'flex', flexDirection: 'column',
            background: 'rgba(15, 23, 42, 0.96)', backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: 24, overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(99, 102, 241, 0.25)'
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 20px', background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.2)', backdropFilter: 'blur(8px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff',
                  border: '1.5px solid rgba(255, 255, 255, 0.4)'
                }}>
                  <Bot size={22} />
                </div>
                <div>
                  <h4 style={{ fontSize: '0.98rem', fontWeight: 800, color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}>Visionpilot Support Assistant</h4>
                  <div style={{ fontSize: '0.72rem', color: '#e0e7ff', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 8px #4ade80' }}></span>
                    Meta Authorised AI Marketing Agent • Active
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsAssistantOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#ffffff', opacity: 0.8, cursor: 'pointer', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Suggestion Pills */}
            <div style={{ padding: '10px 14px 4px', display: 'flex', gap: 6, overflowX: 'auto', background: '#0f172a', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {[
                { label: '🚀 Meta Connect', msg: 'How do I connect my Facebook & Instagram account?' },
                { label: '📅 Post Calendar', msg: 'How do scheduled posts work in the calendar?' },
                { label: '💳 Payment Help', msg: 'How do I upgrade or view my payment invoice?' }
              ].map((chip, cIdx) => (
                <button
                  key={cIdx}
                  type="button"
                  onClick={() => setAssistantInput(chip.msg)}
                  style={{
                    padding: '5px 10px', fontSize: '0.7rem', fontWeight: 600, color: '#a5b4fc',
                    background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: 20, whiteSpace: 'nowrap', cursor: 'pointer'
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Messages list */}
            <div style={{ flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, background: '#0f172a' }}>
              {chatMessages.map((m, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start'
                }}>
                  <div style={{
                    maxWidth: '85%', padding: '11px 15px', borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    fontSize: '0.85rem', lineHeight: '1.5',
                    background: m.role === 'user' ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' : '#1e293b',
                    color: '#ffffff', border: m.role === 'user' ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: m.role === 'user' ? '0 4px 12px rgba(99, 102, 241, 0.3)' : '0 4px 12px rgba(0,0,0,0.3)'
                  }}>
                    {m.role === 'user' ? m.content : (() => {
                      const raw = (m.content || '').replace(/\*\*/g, '');
                      const lines = raw.split('\n');
                      return lines.map((line: string, lIdx: number) => {
                        const clean = line.replace(/^#{1,6}\s*/, '').trim();
                        if (!clean && lIdx < lines.length - 1) return <div key={lIdx} style={{ height: 6 }} />;
                        return (
                          <div key={lIdx} style={{ marginBottom: 4, lineHeight: '1.5', color: '#f1f5f9' }}>
                            {clean}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              ))}
            </div>

            {/* Input area */}
            <form onSubmit={sendAssistantMessage} style={{ padding: '12px 14px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', background: '#0f172a', display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                placeholder="Ask Visionpilot AI Assistant..."
                value={assistantInput}
                onChange={e => setAssistantInput(e.target.value)}
                style={{
                  flex: 1,
                  padding: '11px 16px',
                  fontSize: '0.85rem',
                  background: '#1e293b',
                  color: '#ffffff',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 9999,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)'
                }}
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        )}
      </div>

      {/* --- ADMIN LOGIN MODAL OVERLAY --- */}
      {isAdminModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          zIndex: 99999
        }}>
          <div style={{
            width: '90%', maxWidth: 420, padding: 32, borderRadius: 20,
            background: '#0f172a', border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.75)', display: 'flex', flexDirection: 'column', gap: 20
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.4rem', fontFamily: 'var(--font-display)', margin: 0, color: '#ffffff', fontWeight: 700 }}>Admin Portal Login</h3>
              <button
                onClick={() => setIsAdminModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.4rem', padding: '2px 8px' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: '#cbd5e1', margin: 0, lineHeight: 1.5 }}>
              Enter administrative credentials to access system management console.
            </p>

            {adminModalError && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5', fontSize: '0.85rem' }}>
                {adminModalError}
              </div>
            )}

            <form onSubmit={handleAdminModalSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600, marginBottom: 6 }}>Username</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="admin@campaignai.com"
                  value={adminInputUsername}
                  onChange={(e) => setAdminInputUsername(e.target.value)}
                  required
                  style={{ width: '100%', padding: '12px 16px', fontSize: '0.95rem', background: '#ffffff', color: '#0f172a', fontWeight: 500, borderRadius: 10 }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600, marginBottom: 6 }}>Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="••••••••"
                  value={adminInputPassword}
                  onChange={(e) => setAdminInputPassword(e.target.value)}
                  required
                  style={{ width: '100%', padding: '12px 16px', fontSize: '0.95rem', background: '#ffffff', color: '#0f172a', fontWeight: 500, borderRadius: 10 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setIsAdminModalOpen(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    transition: 'all 0.2s ease'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 1, padding: '12px', justifyContent: 'center', fontSize: '0.95rem', fontWeight: 600 }}
                >
                  Login to Admin
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
