import React, { useState, useEffect, useRef } from 'react';

/**
 * Firestore hands `scheduledTime` back in several shapes depending on whether
 * it came from the Admin SDK, a REST response, or the scheduler collection.
 */
function parseEntryDate(entry: any): Date | null {
  const raw = entry?.scheduledTime;
  if (!raw) return null;

  let date: Date;
  if (typeof raw?.toDate === 'function') date = raw.toDate();
  else if (typeof raw?._seconds === 'number') date = new Date(raw._seconds * 1000);
  else if (typeof raw?.seconds === 'number') date = new Date(raw.seconds * 1000);
  else date = new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date;
}
import { 
  Calendar as CalendarIcon, 
  Trash2, 
  Plus, 
  Printer, 
  CornerDownLeft, 
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  Send,
  RefreshCw,
  Image as ImageIcon,
  Sparkles,
  Copy,
  Edit3,
  CheckCircle,
  Clock,
  FileSpreadsheet,
  FileDown,
  AlertCircle
} from 'lucide-react';
import { api } from '../services/api';

interface ContentCalendarProps {
  businessId: string;
  onToast: (title: string, message: string, type: 'success' | 'alert' | 'info') => void;
}

export const ContentCalendar: React.FC<ContentCalendarProps> = ({ businessId, onToast }) => {
  const defaultScheduleDate = new Date().toISOString().slice(0, 10);
  const [calendarEntries, setCalendarEntries] = useState<any[]>([]);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [brokenImageIds, setBrokenImageIds] = useState<Set<string>>(new Set());
  // Some older calendar rows still hold an on-demand generation URL
  // (image.pollinations.ai) rather than a stored file. Those render the image
  // from scratch on every request and time out often enough that a single
  // failure is not proof the image is gone — so each row gets one silent retry
  // before it is shown as broken.
  const [imageRetryCounts, setImageRetryCounts] = useState<Record<string, number>>({});
  const MAX_IMAGE_RETRIES = 1;

  const handleImageError = (entryId: string) => {
    const attempts = imageRetryCounts[entryId] || 0;
    if (attempts < MAX_IMAGE_RETRIES) {
      setImageRetryCounts(previous => ({ ...previous, [entryId]: attempts + 1 }));
      return;
    }
    setBrokenImageIds(previous => new Set(previous).add(entryId));
  };

  // Appends a cache-busting param so the retry is a genuine second attempt
  // rather than the browser replaying its cached failure.
  const imageSrcFor = (entryId: string, url: string) => {
    const attempts = imageRetryCounts[entryId] || 0;
    if (attempts === 0 || url.startsWith('data:')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}vp_retry=${attempts}`;
  };

  // Google Sheets Selection & Editing State
  const [selectedCell, setSelectedCell] = useState<{ rowId: string; colName: string } | null>(null);
  const [formulaValue, setFormulaValue] = useState<string>('');

  // Modals State
  const [editingEntry, setEditingEntry] = useState<any | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isScheduleSettingsOpen, setIsScheduleSettingsOpen] = useState(false);
  const [scheduleSettings, setScheduleSettings] = useState({
    days: ['Monday', 'Wednesday', 'Friday'],
    time: '20:00',
  });
  const [previewEntry, setPreviewEntry] = useState<any | null>(null);
  const [previewDraft, setPreviewDraft] = useState({
    bio: '',
    caption: '',
    imageUrl: '',
    imageOverlayText: '',
    platform: 'instagram',
  });
  
  // Custom new entry form state
  const [newEntryForm, setNewEntryForm] = useState({
    dayName: 'Monday',
    platform: 'both',
    postType: 'Graphic',
    contentIdea: '',
    contentDescription: '',
    caption: '',
    hashtagsStr: '',
    status: 'PENDING',
    scheduledDate: defaultScheduleDate,
    scheduledTime: '10:00'
  });

  // Post-now modal state
  const [postModal, setPostModal] = useState<{ entry: any; platform: string } | null>(null);
  const [isPosting, setIsPosting] = useState(false);

  // Regeneration counts per entry (entryId -> count), seeded from entry.regenerateCount
  const [regenerateCounts, setRegenerateCounts] = useState<Record<string, number>>({});

  const fetchCalendar = async () => {
    if (!businessId) return;
    
    try {
      const [calendarData, schedulerData] = await Promise.allSettled([
        api.content.getCalendar(businessId),
        api.scheduler.getPosts(businessId),
      ]);

      const calendarList = calendarData.status === 'fulfilled' ? (calendarData.value?.entries || []) : [];
      const schedulerList = schedulerData.status === 'fulfilled' ? (schedulerData.value?.posts || []) : [];

      const existingIds = new Set(calendarList.map((e: any) => e.id));

      const normalizedScheduled = schedulerList
        .filter((sp: any) => !existingIds.has(sp.id))
        .map((sp: any) => ({
          id: sp.id,
          dayName: new Date(sp.scheduledTime?._seconds ? sp.scheduledTime._seconds * 1000 : sp.scheduledTime).toLocaleDateString('en-US', { weekday: 'long' }),
          platform: sp.platform || 'both',
          postType: sp.postType || 'Instant Post',
          contentIdea: sp.headline || (sp.caption ? sp.caption.substring(0, 45) + '...' : 'Scheduled Post'),
          contentDescription: sp.contentDescription || `${sp.postType || 'Social post'} about ${sp.headline || 'the business offering'}.`,
          caption: sp.caption || '',
          hashtags: sp.hashtags || [],
          status: sp.status || 'SCHEDULED',
          scheduledTime: sp.scheduledTime,
          imageUrl: sp.imageUrl || '',
          isSchedulerPost: true,
        }));

      const merged = [...calendarList, ...normalizedScheduled];
      setCalendarEntries(merged);
      return merged;
    } catch (err: any) {
      onToast('Error', err.message || 'Failed to load content calendar', 'alert');
      return [];
    }
  };

  // The plan used to be created only by the Meta OAuth callback, so if that
  // callback errored once (a reused authorization code, a closed tab) the
  // calendar stayed empty for good with no way back. Opening the page with
  // nothing in it now builds the plan.
  const didAutoGenerate = useRef(false);
  useEffect(() => {
    if (!businessId) return;
    didAutoGenerate.current = false;

    (async () => {
      const entries = await fetchCalendar();
      if (didAutoGenerate.current || !entries || entries.length > 0) return;
      didAutoGenerate.current = true;

      setIsAutoGenerating(true);
      try {
        const result = await api.content.ensureInitialWeek(businessId);
        if (result?.created) {
          const days: string[] = Array.isArray(result.selectedDays) ? result.selectedDays : [];
          onToast(
            'Content plan ready',
            days.length
              ? `Your ${days.join(', ')} plan is ready. Images are being generated now.`
              : 'Your content plan is ready. Images are being generated now.',
            'success',
          );
        }
        await fetchCalendar();
      } catch (err: any) {
        onToast('Could not build your content plan', err.message || 'Please try again.', 'alert');
      } finally {
        setIsAutoGenerating(false);
      }
    })();
  }, [businessId]);

  // Creatives are produced in the background after the posts are saved, so poll
  // while any row is still without one and stop as soon as they have all landed.
  useEffect(() => {
    const awaitingImages = calendarEntries.some(e => !e.imageUrl && !e.isSchedulerPost);
    if (!awaitingImages || !businessId) return;

    const timer = setInterval(() => { fetchCalendar(); }, 15000);
    return () => clearInterval(timer);
  }, [calendarEntries, businessId]);

  // Sync regenerateCounts from loaded entries
  useEffect(() => {
    if (calendarEntries.length > 0) {
      setRegenerateCounts(prev => {
        const updated = { ...prev };
        for (const entry of calendarEntries) {
          if (entry.id && !(entry.id in updated)) {
            updated[entry.id] = entry.regenerateCount || 0;
          }
        }
        return updated;
      });
    }
  }, [calendarEntries]);

  // A generated plan starts from the upcoming week, so its posts can land in
  // next month.  When the month on screen holds nothing, jump to the month that
  // actually contains the plan — otherwise the user sees an empty grid and
  // assumes nothing was generated.
  const didAutoJumpMonth = useRef(false);
  useEffect(() => {
    if (didAutoJumpMonth.current || calendarEntries.length === 0) return;

    const dates = calendarEntries
      .map(parseEntryDate)
      .filter((d): d is Date => d !== null);
    if (dates.length === 0) return;

    const hasEntriesInView = dates.some(
      (d) => d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear(),
    );
    if (hasEntriesInView) {
      didAutoJumpMonth.current = true;
      return;
    }

    const now = Date.now();
    const upcoming = dates
      .filter((d) => d.getTime() >= now)
      .sort((a, b) => a.getTime() - b.getTime());
    const target = upcoming[0] || [...dates].sort((a, b) => b.getTime() - a.getTime())[0];

    if (target) {
      setCurrentDate(new Date(target.getFullYear(), target.getMonth(), 1));
      didAutoJumpMonth.current = true;
    }
  }, [calendarEntries]);

  // Date Formatting: DD/MM/YYYY
  const formatSpreadsheetDate = (dateInput: any) => {
    if (!dateInput) return '';
    let date: Date;
    if (dateInput.toDate && typeof dateInput.toDate === 'function') {
      date = dateInput.toDate();
    } else if (dateInput._seconds) {
      date = new Date(dateInput._seconds * 1000);
    } else {
      date = new Date(dateInput);
    }
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const formatCaptionWithHashtags = (entry: any) => {
    const caption = (entry.caption || '').trim();
    const hashtags = Array.isArray(entry.hashtags)
      ? entry.hashtags.map((tag: string) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')
      : '';
    return [caption, hashtags].filter(Boolean).join('\n\n');
  };

  // Get field names of selected cell
  const getFieldFromCol = (colName: string) => {
    switch (colName) {
      case 'A': return 'scheduledTime';
      case 'B': return 'caption';
      case 'C': return 'status';
      default: return '';
    }
  };

  // Handle cell click selection
  const handleCellClick = (entry: any, colName: string) => {
    setSelectedCell({ rowId: entry.id, colName });
    const field = getFieldFromCol(colName);
    if (!field) {
      setFormulaValue('');
      return;
    }

    if (field === 'scheduledTime') {
      setFormulaValue(formatSpreadsheetDate(entry[field]));
    } else if (field === 'status') {
      setFormulaValue((entry[field] || 'pending').toLowerCase());
    } else {
      setFormulaValue(entry[field] || '');
    }
  };

  // Save cell edit from formula bar
  const handleSaveCellEdit = async () => {
    if (!selectedCell) return;
    const { rowId, colName } = selectedCell;
    const field = getFieldFromCol(colName);
    if (!field) return;

    
    try {
      let valueToSave: any = formulaValue;
      if (field === 'status') {
        valueToSave = formulaValue.toUpperCase();
      } else if (field === 'scheduledTime') {
        const parts = formulaValue.split('/');
        if (parts.length === 3) {
          const d = parseInt(parts[0]);
          const m = parseInt(parts[1]) - 1;
          const y = parseInt(parts[2]);
          const parsedDate = new Date(y, m, d, 10, 0);
          if (!isNaN(parsedDate.getTime())) {
            valueToSave = parsedDate.toISOString();
          }
        }
      }

      await api.content.updateEntry(rowId, { [field]: valueToSave });
      onToast('Cell Updated', 'Spreadsheet cell updated successfully.', 'success');
      await fetchCalendar();
    } catch (err: any) {
      onToast('Update Failed', err.message || 'Could not save cell edit', 'alert');
    } finally {
      
    }
  };

  // Month navigation
  const handlePrevMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };



  // Row Action Handlers
  const handleDeleteRow = async (id: string) => {
    if (!window.confirm('Delete this row from the spreadsheet?')) return;
    
    try {
      await api.content.deleteEntry(id);
      onToast('Row Deleted', 'Removed calendar entry.', 'success');
      if (selectedCell?.rowId === id) setSelectedCell(null);
      await fetchCalendar();
    } catch (err: any) {
      onToast('Delete Failed', err.message, 'alert');
    } finally {
      
    }
  };

  const handleApproveRow = async (entry: any) => {
    try {
      await api.content.updateEntry(entry.id, { status: 'APPROVED' });
      onToast('Approved', 'Content entry approved for scheduling.', 'success');
      await fetchCalendar();
    } catch (err: any) {
      onToast('Approve Failed', err.message || 'Could not approve entry', 'alert');
    }
  };

  const handleDuplicateRow = async (entry: any) => {
    try {
      const payload = {
        businessId,
        dayName: entry.dayName || 'Monday',
        platform: entry.platform || 'both',
        scheduledTime: new Date().toISOString(),
        contentIdea: `${entry.contentIdea || 'Copy'} (Copy)`,
        contentDescription: entry.contentDescription || '',
        caption: entry.caption || '',
        hashtags: entry.hashtags || [],
        postType: entry.postType || 'Graphic',
        status: 'PENDING',
        imageUrl: entry.imageUrl || '',
      };
      await api.content.createEntry(payload);
      onToast('Duplicated', 'Copied content row into Content Calendar.', 'success');
      await fetchCalendar();
    } catch (err: any) {
      onToast('Duplicate Failed', err.message || 'Could not duplicate row', 'alert');
    }
  };



  const handlePreviewImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast('Invalid image', 'Please choose a PNG, JPG, or WEBP image.', 'alert');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreviewDraft(prev => ({ ...prev, imageUrl: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const handleConfirmSchedule = async () => {
    if (!previewEntry) return;
    if (!previewDraft.caption.trim()) {
      onToast('Caption required', 'Add post text before scheduling.', 'alert');
      return;
    }
    if (previewDraft.imageUrl.startsWith('data:')) {
      onToast('Use a public image URL', 'Local image previews cannot be fetched by Meta. Paste a public image URL before scheduling.', 'alert');
      return;
    }
    try {
      await api.content.updateEntry(previewEntry.id, {
        caption: previewDraft.caption,
        contentDescription: previewDraft.bio,
        profileBio: previewDraft.bio,
        imageUrl: previewDraft.imageUrl,
        imageOverlayText: previewDraft.imageOverlayText,
      });
      await api.scheduler.schedule({
        businessId,
        calendarEntryId: previewEntry.id,
        caption: previewDraft.caption,
        headline: previewEntry.contentIdea || previewEntry.headline,
        hashtags: previewEntry.hashtags || [],
        imageUrl: previewDraft.imageUrl,
        imageOverlayText: previewDraft.imageOverlayText,
        profileBio: previewDraft.bio,
        platform: previewDraft.platform === 'facebook' ? 'Facebook' : 'Instagram',
        scheduledTime: (() => {
          if (!previewEntry.scheduledTime) return new Date().toISOString();
          const d = new Date(previewEntry.scheduledTime);
          return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
        })(),
        postType: previewEntry.postType,
      });

      await api.content.updateEntry(previewEntry.id, {
        businessId,
        status: 'SCHEDULED',
        caption: previewDraft.caption,
        imageUrl: previewDraft.imageUrl,
        imageOverlayText: previewDraft.imageOverlayText,
      });
      onToast('Scheduled', `Post added to scheduler queue!`, 'success');
      setPreviewEntry(null);
      await fetchCalendar();
    } catch (err: any) {
      onToast('Scheduling Failed', err.message, 'alert');
    } finally {
      
    }
  };

  const handleRegenerateRow = async (id: string) => {
    const regenCount = regenerateCounts[id] || 0;
    if (regenCount >= 2) {
      onToast('Limit Reached', 'You can only regenerate a post 2 times.', 'alert');
      return;
    }
    onToast('Regenerating...', 'AI is generating new image and caption...', 'info');
    try {
      const res = await api.content.regenerateEntry(id);
      if (res.success) {
        const newCount = regenCount + 1;
        setRegenerateCounts(prev => ({ ...prev, [id]: newCount }));
        // Clear the failed-image flag so the freshly generated image is shown
        // instead of staying stuck on the retry placeholder.
        setBrokenImageIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        // Reset the retry budget too, otherwise the new image is marked broken
        // on its very first hiccup because the old attempts still count.
        setImageRetryCounts(prev => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        onToast('Regeneration Complete', `New content and image generated. (${newCount}/2 uses)`, 'success');
        await fetchCalendar();
      } else {
        onToast('Regeneration Failed', res.message || 'Could not regenerate.', 'alert');
      }
    } catch (err: any) {
      const errMsg = err.message || 'Error';
      if (errMsg.toLowerCase().includes('limit')) {
        onToast('Limit Reached', 'You can only regenerate each post 2 times.', 'alert');
        setRegenerateCounts(prev => ({ ...prev, [id]: 2 }));
      } else {
        onToast('Error', errMsg, 'alert');
      }
    }
  };

  const handlePostNow = async () => {
    if (!postModal) return;
    setIsPosting(true);
    try {
      const res = await api.content.postNow(postModal.entry.id, postModal.platform);
      if (res.success) {
        onToast('Posted! 🎉', `Successfully posted to ${postModal.platform === 'both' ? 'Facebook & Instagram' : postModal.platform}.`, 'success');
        setPostModal(null);
        await fetchCalendar();
      } else {
        // Surface the actual reason Meta rejected it rather than a generic
        // line — the per-platform errors say exactly what to fix.
        const reasons = Object.entries(res.results || {})
          .map(([platform, r]: [string, any]) => (r?.error ? `${platform}: ${r.error}` : null))
          .filter(Boolean)
          .join('  ');
        onToast('Post Failed', reasons || 'Could not publish the post. Check your Meta connection.', 'alert');
      }
    } catch (err: any) {
      onToast('Post Failed', err.message || 'Error posting to Meta.', 'alert');
    } finally {
      setIsPosting(false);
    }
  };

  const handleApplyScheduleSettings = async () => {
    if (scheduleSettings.days.length === 0) {
      onToast('Choose posting days', 'Select at least one day for your content schedule.', 'alert');
      return;
    }

    const [hours, minutes] = scheduleSettings.time.split(':').map(Number);
    const dayIndexes: Record<string, number> = {
      Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
      Thursday: 4, Friday: 5, Saturday: 6,
    };
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    startOfWeek.setHours(hours, minutes, 0, 0);
    if (startOfWeek.getTime() < Date.now()) startOfWeek.setDate(startOfWeek.getDate() + 7);

    const editableEntries = calendarEntries
      .filter(entry => !['POSTED', 'PUBLISHED'].includes((entry.status || '').toUpperCase()))
      .sort((a, b) => Number(new Date(a.scheduledTime || 0)) - Number(new Date(b.scheduledTime || 0)));

    try {
      await Promise.all(editableEntries.map((entry, index) => {
        const dayName = scheduleSettings.days[index % scheduleSettings.days.length];
        const scheduledTime = new Date(startOfWeek);
        scheduledTime.setDate(startOfWeek.getDate() + (dayIndexes[dayName] - 1 + 7) % 7 + Math.floor(index / scheduleSettings.days.length) * 7);
        return api.content.updateEntry(entry.id, {
          dayName,
          scheduledTime: scheduledTime.toISOString(),
          bestPostingTime: new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }));
      setIsScheduleSettingsOpen(false);
      onToast('Schedule Updated', `Posts will be prepared for ${scheduleSettings.days.join(', ')} at ${scheduleSettings.time}.`, 'success');
      await fetchCalendar();
    } catch (err: any) {
      onToast('Schedule Failed', err.message || 'Could not update the schedule.', 'alert');
    }
  };



  const handleUpdateEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;

    
    try {
      const hashtags = typeof editingEntry.hashtags === 'string'
        ? (editingEntry.hashtags as string).split(',').map((h: string) => h.trim()).filter((h: string) => h.length > 0)
        : editingEntry.hashtags;

      const updatedPayload = {
        postType: editingEntry.postType,
        contentIdea: editingEntry.contentIdea,
        contentDescription: editingEntry.contentDescription,
        caption: editingEntry.caption,
        status: editingEntry.status,
        hashtags: hashtags || [],
      };

      await api.content.updateEntry(editingEntry.id, updatedPayload);
      onToast('Saved', 'Content row updated successfully.', 'success');
      setIsEditModalOpen(false);
      setEditingEntry(null);
      await fetchCalendar();
    } catch (err: any) {
      onToast('Update Failed', err.message, 'alert');
    } finally {
      
    }
  };

  const handleAddCustomEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const hashtags = newEntryForm.hashtagsStr
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      const [year, month, dateDay] = newEntryForm.scheduledDate.split('-').map(Number);
      const [hours, minutes] = newEntryForm.scheduledTime.split(':').map(Number);
      const scheduledTime = new Date(year, month - 1, dateDay, hours, minutes);

      const payload = {
        businessId,
        dayName: newEntryForm.dayName,
        platform: newEntryForm.platform,
        scheduledTime: scheduledTime.toISOString(),
        contentIdea: newEntryForm.contentIdea,
        contentDescription: newEntryForm.contentDescription,
        caption: newEntryForm.caption,
        hashtags,
        postType: newEntryForm.postType,
        status: newEntryForm.status,
      };

      await api.content.createEntry(payload);
      onToast('Entry Created', 'Custom row added to calendar.', 'success');
      setIsAddModalOpen(false);
      setNewEntryForm({
        dayName: 'Monday',
        platform: 'both',
        postType: 'Graphic',
        contentIdea: '',
        contentDescription: '',
        caption: '',
        hashtagsStr: '',
        status: 'PENDING',
        scheduledDate: defaultScheduleDate,
        scheduledTime: '10:00'
      });
      await fetchCalendar();
    } catch (err: any) {
      onToast('Error', err.message, 'alert');
    } finally {
      
    }
  };

  // Exporters
  const handleExportCSV = () => {
    const headers = ['Date', 'Caption with hashtags', 'Status'];
    const rows = filteredEntries.map(entry => [
      entry.scheduledTime ? formatSpreadsheetDate(entry.scheduledTime) : '',
      formatCaptionWithHashtags(entry),
      (entry.status || 'PENDING').toLowerCase()
    ]);
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `content_calendar_${businessId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    const headers = ['Date', 'Caption with hashtags', 'Status'];
    const rows = filteredEntries.map(entry => [
      entry.scheduledTime ? formatSpreadsheetDate(entry.scheduledTime) : '',
      formatCaptionWithHashtags(entry),
      (entry.status || 'PENDING').toLowerCase()
    ]);
    const tabContent = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    const blob = new Blob([tabContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `content_calendar_${businessId}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Kept for backwards compatibility with existing bookmarks; the toolbar now
  // exposes schedule settings instead of spreadsheet exports.
  // (both export handlers are wired to toolbar buttons above)

  const handleExportPDF = () => {
    window.print();
  };

  // Filtering matching target month
  const filteredEntries = calendarEntries.filter((entry) => {
    const idea = (entry.contentIdea || '').toLowerCase();
    const desc = (entry.contentDescription || '').toLowerCase();
    const cap = (entry.caption || '').toLowerCase();
    const type = (entry.postType || '').toLowerCase();
    const query = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm || idea.includes(query) || desc.includes(query) || cap.includes(query) || type.includes(query);

    const matchesStatus = statusFilter === 'ALL' || (entry.status || 'PENDING').toUpperCase() === statusFilter.toUpperCase();
    let entryDate: Date | null = null;
    if (entry.scheduledTime) {
      if (entry.scheduledTime.toDate && typeof entry.scheduledTime.toDate === 'function') {
        entryDate = entry.scheduledTime.toDate();
      } else if (entry.scheduledTime._seconds) {
        entryDate = new Date(entry.scheduledTime._seconds * 1000);
      } else {
        entryDate = new Date(entry.scheduledTime);
      }
    }
    const matchesMonth = entryDate 
      ? entryDate.getMonth() === currentDate.getMonth() && entryDate.getFullYear() === currentDate.getFullYear()
      : false;

    return matchesSearch && matchesStatus && matchesMonth;
  });

  const monthYearString = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  const dataRowsCount = filteredEntries.length;
  // Keep a couple of blank rows for the spreadsheet feel, but don't pad a
  // 3-post week out to 12 rows — nine empty rows read as "generation failed".
  // With no rows at all, the empty state below replaces the padding entirely.
  const paddingRowsNeeded = dataRowsCount === 0 ? 0 : Math.min(2, Math.max(0, 8 - dataRowsCount));
  const paddingRowsArray = Array.from({ length: paddingRowsNeeded });

  // Explicit CSS rules for spreadsheet appearance
  const tableContainerStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)',
    overflow: 'hidden',
    marginTop: '20px'
  };

  const scrollContainerStyle: React.CSSProperties = {
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: '620px'
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'Arial, sans-serif',
    fontSize: '13px',
    color: '#1e293b',
    tableLayout: 'fixed',
    minWidth: '900px'
  };

  const thStyle: React.CSSProperties = {
    background: '#f1f5f9',
    color: '#475569',
    borderRight: '1px solid #cbd5e1',
    borderBottom: '1px solid #cbd5e1',
    padding: '8px 12px',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: '11px',
    userSelect: 'none'
  };

  const rowHeaderStyle: React.CSSProperties = {
    background: '#f1f5f9',
    color: '#475569',
    borderRight: '1px solid #cbd5e1',
    borderBottom: '1px solid #cbd5e1',
    padding: '8px 4px',
    textAlign: 'center',
    width: '45px',
    fontWeight: 'bold',
    userSelect: 'none'
  };

  const cellStyle = (isSelected: boolean, alignment: 'left' | 'right' | 'center', vertical: 'top' | 'bottom'): React.CSSProperties => ({
    borderRight: '1px solid #e2e8f0',
    borderBottom: '1px solid #cbd5e1',
    padding: '10px 12px',
    textAlign: alignment,
    verticalAlign: vertical,
    cursor: 'cell',
    position: 'relative',
    background: isSelected ? 'rgba(99, 102, 241, 0.05)' : '#ffffff',
    outline: isSelected ? '2px solid #4f46e5' : 'none',
    outlineOffset: '-2px',
    wordBreak: 'break-word'
  });

  return (
    <div style={{ padding: '24px', background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Top Banner Control Bar */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', border: '1px solid #e2e8f0', padding: '20px', borderRadius: '16px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.05)', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ padding: '10px', background: '#e0e7ff', borderRadius: '12px' }}>
            <CalendarIcon className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Content Calendar Spreadsheet</h2>
            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '4px 0 0 0' }}>
              Interactive sheet editor. Click cells to modify copies, manage posting plans, or export spreadsheets.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '10px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <Plus className="w-4 h-4" /> Add Row
          </button>
          <button
            onClick={() => setIsScheduleSettingsOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', background: '#eef2ff', border: '1px solid #a5b4fc', color: '#3730a3', borderRadius: '10px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <Clock className="w-3.5 h-3.5" /> Schedule
          </button>
          <button
            onClick={handleExportCSV}
            title="Download the visible rows as a CSV file"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '10px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <FileDown className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={handleExportExcel}
            title="Download the visible rows as an Excel file"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '10px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
          <button
            onClick={handleExportPDF}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', background: '#ffffff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: '10px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <Printer className="w-3.5 h-3.5" /> Print / PDF
          </button>
        </div>
      </div>

      {/* Filter Options */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', background: '#ffffff', border: '1px solid #e2e8f0', padding: '12px 16px', borderRadius: '16px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.05)', gap: '16px' }}>
        
        {/* Search */}
        <div style={{ position: 'relative', width: '280px' }}>
          <Search className="w-4 h-4 text-slate-400" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            style={{ width: '100%', padding: '8px 12px 8px 34px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '10px', fontSize: '0.8rem', color: '#1e293b', outline: 'none' }}
            placeholder="Search matching words..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '6px 12px', borderRadius: '10px' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold' }}>STATUS:</span>
            <select
              style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '0.8rem', color: '#334155', fontWeight: 600, cursor: 'pointer' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="POSTED">Posted</option>
            </select>
          </div>

          {/* Month Navigator */}
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', background: '#f8fafc', borderRadius: '10px', overflow: 'hidden' }}>
            <button onClick={handlePrevMonth} style={{ padding: '6px 10px', border: 'none', background: 'transparent', borderRight: '1px solid #cbd5e1', cursor: 'pointer', color: '#475569' }}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span style={{ padding: '0 16px', fontSize: '0.8rem', fontWeight: 'bold', color: '#1e293b', minWidth: '110px', textAlign: 'center' }}>
              {monthYearString}
            </span>
            <button onClick={handleNextMonth} style={{ padding: '6px 10px', border: 'none', background: 'transparent', borderLeft: '1px solid #cbd5e1', cursor: 'pointer', color: '#475569' }}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>

      {/* Formula Bar */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '10px', overflow: 'hidden', fontSize: '0.8rem' }}>
        <div style={{ background: '#f1f5f9', padding: '8px 16px', borderRight: '1px solid #cbd5e1', color: '#64748b', fontWeight: 'bold', fontStyle: 'italic', userSelect: 'none', minWidth: '52px', textAlign: 'center' }}>
          fx
        </div>
        <input
          type="text"
          style={{ flex: 1, padding: '8px 16px', background: '#ffffff', color: '#1e293b', border: 'none', outline: 'none' }}
          placeholder={selectedCell ? "Type here to edit the selected cell and press Enter..." : "Select any cell below to view or edit its contents..."}
          value={formulaValue}
          onChange={(e) => setFormulaValue(e.target.value)}
          disabled={!selectedCell}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveCellEdit();
          }}
        />
        {selectedCell && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '8px', borderLeft: '1px solid #e2e8f0' }}>
            <button
              onClick={handleSaveCellEdit}
              title="Apply edits (Enter)"
              style={{ padding: '6px', border: 'none', background: 'transparent', color: '#4f46e5', cursor: 'pointer', borderRadius: '6px' }}
            >
              <CornerDownLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setSelectedCell(null);
                setFormulaValue('');
              }}
              title="Cancel"
              style={{ padding: '6px', border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', borderRadius: '6px' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Spreadsheet Grid Table */}
      <div style={tableContainerStyle}>
        <div style={scrollContainerStyle}>
          <table style={tableStyle}>
            
            {/* Columns (Row# + image + date + caption + status + actions) */}
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                <th style={{ ...thStyle, width: '45px', background: '#e2e8f0', borderRight: '1px solid #cbd5e1' }}></th>
                <th style={{ ...thStyle, width: '90px' }}>IMG</th>
                <th style={{ ...thStyle, width: '120px' }}>A</th>
                <th style={{ ...thStyle, width: '430px' }}>B</th>
                <th style={{ ...thStyle, width: '100px' }}>C</th>
                <th style={{ ...thStyle, width: '200px', borderRight: 'none' }} className="no-print">D</th>
              </tr>
            </thead>

            <tbody>
              
              {/* Row 1: Header values */}
              <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
                <td style={rowHeaderStyle}>1</td>
                <td style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '10px 12px', fontWeight: 'bold', textAlign: 'center' }}>Image</td>
                <td style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '10px 12px', fontWeight: 'bold', textAlign: 'left' }}>Date</td>
                <td style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '10px 12px', fontWeight: 'bold', textAlign: 'left' }}>Caption with hashtags</td>
                <td style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '10px 12px', fontWeight: 'bold', textAlign: 'left' }}>Status</td>
                <td style={{ borderBottom: '1px solid #cbd5e1', padding: '10px 12px', fontWeight: 'bold', textAlign: 'center' }} className="no-print">Actions</td>
              </tr>

              {/* Real Data Rows */}
              {filteredEntries.map((entry, idx) => {
                const rowNum = idx + 2;
                const formattedDate = entry.scheduledTime ? formatSpreadsheetDate(entry.scheduledTime) : '';
                const lowercaseStatus = (entry.status || 'pending').toLowerCase();
                const regenCount = regenerateCounts[entry.id] ?? (entry.regenerateCount || 0);
                const regenDisabled = regenCount >= 2;

                return (
                  <tr key={entry.id} style={{ borderBottom: '1px solid #cbd5e1' }}>
                    
                    {/* Row Index */}
                    <td style={rowHeaderStyle}>{rowNum}</td>

                    {/* Image Column (AI-generated) */}
                    <td style={{ borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #cbd5e1', padding: '6px', textAlign: 'center', verticalAlign: 'middle', background: '#fafafa' }}>
                      {entry.imageUrl && !brokenImageIds.has(entry.id) ? (
                        <img
                          key={`${entry.id}-${imageRetryCounts[entry.id] || 0}`}
                          src={imageSrcFor(entry.id, entry.imageUrl)}
                          alt={entry.headline ? `Visual for ${entry.headline}` : 'Post visual'}
                          loading="lazy"
                          title="Click to open the post preview"
                          onClick={() => setPreviewEntry(entry)}
                          style={{
                            width: '76px', height: '76px', objectFit: 'cover', borderRadius: '8px',
                            display: 'block', margin: '0 auto', border: '1px solid #e2e8f0',
                            cursor: 'pointer', background: '#f1f5f9',
                          }}
                          onError={() => handleImageError(entry.id)}
                        />
                      ) : brokenImageIds.has(entry.id) ? (
                        // Distinct from "not generated yet" — the image exists but
                        // could not be loaded, so offer a retry rather than a
                        // placeholder that looks like an empty slot.
                        <button
                          onClick={() => handleRegenerateRow(entry.id)}
                          title="Image failed to load — click to regenerate"
                          style={{
                            width: '76px', height: '76px', borderRadius: '8px', margin: '0 auto',
                            background: '#fffbeb', border: '1px dashed #fcd34d', color: '#b45309',
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            justifyContent: 'center', gap: '3px', cursor: 'pointer', padding: 0,
                          }}
                        >
                          <AlertCircle size={18} />
                          <span style={{ fontSize: '9px', fontWeight: 700, lineHeight: 1 }}>Retry</span>
                        </button>
                      ) : (
                        <div
                          title={entry.isSchedulerPost ? 'No image' : 'The creative for this post is being generated'}
                          style={{
                            width: '76px', height: '76px', background: '#f8fafc',
                            border: '1px dashed #cbd5e1', borderRadius: '8px', display: 'flex',
                            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            gap: '3px', margin: '0 auto', color: '#94a3b8',
                          }}
                        >
                          <ImageIcon size={18} />
                          <span style={{ fontSize: '9px', fontWeight: 600, lineHeight: 1, textAlign: 'center' }}>
                            {entry.isSchedulerPost ? 'No image' : 'Generating…'}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Date (Column A) - Aligned bottom right */}
                    <td 
                      onClick={() => handleCellClick(entry, 'A')}
                      style={cellStyle(selectedCell?.rowId === entry.id && selectedCell?.colName === 'A', 'right', 'bottom')}
                    >
                      {formattedDate}
                    </td>

                    {/* Caption with hashtags (Column B) */}
                    <td 
                      onClick={() => handleCellClick(entry, 'B')}
                      style={{
                        ...cellStyle(selectedCell?.rowId === entry.id && selectedCell?.colName === 'B', 'left', 'top'),
                        whiteSpace: 'pre-wrap'
                      }}
                    >
                      {formatCaptionWithHashtags(entry)}
                    </td>

                    {/* Status (Column C) */}
                    <td 
                      onClick={() => handleCellClick(entry, 'C')}
                      style={cellStyle(selectedCell?.rowId === entry.id && selectedCell?.colName === 'C', 'left', 'bottom')}
                    >
                      {(() => {
                        const palette: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
                          posted:    { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e', label: 'Posted' },
                          scheduled: { bg: '#dbeafe', fg: '#1d4ed8', dot: '#3b82f6', label: 'Scheduled' },
                          pending:   { bg: '#fef3c7', fg: '#b45309', dot: '#f59e0b', label: 'Pending' },
                          failed:    { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444', label: 'Failed' },
                          draft:     { bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8', label: 'Draft' },
                        };
                        const tone = palette[lowercaseStatus] || {
                          bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8',
                          label: lowercaseStatus ? lowercaseStatus.charAt(0).toUpperCase() + lowercaseStatus.slice(1) : 'Draft',
                        };
                        return (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                            padding: '3px 9px', borderRadius: '999px',
                            fontSize: '11px', fontWeight: 700, letterSpacing: '0.01em',
                            background: tone.bg, color: tone.fg, whiteSpace: 'nowrap',
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot, flexShrink: 0 }} />
                            {tone.label}
                          </span>
                        );
                      })()}
                    </td>

                    {/* Actions Column (Column G) — Status-aware actions */}
                    <td 
                      style={{ borderBottom: '1px solid #cbd5e1', padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle' }}
                      className="no-print"
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                        {/* 1. Generate AI Image / Regenerate */}
                        {!entry.imageUrl && (
                          <button
                            onClick={() => handleRegenerateRow(entry.id)}
                            title="Generate AI Image"
                            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 8px', border: '1px solid #c084fc', background: '#faf5ff', color: '#7e22ce', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 700, width: '100%', justifyContent: 'center' }}
                          >
                            <Sparkles size={10} /> AI Image
                          </button>
                        )}

                        {/* 2. Approve (if PENDING) */}
                        {entry.status === 'PENDING' && (
                          <button
                            onClick={() => handleApproveRow(entry)}
                            title="Approve entry"
                            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 8px', border: '1px solid #86efac', background: '#f0fdf4', color: '#15803d', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 700, width: '100%', justifyContent: 'center' }}
                          >
                            <CheckCircle size={10} /> Approve
                          </button>
                        )}

                        {/* 3. Schedule */}
                        {entry.status !== 'POSTED' && (
                          <button
                            onClick={() => {
                              setPreviewEntry(entry);
                              setPreviewDraft({
                                bio: entry.profileBio || entry.contentDescription || '',
                                caption: entry.caption || '',
                                imageUrl: entry.imageUrl || '',
                                imageOverlayText: entry.imageOverlayText || '',
                                platform: entry.platform || 'both',
                              });
                            }}
                            title="Schedule Post"
                            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 8px', border: '1px solid #93c5fd', background: '#eff6ff', color: '#1d4ed8', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 700, width: '100%', justifyContent: 'center' }}
                          >
                            <Clock size={10} /> Schedule
                          </button>
                        )}

                        {/* 4. Instant Post (Post Now) */}
                        {entry.status !== 'POSTED' && (
                          <button
                            onClick={() => setPostModal({ entry, platform: 'both' })}
                            title="Instant Post to Meta"
                            style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 8px', border: 'none', background: '#4f46e5', color: '#ffffff', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 700, width: '100%', justifyContent: 'center' }}
                          >
                            <Send size={10} /> Instant Post
                          </button>
                        )}

                        {entry.status === 'POSTED' && (
                          <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700, padding: '2px 0' }}>✓ Posted</span>
                        )}

                        {/* 5. Action Bar: Edit, Duplicate, Regen, Delete */}
                        <div style={{ display: 'flex', gap: '2px', width: '100%', marginTop: '2px' }}>
                          <button
                            onClick={() => {
                              setEditingEntry(entry);
                              setIsEditModalOpen(true);
                            }}
                            title="Edit row"
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', borderRadius: '4px', cursor: 'pointer', fontSize: '10px' }}
                          >
                            <Edit3 size={10} />
                          </button>
                          <button
                            onClick={() => handleDuplicateRow(entry)}
                            title="Duplicate entry"
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', borderRadius: '4px', cursor: 'pointer', fontSize: '10px' }}
                          >
                            <Copy size={10} />
                          </button>
                          <button
                            onClick={() => !regenDisabled && handleRegenerateRow(entry.id)}
                            title={regenDisabled ? 'Limit reached (2/2)' : `Regenerate (${regenCount}/2)`}
                            disabled={regenDisabled}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px', border: '1px solid #cbd5e1', background: regenDisabled ? '#f1f5f9' : '#f5f3ff', color: regenDisabled ? '#94a3b8' : '#6366f1', borderRadius: '4px', cursor: regenDisabled ? 'not-allowed' : 'pointer', fontSize: '10px' }}
                          >
                            <RefreshCw size={10} />
                          </button>
                          <button
                            onClick={() => handleDeleteRow(entry.id)}
                            title="Delete entry"
                            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3px', border: '1px solid #fecaca', background: '#fef2f2', color: '#ef4444', borderRadius: '4px', cursor: 'pointer', fontSize: '10px' }}
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>

                      </div>
                    </td>

                  </tr>
                );
              })}

              {/* Spreadsheet Empty Rows padding */}
              {dataRowsCount === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '48px 24px', textAlign: 'center', background: '#ffffff', borderBottom: '1px solid #cbd5e1' }}>
                    <CalendarIcon size={30} style={{ color: '#cbd5e1', marginBottom: '12px' }} />
                    <div style={{ fontWeight: 700, color: '#334155', fontSize: '0.95rem', marginBottom: '6px' }}>
                      {isAutoGenerating
                        ? 'Building your content plan…'
                        : `No posts scheduled for ${monthYearString}`}
                    </div>
                    <p style={{ margin: '0 auto 18px', color: '#64748b', fontSize: '0.82rem', maxWidth: '400px', lineHeight: 1.6 }}>
                      {isAutoGenerating
                        ? 'Writing captions and scheduling your posts. This takes a few seconds — the images are generated right after.'
                        : calendarEntries.length > 0
                          ? 'Your content plan is scheduled in another month — use the arrows above to browse to it, or add a row here.'
                          : searchTerm || statusFilter !== 'ALL'
                            ? 'No posts match your current search or status filter.'
                            : 'Your weekly content plan will appear here once it has been generated.'}
                    </p>
                    <button
                      onClick={() => setIsAddModalOpen(true)}
                      className="btn-primary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '10px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
                    >
                      <Plus className="w-4 h-4" /> Add Row
                    </button>
                  </td>
                </tr>
              )}

              {paddingRowsArray.map((_, idx) => {
                const rowNum = dataRowsCount + idx + 2;
                return (
                  <tr key={idx} style={{ borderBottom: '1px solid #cbd5e1' }}>
                    <td style={rowHeaderStyle}>{rowNum}</td>
                    <td style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '16px' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '16px' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '16px' }}></td>
                    <td style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '16px' }}></td>
                    <td style={{ borderBottom: '1px solid #cbd5e1', padding: '16px' }} className="no-print"></td>
                  </tr>
                );
              })}

            </tbody>

          </table>
        </div>
      </div>

      {isScheduleSettingsOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 140, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#ffffff', borderRadius: '16px', width: '100%', maxWidth: '440px', padding: '24px', boxShadow: '0 25px 50px -12px rgb(0 0 0 / .3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.05rem' }}>Posting schedule</h3>
              <button onClick={() => setIsScheduleSettingsOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
            </div>
            <p style={{ margin: '0 0 18px', color: '#64748b', fontSize: '.82rem', lineHeight: 1.45 }}>Choose when upcoming calendar posts should be scheduled. Existing published posts are not changed.</p>
            <div style={{ marginBottom: '18px' }}>
              <div style={{ color: '#475569', fontWeight: 700, fontSize: '.78rem', marginBottom: '8px' }}>POSTING DAYS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                  const selected = scheduleSettings.days.includes(day);
                  return <button key={day} onClick={() => setScheduleSettings(prev => ({ ...prev, days: selected ? prev.days.filter(value => value !== day) : [...prev.days, day] }))} style={{ padding: '7px 10px', borderRadius: '8px', border: selected ? '1px solid #4f46e5' : '1px solid #cbd5e1', background: selected ? '#e0e7ff' : '#fff', color: selected ? '#3730a3' : '#475569', cursor: 'pointer', fontSize: '.74rem', fontWeight: 700 }}>{day.slice(0, 3)}</button>;
                })}
              </div>
            </div>
            <label style={{ display: 'block', color: '#475569', fontWeight: 700, fontSize: '.78rem', marginBottom: '20px' }}>POSTING TIME
              <input type="time" value={scheduleSettings.time} onChange={event => setScheduleSettings(prev => ({ ...prev, time: event.target.value }))} style={{ display: 'block', marginTop: '8px', width: '100%', boxSizing: 'border-box', padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setIsScheduleSettingsOpen(false)} style={{ padding: '9px 16px', border: 'none', borderRadius: '8px', background: '#f1f5f9', color: '#475569', cursor: 'pointer', fontWeight: 700 }}>Cancel</button>
              <button onClick={handleApplyScheduleSettings} style={{ padding: '9px 16px', border: 'none', borderRadius: '8px', background: '#4f46e5', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>Save schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* POST CONFIRMATION MODAL */}
      {postModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '16px', maxWidth: '400px', width: '100%', padding: '28px', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', margin: '0 0 4px 0' }}>🚀 Post to Social Media</h3>
                <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>Publish this post immediately via Meta.</p>
              </div>
              <button onClick={() => setPostModal(null)} style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            </div>

            {/* Post preview */}
            {postModal.entry.imageUrl && (
              <div style={{ marginBottom: '16px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <img src={postModal.entry.imageUrl} alt="Post preview" style={{ width: '100%', height: '140px', objectFit: 'cover', display: 'block' }} />
              </div>
            )}
            {postModal.entry.caption && (
              <p style={{ fontSize: '0.78rem', color: '#334155', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', marginBottom: '16px', lineHeight: 1.5 }}>
                {postModal.entry.caption.substring(0, 120)}{postModal.entry.caption.length > 120 ? '…' : ''}
              </p>
            )}

            {/* Platform selection */}
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>Select Platform:</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['both', 'facebook', 'instagram'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPostModal(prev => prev ? { ...prev, platform: p } : null)}
                    style={{
                      flex: 1, padding: '8px 4px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                      border: postModal.platform === p ? '2px solid #4f46e5' : '1px solid #cbd5e1',
                      background: postModal.platform === p ? '#e0e7ff' : '#f8fafc',
                      color: postModal.platform === p ? '#3730a3' : '#475569'
                    }}
                  >
                    {p === 'both' ? 'FB + IG' : p === 'facebook' ? 'Facebook' : 'Instagram'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setPostModal(null)} style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none', borderRadius: '8px', color: '#475569', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                Cancel
              </button>
              <button
                onClick={handlePostNow}
                disabled={isPosting}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 20px', background: isPosting ? '#a5b4fc' : '#4f46e5', border: 'none', borderRadius: '8px', color: '#ffffff', cursor: isPosting ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.82rem' }}
              >
                <Send size={14} />
                {isPosting ? 'Posting…' : 'Publish Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {isEditModalOpen && editingEntry && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '16px', maxWidth: '500px', width: '100%', padding: '24px', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Modify Spreadsheet Row</h3>
              <button 
                onClick={() => { setIsEditModalOpen(false); setEditingEntry(null); }}
                style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#94a3b8' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateEntrySubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.8rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Post Type</label>
                  <select
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', outline: 'none' }}
                    value={editingEntry.postType}
                    onChange={(e) => setEditingEntry({ ...editingEntry, postType: e.target.value })}
                  >
                    <option value="Graphic">Graphic</option>
                    <option value="Reel">Reel</option>
                    <option value="Carousel">Carousel</option>
                    <option value="Story">Story</option>
                    <option value="Video">Video</option>
                    <option value="Blog">Blog</option>
                    <option value="Poll">Poll</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Status</label>
                  <select
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', outline: 'none' }}
                    value={editingEntry.status}
                    onChange={(e) => setEditingEntry({ ...editingEntry, status: e.target.value })}
                  >
                    <option value="PENDING">Pending</option>
                    <option value="SCHEDULED">Scheduled</option>
                    <option value="POSTED">Posted</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Publish To</label>
                  <select
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', outline: 'none' }}
                    value={newEntryForm.platform}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, platform: e.target.value })}
                  >
                    <option value="both">Facebook + Instagram</option>
                    <option value="facebook">Facebook only</option>
                    <option value="instagram">Instagram only</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Content Idea</label>
                <input
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none' }}
                  value={editingEntry.contentIdea}
                  onChange={(e) => setEditingEntry({ ...editingEntry, contentIdea: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Short Description</label>
                <input
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none' }}
                  value={editingEntry.contentDescription}
                  onChange={(e) => setEditingEntry({ ...editingEntry, contentDescription: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Caption</label>
                <textarea
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none', resize: 'vertical' }}
                  rows={4}
                  value={editingEntry.caption}
                  onChange={(e) => setEditingEntry({ ...editingEntry, caption: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Hashtags (comma separated)</label>
                <input
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none' }}
                  placeholder="e.g. discount, summer, branding"
                  value={editingEntry.hashtags}
                  onChange={(e) => setEditingEntry({ ...editingEntry, hashtags: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'end', gap: '8px', marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => { setIsEditModalOpen(false); setEditingEntry(null); }}
                  style={{ padding: '8px 16px', background: '#f1f5f9', border: 'none', borderRadius: '8px', color: '#475569', cursor: 'pointer', fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 20px', background: '#4f46e5', border: 'none', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
                >
                  Save Changes
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ADD CUSTOM ROW MODAL */}
      {isAddModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '16px', maxWidth: '500px', width: '100%', padding: '24px', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Add Custom Post Row</h3>
              <button 
                onClick={() => setIsAddModalOpen(false)}
                style={{ border: 'none', background: 'transparent', fontSize: '1.2rem', cursor: 'pointer', color: '#94a3b8' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddCustomEntry} style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.8rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Day Name</label>
                  <select
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', outline: 'none' }}
                    value={newEntryForm.dayName}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, dayName: e.target.value })}
                  >
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                    <option value="Sunday">Sunday</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Post Type</label>
                  <select
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', outline: 'none' }}
                    value={newEntryForm.postType}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, postType: e.target.value })}
                  >
                    <option value="Graphic">Graphic</option>
                    <option value="Reel">Reel</option>
                    <option value="Carousel">Carousel</option>
                    <option value="Story">Story</option>
                    <option value="Video">Video</option>
                    <option value="Blog">Blog</option>
                    <option value="Poll">Poll</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Publish To</label>
                <select
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', outline: 'none' }}
                  value={newEntryForm.platform}
                  onChange={(e) => setNewEntryForm({ ...newEntryForm, platform: e.target.value })}
                >
                  <option value="both">Facebook + Instagram</option>
                  <option value="facebook">Facebook only</option>
                  <option value="instagram">Instagram only</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Scheduled Date</label>
                  <input
                    type="date"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none' }}
                    value={newEntryForm.scheduledDate}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, scheduledDate: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Scheduled Time</label>
                  <input
                    type="time"
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none' }}
                    value={newEntryForm.scheduledTime}
                    onChange={(e) => setNewEntryForm({ ...newEntryForm, scheduledTime: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Content Idea</label>
                <input
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none' }}
                  placeholder="e.g. Exclusive Weekend Product Launch Discount"
                  value={newEntryForm.contentIdea}
                  onChange={(e) => setNewEntryForm({ ...newEntryForm, contentIdea: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Short Description</label>
                <input
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none' }}
                  placeholder="e.g. Promote the weekend sale with creative visual assets."
                  value={newEntryForm.contentDescription}
                  onChange={(e) => setNewEntryForm({ ...newEntryForm, contentDescription: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Caption</label>
                <textarea
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none', resize: 'vertical' }}
                  rows={3}
                  placeholder="Engaging caption for the post"
                  value={newEntryForm.caption}
                  onChange={(e) => setNewEntryForm({ ...newEntryForm, caption: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Hashtags (comma separated)</label>
                <input
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#ffffff', outline: 'none' }}
                  placeholder="e.g. discount, summer, shopping"
                  value={newEntryForm.hashtagsStr}
                  onChange={(e) => setNewEntryForm({ ...newEntryForm, hashtagsStr: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'end', gap: '8px', marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{ padding: '8px 16px', background: '#f1f5f9', border: 'none', borderRadius: '8px', color: '#475569', cursor: 'pointer', fontWeight: 600 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 20px', background: '#4f46e5', border: 'none', borderRadius: '8px', color: '#ffffff', cursor: 'pointer', fontWeight: 600 }}
                >
                  Add Entry
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {previewEntry && (
        <div onClick={() => setPreviewEntry(null)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(15, 23, 42, 0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', cursor: 'pointer' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(1080px, 100%)', maxHeight: '94vh', overflowY: 'auto', background: '#ffffff', borderRadius: '18px', padding: '24px', boxShadow: '0 25px 60px rgba(15,23,42,.35)', cursor: 'default' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.15rem' }}>Review post before scheduling</h3>
                <p style={{ margin: '5px 0 0', color: '#64748b', fontSize: '0.78rem' }}>Edit the profile bio, post copy, image, and text shown on the image.</p>
              </div>
              <button type="button" onClick={() => setPreviewEntry(null)} style={{ border: 'none', background: '#f1f5f9', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer' }}><X size={16} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: '24px', alignItems: 'start' }}>
              <div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <button type="button" onClick={() => setPreviewDraft(prev => ({ ...prev, platform: 'facebook' }))} style={{ flex: 1, padding: '8px 4px', borderRadius: '8px', border: previewDraft.platform === 'facebook' ? '2px solid #1877f2' : '1px solid #cbd5e1', background: previewDraft.platform === 'facebook' ? '#eff6ff' : '#fff', color: '#1e293b', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>Facebook</button>
                  <button type="button" onClick={() => setPreviewDraft(prev => ({ ...prev, platform: 'instagram' }))} style={{ flex: 1, padding: '8px 4px', borderRadius: '8px', border: previewDraft.platform === 'instagram' ? '2px solid #d946ef' : '1px solid #cbd5e1', background: previewDraft.platform === 'instagram' ? '#fdf4ff' : '#fff', color: '#1e293b', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>Instagram</button>
                  <button type="button" onClick={() => setPreviewDraft(prev => ({ ...prev, platform: 'both' }))} style={{ flex: 1, padding: '8px 4px', borderRadius: '8px', border: previewDraft.platform === 'both' ? '2px solid #4f46e5' : '1px solid #cbd5e1', background: previewDraft.platform === 'both' ? '#eeef4f' : '#fff', color: '#1e293b', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>Both (FB & IG)</button>
                </div>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', overflow: 'hidden', background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '12px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: previewDraft.platform === 'facebook' ? '#1877f2' : previewDraft.platform === 'instagram' ? 'linear-gradient(135deg,#f97316,#d946ef)' : 'linear-gradient(135deg,#1877f2,#d946ef)',
                      color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800
                    }}>
                      {previewDraft.platform === 'both' ? 'FB+IG' : 'H'}
                    </div>
                    <div><strong style={{ display: 'block', fontSize: '0.8rem' }}>helloworld</strong><span style={{ color: '#64748b', fontSize: '0.68rem' }}>{previewDraft.bio || 'Your profile bio'} ({previewDraft.platform.toUpperCase()})</span></div>
                  </div>
                  <div style={{ position: 'relative', aspectRatio: '1', background: '#e2e8f0' }}>
                    <img src={previewDraft.imageUrl} alt="Social post preview" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    {previewDraft.imageOverlayText && <div style={{ position: 'absolute', left: '8%', right: '8%', bottom: '9%', padding: '12px 10px', borderRadius: '8px', background: 'rgba(15,23,42,.72)', color: '#fff', textAlign: 'center', fontWeight: 800, fontSize: 'clamp(.75rem, 2vw, 1.1rem)' }}>{previewDraft.imageOverlayText}</div>}
                  </div>
                  <div style={{ padding: '12px', fontSize: '0.78rem', color: '#334155', lineHeight: 1.45 }}><strong>helloworld</strong> {previewDraft.caption}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Profile bio
                  <input value={previewDraft.bio} onChange={e => setPreviewDraft(prev => ({ ...prev, bio: e.target.value }))} style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }} placeholder="Short profile bio shown in the preview" />
                </label>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Post caption
                  <textarea value={previewDraft.caption} onChange={e => setPreviewDraft(prev => ({ ...prev, caption: e.target.value }))} rows={6} style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, resize: 'vertical' }} />
                </label>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Text embedded in image
                  <input value={previewDraft.imageOverlayText} onChange={e => setPreviewDraft(prev => ({ ...prev, imageOverlayText: e.target.value }))} style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }} placeholder="Headline shown over the image" />
                </label>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Public image URL
                  <input value={previewDraft.imageUrl.startsWith('data:') ? '' : previewDraft.imageUrl} onChange={e => setPreviewDraft(prev => ({ ...prev, imageUrl: e.target.value }))} style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8 }} placeholder="https://..." />
                </label>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569' }}>Choose local image for preview
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePreviewImageUpload} style={{ display: 'block', marginTop: 7 }} />
                </label>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.72rem' }}>The overlay is shown in the preview. Meta must receive a public image URL, so replace a local preview image with its hosted URL before scheduling.</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 4 }}>
                  <button type="button" onClick={() => setPreviewEntry(null)} style={{ padding: '10px 16px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, cursor: 'pointer' }}>Back</button>
                  <button type="button" onClick={handleConfirmSchedule} style={{ padding: '10px 18px', border: 'none', background: '#4f46e5', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Approve & schedule</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
