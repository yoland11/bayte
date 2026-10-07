import { useEffect, useMemo, useState, useLayoutEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  ArrowDownLeft, ArrowUpLeft, ArchiveRestore, BarChart3, CalendarDays, Check, ChevronDown, CirclePlus, Download,
  FileDown, FileSpreadsheet, Filter, HardHat, Home, ImagePlus, Menu, MoreHorizontal, Pencil,
  Plus, Search, Settings, Trash2, TrendingDown, TrendingUp, Wallet, X, ReceiptText, Users, FileText, ArrowUp, ArrowDown, Upload
} from 'lucide-react';
import { createLocalBackup } from './lib/db';
import { decodeBackup, encodeBackup } from './lib/backup';
import { verifyAppPin } from './lib/appPin';
import { deleteCloudClient, deleteCloudLogo, deleteCloudOption, deleteCloudTransaction, getCloudAttachment, importLocalBackup, loadCloudWorkspace, loadFontPreferences, permanentlyDeleteCloudTransaction, restoreCloudTransaction, saveCloudClient, saveCloudOption, saveCloudProjectSettings, saveFontPreferences, saveCloudTransaction, uploadCloudLogo } from './lib/cloudData';
import { requireSupabase, supabase, supabaseConfigured } from './lib/supabase';
import { formatAmount, formatCurrency, normalizeDigits, parseAmount, summarizeTransactions, sumAmounts } from './lib/money';
import { DEFAULT_FONT_PREFERENCES, FONT_OPTIONS, FONT_PREFERENCES_STORAGE_KEY, fontFamilyFor, parseFontPreferences, type FontPreferences, type FontStyleId } from './lib/fonts';
import { buildPdfReportHtml } from './lib/pdfReport';
import { filterAndSortTransactions, getPeriodBounds, type Period, type TransactionFilters } from './lib/transactions';
import type { Client, NamedOption, Transaction, TransactionType } from './lib/types';
import { arrangeDashboardCards, summarizeClientStatement, type DashboardCard } from './lib/workspaceFeatures';

const navItems = [
  { id: 'home', label: 'الرئيسية', icon: Home },
  { id: 'transactions', label: 'العمليات', icon: ReceiptText },
  { id: 'statement', label: 'كشف حساب', icon: FileText },
  { id: 'trash', label: 'المهملات', icon: ArchiveRestore },
  { id: 'reports', label: 'التقارير', icon: BarChart3 },
  { id: 'settings', label: 'الإعدادات', icon: Settings }
] as const;
type Page = typeof navItems[number]['id'];

const dateFormatter = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const compactDate = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
const todayISO = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};
const formatDate = (date: string) => date ? dateFormatter.format(new Date(`${date}T12:00:00`)) : '—';

function AmountInput({ value, onChange, id = 'amount', onInputRef, invalid = false, describedBy }: { value: string; onChange: (value: string) => void; id?: string; invalid?: boolean; describedBy?: string; onInputRef?: (element: HTMLInputElement | null) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  const caretDigitIndex = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretDigitIndex.current === null || !input.current) return;
    const targetDigits = caretDigitIndex.current;
    const text = input.current.value;
    let seen = 0;
    let index = 0;
    for (; index < text.length; index++) {
      if (/\d/.test(normalizeDigits(text[index]))) seen++;
      if (seen >= targetDigits) { index++; break; }
    }
    input.current.setSelectionRange(index, index);
    caretDigitIndex.current = null;
  }, [value]);
  return <input
    ref={(element) => { input.current = element; onInputRef?.(element); }} id={id} className="amount-input" inputMode="decimal" autoComplete="off" dir="ltr" required aria-invalid={invalid} aria-describedby={describedBy}
    value={value} placeholder="0" aria-label="المبلغ بالدينار العراقي"
    onChange={(event) => {
      const target = event.currentTarget;
      const caret = target.selectionStart ?? target.value.length;
      caretDigitIndex.current = normalizeDigits(target.value.slice(0, caret)).replace(/\D/g, '').length;
      const normalized = normalizeDigits(target.value).replace(/[,٬\s]/g, '').replace(/٫/g, '.').replace(/[^\d.]/g, '');
      const [integer = '', ...rest] = normalized.split('.');
      const decimals = rest.join('').slice(0, 2);
      const grouped = integer ? Number(integer).toLocaleString('ar-IQ-u-nu-latn', { maximumFractionDigits: 0, useGrouping: true }) : '';
      const formatted = normalized.includes('.') ? `${grouped}.${decimals}` : grouped;
      onChange(formatted);
    }}
  />;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const activeUserId = useRef<string | null>(null);
  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    void supabase.auth.getSession().then(({ data }) => { const nextUser = data.session?.user ?? null; activeUserId.current = nextUser?.id ?? null; setUser(nextUser); setPinUnlocked(false); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      if (activeUserId.current !== (nextUser?.id ?? null)) setPinUnlocked(false);
      activeUserId.current = nextUser?.id ?? null;
      setUser(nextUser);
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  if (!authReady) return <GateShell><p>جارٍ التحقق من الجلسة…</p></GateShell>;
  if (!supabaseConfigured) return <SetupGate />;
  if (!user) return <LoginGate />;
  if (!pinUnlocked) return <PinGate onUnlock={() => setPinUnlocked(true)} onSignOut={() => void requireSupabase().auth.signOut()} />;
  return <TrackerApp user={user} />;
}

function TrackerApp({ user }: { user: User }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [trashedTransactions, setTrashedTransactions] = useState<Transaction[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [categories, setCategories] = useState<NamedOption[]>([]);
  const [stages, setStages] = useState<NamedOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectName, setProjectName] = useState('بيتي');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [dashboardOrder, setDashboardOrder] = useState<DashboardCard[]>(['balance', 'income', 'expense']);
  const [dashboardSize, setDashboardSize] = useState<'compact' | 'normal' | 'large'>('normal');
  const [dataLoading, setDataLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dataError, setDataError] = useState('');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const refreshCloudData = async () => {
    setDataLoading(true); setDataError('');
    try {
      const data = await loadCloudWorkspace(user);
      setProjectId(data.projectId); setTransactions(data.transactions); setTrashedTransactions(data.trashedTransactions); setClients(data.clients); setCategories(data.categories); setStages(data.stages);
      setProjectName(data.projectName); setLogoUrl(data.logoUrl); setDashboardOrder(arrangeDashboardCards(data.dashboardOrder, ['balance', 'income', 'expense'])); setDashboardSize(data.dashboardSize);
    } catch (error) {
      console.error(error); setDataError('تعذر تحميل بيانات الحساب. تحقق من الاتصال وإعداد قاعدة البيانات ثم أعد المحاولة.');
    } finally { setDataLoading(false); setDataLoaded(true); }
  };
  useEffect(() => { void refreshCloudData(); }, [user.id]);
  useEffect(() => {
    const update = () => { setIsOnline(navigator.onLine); if (navigator.onLine) void refreshCloudData(); };
    window.addEventListener('online', update); window.addEventListener('offline', update); window.addEventListener('focus', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('focus', update); };
  }, [user.id]);
  const [page, setPage] = useState<Page>('home');
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit' | 'detail'; record?: Transaction; type?: TransactionType } | null>(null);
  const [toast, setToast] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [filters, setFilters] = useState<TransactionFilters>(() => ({ query: '', type: 'all', sort: 'newest', ...getPeriodBounds('month') }));
  const [period, setPeriod] = useState<Period>('month');
  const [reportType, setReportType] = useState<TransactionFilters['type']>('all');
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);
  const [exportError, setExportError] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [fontPreferences, setFontPreferences] = useState<FontPreferences>(() => {
    try { return parseFontPreferences(window.localStorage.getItem(FONT_PREFERENCES_STORAGE_KEY)); }
    catch { return DEFAULT_FONT_PREFERENCES; }
  });

  useEffect(() => {
    let active = true;
    void loadFontPreferences(user.id).then((saved) => {
      if (active && saved) setFontPreferences(parseFontPreferences(JSON.stringify(saved)));
    }).catch((error) => console.error(error));
    return () => { active = false; };
  }, [user.id]);

  function changeFontPreference(role: keyof FontPreferences, font: FontStyleId) {
    const next = { ...fontPreferences, [role]: font };
    setFontPreferences(next);
    try { window.localStorage.setItem(FONT_PREFERENCES_STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the live selection for this session if storage is unavailable. */ }
    void saveFontPreferences(user.id, next).catch((error) => { console.error(error); setToast('تعذر حفظ إعداد الخط في الحساب السحابي.'); });
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);
  const byId = useMemo(() => new Map(categories.map((item) => [item.id, normalizeDigits(item.name)])), [categories]);
  const stageById = useMemo(() => new Map(stages.map((item) => [item.id, normalizeDigits(item.name)])), [stages]);
  const clientById = useMemo(() => new Map(clients.map((item) => [item.id, normalizeDigits(item.name)])), [clients]);
  const visibleTransactions = useMemo(() => filterAndSortTransactions(transactions, filters), [transactions, filters]);
  const reportBounds = useMemo(() => getPeriodBounds(period, new Date(), periodFrom, periodTo), [period, periodFrom, periodTo]);
  const reportTransactions = useMemo(() => filterAndSortTransactions(transactions, { query: '', type: reportType, ...reportBounds, sort: 'newest' }), [transactions, reportBounds, reportType]);
  const recentTransactions = transactions.slice(0, 5);

  const showCreate = (type?: TransactionType) => setDialog({ mode: 'create', type });
  const onSaved = (message: string) => { setDialog(null); setToast(message); void refreshCloudData(); };
  const changePage = (id: Page) => { setPage(id); setMobileMenu(false); };

  async function exportFile(kind: 'pdf' | 'excel', records: Transaction[], label: string, sums = summarizeTransactions(records)) {
    if (exporting) return;
    setExporting(kind); setExportError('');
    try {
      const fileDate = todayISO();
      if (kind === 'excel') {
        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'بيتي';
        workbook.created = new Date();
        const summarySheet = workbook.addWorksheet('ملخص', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });
        summarySheet.columns = [{ width: 24 }, { width: 34 }];
        summarySheet.addRows([
          ['بيتي', 'تقرير مالي'], ['تاريخ التصدير', fileDate], ['الفترة', label],
          ['إجمالي القبض', sums.income], ['إجمالي الصرف', sums.expenses], ['الرصيد الحالي', sums.balance]
        ]);
        for (const row of [1, 4, 5, 6]) {
          summarySheet.getRow(row).font = { name: 'Arial', size: row === 1 ? 14 : 11, bold: row === 1 || row >= 4, color: { argb: row >= 4 ? 'FF20374E' : 'FF53697E' } };
          summarySheet.getRow(row).height = row === 1 ? 27 : 22;
        }
        for (const row of [4, 5, 6]) summarySheet.getCell(`B${row}`).numFmt = '[$-409]#,##0.## "د.ع"';
        summarySheet.eachRow((row) => row.eachCell((cell) => { cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true }; }));

        const transactionsSheet = workbook.addWorksheet('العمليات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
        transactionsSheet.columns = [
          { header: 'النوع', key: 'type', width: 12 }, { header: 'البيان', key: 'description', width: 34 },
          { header: 'المبلغ', key: 'amount', width: 19 }, { header: 'التاريخ', key: 'date', width: 16 },
          { header: 'التصنيف', key: 'category', width: 20 }, { header: 'المرحلة', key: 'stage', width: 22 },
          { header: 'العميل', key: 'client', width: 20 }, { header: 'المورد / الشخص', key: 'person', width: 24 }, { header: 'الملاحظات', key: 'notes', width: 34 }
        ];
        transactionsSheet.addRows(records.map((row) => ({
          type: row.type === 'income' ? 'قبض' : 'صرف', description: normalizeDigits(row.description), amount: row.amount,
          date: new Date(`${row.date}T12:00:00`), category: normalizeDigits(byId.get(row.categoryId ?? '') ?? ''), stage: normalizeDigits(stageById.get(row.stageId ?? '') ?? ''), client: normalizeDigits(clientById.get(row.clientId ?? '') ?? ''), person: normalizeDigits(row.person ?? ''), notes: normalizeDigits(row.notes ?? '')
        })));
        transactionsSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(records.length + 1, 1), column: 9 } };
        transactionsSheet.getRow(1).height = 25;
        transactionsSheet.getRow(1).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF334E67' } };
        transactionsSheet.eachRow((row) => {
          row.eachCell((cell, columnNumber) => {
            cell.alignment = { vertical: 'top', horizontal: columnNumber === 3 ? 'left' : 'right', wrapText: true };
            if (columnNumber === 3 && row.number > 1) cell.numFmt = '[$-409]#,##0.## "د.ع"';
            if (columnNumber === 4 && row.number > 1) cell.numFmt = '[$-409]yyyy-mm-dd';
            if (row.number > 1) cell.font = { name: 'Arial', size: 10, color: { argb: 'FF354D63' } };
          });
          if (row.number > 1) {
            const widths = [12, 34, 19, 16, 20, 22, 20, 24, 34];
            const rowValues = row.values as (string | number | undefined)[];
            const requiredLines = rowValues.slice(1).reduce<number>((maxLines, value, index) => {
              const lines = String(value ?? '').split('\n').reduce<number>((sumLines, part) => sumLines + Math.max(1, Math.ceil(part.length / Math.max(widths[index] * 0.85, 8))), 0);
              return Math.max(maxLines, lines);
            }, 1);
            row.height = Math.min(380, Math.max(27, requiredLines * 16 + 9));
          }
        });

        const categorySheet = workbook.addWorksheet('التصنيفات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
        categorySheet.columns = [{ header: 'التصنيف', key: 'name', width: 28 }, { header: 'إجمالي الصرف', key: 'total', width: 23 }];
        categorySheet.addRows([
          ...categories.map((category) => ({ name: normalizeDigits(category.name), total: sumAmounts(records.filter((row) => row.type === 'expense' && row.categoryId === category.id).map((row) => row.amount)) })),
          { name: 'غير مصنف', total: sumAmounts(records.filter((row) => row.type === 'expense' && !row.categoryId).map((row) => row.amount)) }
        ]);
        const stageSheet = workbook.addWorksheet('المراحل', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
        stageSheet.columns = [{ header: 'المرحلة', key: 'name', width: 28 }, { header: 'إجمالي الصرف', key: 'total', width: 23 }];
        stageSheet.addRows([
          ...stages.map((stage) => ({ name: normalizeDigits(stage.name), total: sumAmounts(records.filter((row) => row.type === 'expense' && row.stageId === stage.id).map((row) => row.amount)) })),
          { name: 'غير محددة', total: sumAmounts(records.filter((row) => row.type === 'expense' && !row.stageId).map((row) => row.amount)) }
        ]);
        for (const sheet of [categorySheet, stageSheet]) {
          sheet.getRow(1).height = 25;
          sheet.getRow(1).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF334E67' } };
          sheet.eachRow((row) => row.eachCell((cell, columnNumber) => {
            cell.alignment = { vertical: 'middle', horizontal: columnNumber === 2 ? 'left' : 'right', wrapText: true };
            if (columnNumber === 2 && row.number > 1) cell.numFmt = '[$-409]#,##0.## "د.ع"';
          }));
        }
        const buffer = await workbook.xlsx.writeBuffer();
        const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a'); link.href = url; link.download = `بيتي-تقرير-مالي-${fileDate}.xlsx`; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const pdfHost = document.createElement('div');
        pdfHost.className = 'pdf-export-host';
        pdfHost.dir = 'rtl';
        pdfHost.style.setProperty('--font-primary', fontFamilyFor(fontPreferences.primary));
        pdfHost.style.setProperty('--font-secondary', fontFamilyFor(fontPreferences.secondary));
        pdfHost.innerHTML = buildPdfReportHtml({
          fileDate,
          period: label,
          sums,
          expenseByCategory: [
            ...categories.map((option) => ({ name: normalizeDigits(option.name), amount: sumAmounts(records.filter((row) => row.type === 'expense' && row.categoryId === option.id).map((row) => row.amount)) })),
            { name: 'غير مصنف', amount: sumAmounts(records.filter((row) => row.type === 'expense' && !row.categoryId).map((row) => row.amount)) }
          ].filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount),
          expenseByStage: [
            ...stages.map((option) => ({ name: normalizeDigits(option.name), amount: sumAmounts(records.filter((row) => row.type === 'expense' && row.stageId === option.id).map((row) => row.amount)) })),
            { name: 'غير محددة', amount: sumAmounts(records.filter((row) => row.type === 'expense' && !row.stageId).map((row) => row.amount)) }
          ].filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount),
          records: records.map((row) => ({
            type: row.type,
            description: normalizeDigits(row.description),
            amount: row.amount,
            date: formatDate(row.date),
            category: normalizeDigits(byId.get(row.categoryId ?? '') ?? '—'),
            stage: normalizeDigits(stageById.get(row.stageId ?? '') ?? '—'),
            person: normalizeDigits([clientById.get(row.clientId ?? ''), row.person].filter(Boolean).join(' · ') || '—')
          }))
        });
        document.body.appendChild(pdfHost);
        const module = await import('html2pdf.js');
        const html2pdf = module.default as any;
        await html2pdf().set({
          margin: [10, 7, 12, 7], filename: `بيتي-تقرير-مالي-${fileDate}.pdf`, image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollY: 0 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.pdf-summary', '.pdf-table-heading'] }
        }).from(pdfHost.firstElementChild as HTMLElement).save();
        pdfHost.remove();
      }
      setToast(kind === 'pdf' ? 'تم إنشاء التقرير بصيغة PDF' : 'تم إنشاء جدول البيانات');
    } catch (error) {
      console.error(error);
      setExportError(kind === 'pdf' ? 'تعذر إنشاء التقرير بصيغة PDF، حاول مرة أخرى.' : 'تعذر إنشاء جدول البيانات، حاول مرة أخرى.');
    } finally { setExporting(null); }
  }

  const reportLabel = period === 'custom' ? `${periodFrom || '—'} — ${periodTo || '—'}` : ({ today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر', year: 'هذه السنة', all: 'كل الفترات', custom: 'نطاق مخصص' } as const)[period];
  const transactionExportLabel = [period === 'all' ? 'كل الفترات' : reportLabel, filters.type === 'all' ? '' : `النوع: ${filters.type === 'income' ? 'قبض' : 'صرف'}`, filters.categoryId ? `التصنيف: ${byId.get(filters.categoryId) ?? ''}` : '', filters.stageId ? `المرحلة: ${stageById.get(filters.stageId) ?? ''}` : '', filters.query ? `بحث: ${filters.query}` : ''].filter(Boolean).join(' · ');
  const pageTitle = navItems.find((item) => item.id === page)?.label ?? 'الرئيسية';

  if (!dataLoaded && dataLoading) return <GateShell><p>جارٍ تحميل بيانات الحساب…</p></GateShell>;
  if (dataError) return <GateShell><h1>تعذر الاتصال</h1><p>{dataError}</p><button className="primary-button" onClick={() => void refreshCloudData()}>إعادة المحاولة</button><button className="text-button" onClick={() => void requireSupabase().auth.signOut()}>تسجيل الخروج</button></GateShell>;
  return <div className="app-shell" style={{ '--font-primary': fontFamilyFor(fontPreferences.primary), '--font-secondary': fontFamilyFor(fontPreferences.secondary) } as React.CSSProperties}>
    <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">{logoUrl ? <img src={logoUrl} alt="" /> : <HardHat size={23} />}</span><span><b>{normalizeDigits(projectName)}</b><small>متابعة بناء البيت</small></span></div>
      <div className="house-chip"><span className="house-dot" />مشروع البيت الوحيد</div>
      <nav aria-label="القائمة الرئيسية">
        <span className="nav-caption">القائمة</span>
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => changePage(id)} aria-current={page === id ? 'page' : undefined}><Icon size={19} /><span>{label}</span>{id === 'transactions' && transactions.length > 0 && <small>{formatAmount(transactions.length)}</small>}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span><Wallet size={17} /></span><div><b>كل حسابات بيتك</b><small>في مكان واحد</small></div></div><small className="version">{normalizeDigits(projectName)} · الحساب السحابي</small></div>
    </aside>

    <main id="main-content" className="main-area">
      <header className="topbar"><div className="topbar-heading"><button className="mobile-menu icon-button" aria-label="فتح القائمة" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20} /></button><div className="breadcrumbs"><span>{normalizeDigits(projectName)}</span><span className="crumb-separator">/</span><strong>{pageTitle}</strong></div></div><div className="topbar-actions"><span className={`today-chip ${isOnline ? 'online-chip' : 'offline-chip'}`}>{isOnline ? 'متصل · محفوظ سحابياً' : 'غير متصل'}</span><span className="today-chip"><CalendarDays size={15} />{dateFormatter.format(new Date())}</span><button className="primary-button top-add" onClick={() => showCreate()}><Plus size={17} /> إضافة عملية</button></div></header>
      {!isOnline && <div className="offline-banner" role="status">لا يوجد اتصال بالإنترنت. البيانات المعروضة قد لا تشمل آخر التغييرات، وسيظهر خطأ واضح عند تعذر الحفظ.</div>}
      {mobileMenu && <div className="mobile-menu-panel"><div className="mobile-menu-head"><b>بيتي</b><button className="icon-button" onClick={() => setMobileMenu(false)} aria-label="إغلاق القائمة"><X size={18} /></button></div>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => changePage(id)}><Icon size={18} /><span>{label}</span></button>)}</div>}

      {page === 'home' && <section className="page-content dashboard-page">
        <div className="page-heading"><div><p className="eyebrow">متابعة بناء البيت</p><h1>الرئيسية</h1><p className="page-subtitle">نظرة سريعة على حركة أموال بيتك</p></div><button className="secondary-button desktop-export" onClick={() => exportFile('excel', transactions, 'كل الفترات')}><Download size={17} />تصدير البيانات</button></div>
        <section className={`summary-grid card-size-${dashboardSize}`} aria-label="ملخص الحسابات">
          {arrangeDashboardCards(dashboardOrder, ['balance', 'income', 'expense']).map((card) => card === 'balance' ?
            <article className="balance-card" key={card}><div className="balance-top"><div className="balance-label"><span className="balance-icon"><Wallet size={20} /></span><span>الرصيد الحالي</span></div><span className="balance-period">من بداية البناء</span></div><strong className="balance-value" dir="ltr"><bdi>{formatAmount(summary.balance)}</bdi><small>د.ع</small></strong><div className="balance-bottom"><span>إجمالي القبض ناقص إجمالي الصرف</span><span className="balance-mark"><Check size={15} />محدّث</span></div></article> : card === 'income' ?
            <article className="metric-card income-card" key={card}><div className="metric-top"><span className="metric-icon"><TrendingUp size={19} /></span><span className="metric-arrow"><ArrowDownLeft size={15} /></span></div><span className="metric-label">إجمالي القبض</span><strong className="metric-value" dir="ltr"><bdi>{formatAmount(summary.income)}</bdi><small>د.ع</small></strong><span className="metric-foot">مجموع المبالغ المستلمة</span></article> :
            <article className="metric-card expense-card" key={card}><div className="metric-top"><span className="metric-icon"><TrendingDown size={19} /></span><span className="metric-arrow"><ArrowUpLeft size={15} /></span></div><span className="metric-label">إجمالي الصرف</span><strong className="metric-value" dir="ltr"><bdi>{formatAmount(summary.expenses)}</bdi><small>د.ع</small></strong><span className="metric-foot">مجموع مصاريف البناء</span></article>)}
        </section>
        <section className="content-card recent-card"><div className="section-header"><div><h2>آخر العمليات</h2><p>أحدث حركة مالية مسجلة</p></div><button className="text-button" onClick={() => changePage('transactions')}>عرض كل العمليات <ArrowDownLeft size={16} /></button></div>
          {recentTransactions.length === 0 ? <EmptyState onAdd={() => showCreate()} /> : <TransactionTable records={recentTransactions} categories={byId} stages={stageById} onDetails={(record) => setDialog({ mode: 'detail', record })} />}
        </section>
        <section className="quick-actions"><div><span className="quick-icon"><CirclePlus size={19} /></span><div><b>إضافة عملية جديدة</b><small>سجّل المبلغ المستلم أو المصروف</small></div></div><div className="quick-buttons"><button className="expense-quick" onClick={() => showCreate('expense')}><ArrowUpLeft size={16} />إضافة صرف</button><button className="income-quick" onClick={() => showCreate('income')}><ArrowDownLeft size={16} />إضافة قبض</button></div></section>
      </section>}

      {page === 'transactions' && <section className="page-content">
        <div className="page-heading"><div><p className="eyebrow">السجل المالي</p><h1>العمليات</h1><p className="page-subtitle">تابع وعدّل جميع عمليات القبض والصرف</p></div><button className="primary-button" onClick={() => showCreate()}><Plus size={17} />إضافة عملية</button></div>
        <section className="content-card transactions-card"><div className="toolbar"><label className="search-field"><Search size={17} /><input value={filters.query} onChange={(e) => setFilters({ ...filters, query: normalizeDigits(e.target.value) })} placeholder="بحث بالبيان أو الشخص أو الملاحظات" aria-label="بحث في العمليات" /></label><div className="toolbar-filters"><label className="select-wrap"><Filter size={16} /><select aria-label="تصفية حسب النوع" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value as TransactionFilters['type'] })}><option value="all">كل العمليات</option><option value="income">قبض</option><option value="expense">صرف</option></select></label><select className="plain-select" aria-label="تصفية حسب التصنيف" value={filters.categoryId ?? ''} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value || undefined })}><option value="">كل التصنيفات</option>{categories.map((item) => <option key={item.id} value={item.id}>{normalizeDigits(item.name)}</option>)}</select><select className="plain-select" aria-label="تصفية حسب المرحلة" value={filters.stageId ?? ''} onChange={(e) => setFilters({ ...filters, stageId: e.target.value || undefined })}><option value="">كل المراحل</option>{stages.map((item) => <option key={item.id} value={item.id}>{normalizeDigits(item.name)}</option>)}</select><select className="plain-select sort-select" aria-label="ترتيب العمليات" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as TransactionFilters['sort'] })}><option value="newest">الأحدث</option><option value="oldest">الأقدم</option></select></div></div>
            <div className="date-filter-row"><span>الفترة</span><select className="plain-select" aria-label="فترة العمليات" value={period} onChange={(e) => { const next = e.target.value as Period; setPeriod(next); setFilters((current) => ({ query: current.query, type: current.type, categoryId: current.categoryId, stageId: current.stageId, sort: current.sort, ...getPeriodBounds(next, new Date(), periodFrom, periodTo) })); }}><option value="all">كل الفترات</option><option value="today">اليوم</option><option value="week">هذا الأسبوع</option><option value="month">هذا الشهر</option><option value="year">هذه السنة</option><option value="custom">نطاق مخصص</option></select>{period === 'custom' && <><label>من<input type="date" value={periodFrom} onChange={(e) => { setPeriodFrom(e.target.value); setFilters({ ...filters, ...getPeriodBounds('custom', new Date(), e.target.value, periodTo) }); }} /></label><label>إلى<input type="date" value={periodTo} onChange={(e) => { setPeriodTo(e.target.value); setFilters({ ...filters, ...getPeriodBounds('custom', new Date(), periodFrom, e.target.value) }); }} /></label></>}<span className="result-count">{formatAmount(visibleTransactions.length)} عملية</span><button className="outline-button export-small" disabled={!!exporting} onClick={() => exportFile('excel', visibleTransactions, transactionExportLabel)}><FileSpreadsheet size={15} />{exporting === 'excel' ? 'جاري الإنشاء…' : 'تصدير جدول البيانات'}</button><button className="outline-button export-small" disabled={!!exporting} onClick={() => exportFile('pdf', visibleTransactions, transactionExportLabel)}><FileDown size={15} />تصدير تقرير PDF</button></div>
          <TransactionTable records={visibleTransactions} categories={byId} stages={stageById} onDetails={(record) => setDialog({ mode: 'detail', record })} emptyText={filters.query || filters.type !== 'all' || filters.categoryId || filters.stageId ? 'لا توجد نتائج تطابق البحث' : 'لا توجد عمليات بعد'} onAdd={() => showCreate()} />
        </section>
      </section>}

      {page === 'statement' && <ClientStatementPage clients={clients} transactions={transactions} categories={byId} stages={stageById} onDetails={(record) => setDialog({ mode: 'detail', record })} onExport={exportFile} exporting={exporting} />}
      {page === 'trash' && <TrashPage records={trashedTransactions} categories={byId} stages={stageById} projectId={projectId} onToast={setToast} onRefresh={refreshCloudData} />}

      {page === 'reports' && <section className="page-content reports-page">
        <div className="page-heading"><div><p className="eyebrow">ملخص ومراجعة</p><h1>التقارير</h1><p className="page-subtitle">ملخص مالي ومصاريف البناء حسب التصنيف والمرحلة</p></div><div className="export-menu"><button className="secondary-button" onClick={() => document.getElementById('export-options')?.classList.toggle('open')} disabled={!!exporting}><Download size={17} />{exporting ? 'جاري إنشاء الملف…' : 'تصدير'}<ChevronDown size={15} /></button><div id="export-options" className="export-options"><button onClick={() => { void exportFile('pdf', reportTransactions, `${reportLabel} · النوع: ${reportType === 'all' ? 'الكل' : reportType === 'income' ? 'قبض' : 'صرف'}`); document.getElementById('export-options')?.classList.remove('open'); }}><FileDown size={16} />تنزيل النتائج بصيغة PDF</button><button onClick={() => { void exportFile('excel', reportTransactions, `${reportLabel} · النوع: ${reportType === 'all' ? 'الكل' : reportType === 'income' ? 'قبض' : 'صرف'}`); document.getElementById('export-options')?.classList.remove('open'); }}><FileSpreadsheet size={16} />تنزيل جدول النتائج</button><span className="export-divider" /><button onClick={() => { void exportFile('pdf', transactions, 'كل العمليات'); document.getElementById('export-options')?.classList.remove('open'); }}><FileDown size={16} />تقرير PDF لكل العمليات</button><button onClick={() => { void exportFile('excel', transactions, 'كل العمليات'); document.getElementById('export-options')?.classList.remove('open'); }}><FileSpreadsheet size={16} />جدول لكل العمليات</button></div></div></div>
        <section className="report-filter content-card"><div className="report-filter-title"><Filter size={17} /><b>تصفية التقرير</b></div><label>الفترة<select className="plain-select" value={period} onChange={(e) => setPeriod(e.target.value as Period)}><option value="today">اليوم</option><option value="week">هذا الأسبوع</option><option value="month">هذا الشهر</option><option value="year">هذه السنة</option><option value="custom">نطاق مخصص</option><option value="all">كل الفترات</option></select></label>{period === 'custom' && <><label>من<input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} /></label><label>إلى<input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} /></label></>}<label>النوع<select className="plain-select" value={reportType} onChange={(e) => setReportType(e.target.value as TransactionFilters['type'])}><option value="all">الكل</option><option value="income">قبض</option><option value="expense">صرف</option></select></label><span className="result-count">{formatAmount(reportTransactions.length)} عملية</span></section>
        {exportError && <p className="error-banner" role="alert">{exportError}</p>}
        <section className="report-summary-grid"><SummaryTile label="إجمالي القبض" value={summarizeTransactions(reportTransactions).income} kind="income" /><SummaryTile label="إجمالي الصرف" value={summarizeTransactions(reportTransactions).expenses} kind="expense" /><SummaryTile label="الرصيد الحالي" value={summarizeTransactions(reportTransactions).balance} kind="balance" /></section>
        <div className="report-columns"><ReportBreakdown title="الصرف حسب التصنيف" options={categories} records={reportTransactions} field="categoryId" /><ReportBreakdown title="الصرف حسب المرحلة" options={stages} records={reportTransactions} field="stageId" /></div>
        <section className="content-card report-periods"><div className="section-header"><div><h2>حركة الفترة المحددة</h2><p>{reportLabel}</p></div></div><div className="period-totals"><div><span className="period-dot income-dot" />القبض في الفترة<strong>{formatCurrency(summarizeTransactions(reportTransactions).income)}</strong></div><div><span className="period-dot expense-dot" />الصرف في الفترة<strong>{formatCurrency(summarizeTransactions(reportTransactions).expenses)}</strong></div></div></section>
      </section>}

      {page === 'settings' && <SettingsPage categories={categories} stages={stages} transactions={[...transactions, ...trashedTransactions]} clients={clients} projectName={projectName} logoUrl={logoUrl} dashboardOrder={dashboardOrder} dashboardSize={dashboardSize} onToast={setToast} fontPreferences={fontPreferences} onFontPreferenceChange={changeFontPreference} user={user} projectId={projectId} onRefresh={refreshCloudData} onProjectName={setProjectName} onLogo={setLogoUrl} onDashboardOrder={setDashboardOrder} onDashboardSize={setDashboardSize} />}
      <footer className="app-footer">بيتي <span>·</span> متابعة أموال بناء البيت</footer>
    </main>

    <nav className="bottom-nav" aria-label="التنقل السريع">{navItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => changePage(id)} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={19} /><span>{label}</span></button>)}</nav>
    {dialog && <TransactionDialog key={dialog.record?.id ?? `new-${dialog.type ?? ''}`} mode={dialog.mode} record={dialog.record} initialType={dialog.type} categories={categories} stages={stages} clients={clients} user={user} projectId={projectId} onClose={() => setDialog(null)} onSaved={onSaved} onDeleted={() => { setDialog(null); setToast('نُقلت العملية إلى المهملات ويمكن استعادتها'); void refreshCloudData(); }} onEdit={() => setDialog({ mode: 'edit', record: dialog.record })} />}
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">{toast}</div>
  </div>;
}

function GateShell({ children }: { children: React.ReactNode }) {
  return <main className="auth-shell" dir="rtl"><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><HardHat size={23} /></span><span><b>بيتي</b><small>متابعة بناء البيت</small></span></div>{children}</section></main>;
}

function PinGate({ onUnlock, onSignOut }: { onUnlock: () => void; onSignOut: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!verifyAppPin(pin)) { setPin(''); setError('رمز PIN غير صحيح'); return; }
    setError(''); onUnlock();
  }
  return <GateShell><h1>أدخل رمز PIN</h1><p>أدخل الرمز لفتح نظام بيتي على هذا الجهاز.</p><form className="auth-form" onSubmit={submit}><label>رمز PIN<input autoFocus type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9٠-٩۰-۹]{4}" maxLength={4} dir="ltr" value={pin} onChange={(event) => { setPin(normalizeDigits(event.target.value).replace(/\D/g, '').slice(0, 4)); setError(''); }} aria-invalid={!!error} required /></label>{error && <p className="error-banner" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={pin.length !== 4}>فتح النظام</button></form><button className="text-button" onClick={onSignOut}>تسجيل الخروج من الحساب</button></GateShell>;
}

async function downloadLocalBackup() {
  const backup = await createLocalBackup();
  const blob = new Blob([encodeBackup(backup)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `بيتي-نسخة-احتياطية-${todayISO()}.json`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SetupGate() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function backup() {
    setBusy(true); setMessage('');
    try { await downloadLocalBackup(); setMessage('تم تنزيل النسخة الاحتياطية. احتفظ بها قبل ربط الحساب.'); }
    catch { setMessage('تعذر إنشاء النسخة الاحتياطية من بيانات هذا المتصفح.'); }
    finally { setBusy(false); }
  }
  return <GateShell><h1>إعداد الاتصال السحابي</h1><p>أضف بيانات مشروع Supabase لتفعيل الدخول وحفظ البيانات على الإنترنت.</p><div className="setup-code"><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div><p className="gate-hint">ضع القيم في ملف <bdi dir="ltr">.env.local</bdi> محلياً أو في Environment Variables على Vercel، ثم أعد تشغيل التطبيق.</p><button className="secondary-button" onClick={() => void backup()} disabled={busy}><Download size={16} />{busy ? 'جارٍ إنشاء النسخة…' : 'تنزيل نسخة احتياطية من هذا المتصفح'}</button>{message && <p role="status">{message}</p>}</GateShell>;
}

function LoginGate() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const auth = requireSupabase().auth;
      if (isSignUp) {
        const { data, error: signupError } = await auth.signUp({ email: email.trim(), password, options: { data: { full_name: normalizeDigits(fullName.trim()) } } });
        if (signupError) throw signupError;
        if (!data.session) setError('تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيده ثم سجّل الدخول.');
      } else {
        const { error: loginError } = await auth.signInWithPassword({ email: email.trim(), password });
        if (loginError) throw loginError;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر إكمال تسجيل الدخول'); }
    finally { setBusy(false); }
  }
  return <GateShell><h1>{isSignUp ? 'إنشاء حساب' : 'تسجيل الدخول'}</h1><p>{isSignUp ? 'أنشئ حساباً لحفظ بيانات بيتك ومتابعتها من أجهزتك.' : 'سجّل الدخول مرة واحدة لحسابك السحابي. بعد ذلك يفتح PIN النظام عند كل زيارة.'}</p><form className="auth-form" onSubmit={(event) => void submit(event)}>{isSignUp && <label>الاسم<input autoComplete="name" value={fullName} onChange={(event) => setFullName(normalizeDigits(event.target.value))} required /></label>}<label>البريد الإلكتروني<input type="email" autoComplete="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>كلمة المرور<input type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <p className={error.startsWith('تم إنشاء') ? 'gate-success' : 'error-banner'} role={error.startsWith('تم إنشاء') ? 'status' : 'alert'}>{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'جارٍ الإرسال…' : isSignUp ? 'إنشاء الحساب' : 'دخول'}</button></form><button className="text-button" onClick={() => { setIsSignUp(!isSignUp); setError(''); }}>{isSignUp ? 'لديك حساب؟ سجّل الدخول' : 'إنشاء حساب جديد'}</button></GateShell>;
}

function SummaryTile({ label, value, kind }: { label: string; value: number; kind: 'income' | 'expense' | 'balance' }) {
  return <article className={`summary-tile ${kind}`}><span>{label}</span><strong dir="ltr"><bdi>{formatAmount(value)}</bdi><small>د.ع</small></strong></article>;
}

function TransactionTable({ records, categories, stages, onDetails, emptyText = 'لا توجد عمليات بعد', onAdd }: { records: Transaction[]; categories: Map<string, string>; stages: Map<string, string>; onDetails: (record: Transaction) => void; emptyText?: string; onAdd?: () => void }) {
  if (records.length === 0) return <div className="table-empty"><div className="empty-icon"><ReceiptText size={25} /></div><b>{emptyText}</b>{onAdd && emptyText === 'لا توجد عمليات بعد' && <button className="text-button" onClick={onAdd}><Plus size={16} />إضافة عملية</button>}</div>;
  return <div className="table-scroll"><table className="transaction-table"><thead><tr><th>النوع</th><th>البيان</th><th>التصنيف</th><th>المرحلة</th><th>التاريخ</th><th>المبلغ</th><th><span className="sr-only">تفاصيل</span></th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td><span className={`type-badge ${record.type}`}><span />{record.type === 'income' ? 'قبض' : 'صرف'}</span></td><td><div className="transaction-description">{normalizeDigits(record.description)}{record.attachmentId && <span className="attachment-mark" title="توجد فاتورة أو صورة" aria-label="توجد فاتورة أو صورة"><ImagePlus size={13} /></span>}<small>{normalizeDigits(record.person || 'بدون اسم')}</small></div></td><td>{normalizeDigits(categories.get(record.categoryId ?? '') ?? '—')}</td><td>{normalizeDigits(stages.get(record.stageId ?? '') ?? '—')}</td><td><span className="date-cell">{compactDate.format(new Date(`${record.date}T12:00:00`))}</span></td><td><strong className={`table-amount ${record.type}`} dir="ltr"><bdi>{formatAmount(record.amount)}</bdi><small>د.ع</small></strong></td><td><button className="row-open" onClick={(e) => { e.stopPropagation(); onDetails(record); }} aria-label={`عرض تفاصيل: ${normalizeDigits(record.description)}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>;
}

function EmptyState({ onAdd }: { onAdd: () => void }) { return <div className="dashboard-empty"><div className="empty-icon"><ReceiptText size={24} /></div><b>لا توجد عمليات بعد</b><button className="outline-button" onClick={onAdd}><Plus size={16} />إضافة عملية</button></div>; }

function ReportBreakdown({ title, options, records, field }: { title: string; options: NamedOption[]; records: Transaction[]; field: 'categoryId' | 'stageId' }) {
  const totals = [...options.map((option) => ({ ...option, value: sumAmounts(records.filter((record) => record.type === 'expense' && record[field] === option.id).map((record) => record.amount)) })), { id: 'unassigned', name: field === 'categoryId' ? 'غير مصنف' : 'غير محددة', value: sumAmounts(records.filter((record) => record.type === 'expense' && !record[field]).map((record) => record.amount)), createdAt: 0, updatedAt: 0 }].filter((option) => option.value > 0).sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...totals.map((row) => row.value));
  return <section className="content-card breakdown-card"><div className="section-header"><div><h2>{title}</h2><p>إجمالي المصروفات المسجلة</p></div><span className="chart-icon"><BarChart3 size={18} /></span></div>{totals.length ? <div className="breakdown-list">{totals.map((row) => <div className="breakdown-row" key={row.id}><div className="breakdown-label"><span>{normalizeDigits(row.name)}</span><strong dir="ltr"><bdi>{formatAmount(row.value)}</bdi><small>د.ع</small></strong></div><div className="bar-track"><span style={{ width: `${Math.max(3, row.value / max * 100)}%` }} /></div></div>)}</div> : <div className="breakdown-empty">لا توجد مصروفات ضمن الفترة المحددة</div>}</section>;
}

function TransactionDialog({ mode, record, initialType, categories, stages, clients, user, projectId, onClose, onSaved, onDeleted, onEdit }: {
  mode: 'create' | 'edit' | 'detail'; record?: Transaction; initialType?: TransactionType; categories: NamedOption[]; stages: NamedOption[]; clients: Client[];
  user: User; projectId: string;
  onClose: () => void; onSaved: (message: string) => void; onDeleted: () => void; onEdit: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const [storedAttachment, setStoredAttachment] = useState<{ url: string; fileName: string; fileType: string } | null>(null);
  useEffect(() => {
    let active = true;
    setStoredAttachment(null);
    if (record?.attachmentId) void getCloudAttachment(record.id).then((attachment) => { if (active) setStoredAttachment(attachment); }).catch((error) => console.error(error));
    return () => { active = false; };
  }, [record?.id, record?.attachmentId]);
  const [type, setType] = useState<TransactionType>(record?.type ?? initialType ?? 'expense');
  const [amount, setAmount] = useState(record ? formatAmount(record.amount) : '');
  const [description, setDescription] = useState(normalizeDigits(record?.description ?? ''));
  const [date, setDate] = useState(record?.date ?? todayISO());
  const [categoryId, setCategoryId] = useState(record?.categoryId ?? '');
  const [stageId, setStageId] = useState(record?.stageId ?? '');
  const [clientId, setClientId] = useState(record?.clientId ?? '');
  const [person, setPerson] = useState(normalizeDigits(record?.person ?? ''));
  const [notes, setNotes] = useState(normalizeDigits(record?.notes ?? ''));
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; description?: string; date?: string }>({});
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localPreview = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  useEffect(() => {
    const element = dialogRef.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);

  const isDetail = mode === 'detail';
  const hasAttachment = !!storedAttachment && !removeFile;
  const attachmentURL = hasAttachment ? storedAttachment?.url ?? null : null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const parsedAmount = parseAmount(amount);
    const errors: typeof fieldErrors = {};
    if (!(parsedAmount > 0)) errors.amount = 'يرجى إدخال المبلغ';
    if (!description.trim()) errors.description = 'يرجى إدخال البيان';
    if (!date || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) errors.date = 'يرجى إدخال تاريخ صحيح';
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      if (errors.amount) amountRef.current?.focus(); else if (errors.description) descriptionRef.current?.focus();
      return;
    }
    setFieldErrors({}); setBusy(true);
    const now = Date.now();
    const next: Transaction = {
      id: record?.id ?? crypto.randomUUID(), type, amount: parsedAmount, description: normalizeDigits(description.trim()), date: normalizeDigits(date),
      ...(type === 'expense' && categoryId ? { categoryId } : {}), ...(type === 'expense' && stageId ? { stageId } : {}),
      ...(clientId ? { clientId } : {}),
      ...(person.trim() ? { person: normalizeDigits(person.trim()) } : {}), ...(notes.trim() ? { notes: normalizeDigits(notes.trim()) } : {}),
      createdAt: record?.createdAt ?? now, updatedAt: now
    };
    try {
      if (file && (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size > 10 * 1024 * 1024)) throw new Error('invalid-file');
      await saveCloudTransaction(user, projectId, next, file, removeFile);
      onSaved(mode === 'edit' ? 'تم تعديل العملية بنجاح' : 'تم حفظ العملية بنجاح');
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error && cause.message === 'invalid-file' ? 'الملف غير مدعوم أو يتجاوز 10 ميغابايت' : file ? 'تعذر رفع المرفق، حاول مرة أخرى' : 'تعذر حفظ العملية، حاول مرة أخرى');
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!record || !window.confirm('هل أنت متأكد من حذف هذه العملية؟')) return;
    setBusy(true);
    try { await deleteCloudTransaction(projectId, record.id); onDeleted(); }
    catch (cause) { console.error(cause); setError('تعذر حذف العملية، حاول مرة أخرى'); setBusy(false); }
  }

  const labels = type === 'income' ? { title: 'إضافة قبض', person: 'المصدر / الشخص', file: 'صورة داعمة' } : { title: 'إضافة صرف', person: 'المورد / الشخص', file: 'فاتورة أو وصل' };
  const modalTitle = isDetail ? (record?.type === 'income' ? 'تفاصيل القبض' : 'تفاصيل الصرف') : mode === 'edit' ? 'تعديل العملية' : labels.title;
  const close = () => { if (!busy) onClose(); };

  return <dialog ref={dialogRef} className="transaction-dialog" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialogRef.current) close(); }} aria-labelledby="transaction-dialog-title">
    <div className="dialog-head"><div><span className={`dialog-type-icon ${type}`}>{type === 'income' ? <ArrowDownLeft size={18} /> : <ArrowUpLeft size={18} />}</span><div><h2 id="transaction-dialog-title">{modalTitle}</h2><p>{isDetail ? 'معلومات العملية المالية' : 'أدخل تفاصيل العملية'}</p></div></div><button className="icon-button" onClick={close} aria-label="إغلاق النافذة"><X size={19} /></button></div>
    {isDetail && record ? <div className="details-content">
      <div className={`details-amount ${record.type}`}><span>{record.type === 'income' ? 'مبلغ القبض' : 'مبلغ الصرف'}</span><strong dir="ltr"><bdi>{formatAmount(record.amount)}</bdi><small>د.ع</small></strong></div>
      <div className="details-grid"><DetailItem label="البيان" value={normalizeDigits(record.description)} /><DetailItem label="التاريخ" value={formatDate(record.date)} /><DetailItem label="العميل" value={normalizeDigits(clients.find((item) => item.id === record.clientId)?.name ?? '—')} /><DetailItem label="التصنيف" value={normalizeDigits(categories.find((item) => item.id === record.categoryId)?.name ?? '—')} /><DetailItem label="المرحلة" value={normalizeDigits(stages.find((item) => item.id === record.stageId)?.name ?? '—')} /><DetailItem label={record.type === 'income' ? 'المصدر / الشخص' : 'المورد / الشخص'} value={normalizeDigits(record.person || '—')} /><DetailItem label="الملاحظات" value={normalizeDigits(record.notes || '—')} wide /></div>
      {hasAttachment && storedAttachment && <div className="detail-attachment"><span className="field-label">الفاتورة / الصورة</span><a href={storedAttachment.url} target="_blank" rel="noreferrer" className="attachment-preview">{storedAttachment.fileType.startsWith('image/') ? <img src={storedAttachment.url} alt={normalizeDigits(storedAttachment.fileName)} /> : <FileDown size={22} />}<span>{normalizeDigits(storedAttachment.fileName)} <Download size={15} /></span></a></div>}
      <div className="dialog-actions"><button className="danger-outline" onClick={() => void deleteCurrent()} disabled={busy}><Trash2 size={16} />حذف</button><span className="actions-spacer" /><button className="secondary-button" onClick={onClose}>إغلاق</button><button className="primary-button" onClick={onEdit}><Pencil size={15} />تعديل</button></div>
    </div> : <form onSubmit={(event) => void submit(event)} noValidate>
      <div className="dialog-body">
        <fieldset className="type-switch"><legend>نوع العملية</legend><button type="button" className={type === 'expense' ? 'selected expense' : ''} onClick={() => setType('expense')}><ArrowUpLeft size={16} />صرف</button><button type="button" className={type === 'income' ? 'selected income' : ''} onClick={() => setType('income')}><ArrowDownLeft size={16} />قبض</button></fieldset>
        <div className="form-grid">
          <div className="form-field"><label htmlFor="amount">المبلغ <span className="required">*</span></label><div className={`amount-field ${fieldErrors.amount ? 'invalid' : ''}`}><AmountInput id="amount" onInputRef={(element) => { amountRef.current = element; }} invalid={!!fieldErrors.amount} describedBy={fieldErrors.amount ? 'amount-error' : undefined} value={amount} onChange={(value) => { setAmount(value); if (parseAmount(value) > 0) setFieldErrors((old) => ({ ...old, amount: undefined })); }} /><span className="currency-suffix">د.ع</span></div>{fieldErrors.amount && <small className="field-error" id="amount-error">{fieldErrors.amount}</small>}</div>
          <div className="form-field"><label htmlFor="transaction-date">التاريخ <span className="required">*</span></label><input id="transaction-date" type="date" lang="en" dir="ltr" value={date} onChange={(e) => { setDate(normalizeDigits(e.target.value)); setFieldErrors((old) => ({ ...old, date: undefined })); }} aria-invalid={!!fieldErrors.date} />{fieldErrors.date && <small className="field-error">{fieldErrors.date}</small>}</div>
          <div className="form-field form-wide"><label htmlFor="transaction-description">البيان <span className="required">*</span></label><input ref={descriptionRef} id="transaction-description" value={description} onChange={(e) => { setDescription(normalizeDigits(e.target.value)); setFieldErrors((old) => ({ ...old, description: undefined })); }} placeholder={type === 'income' ? 'مثال: دفعة من صاحب البيت' : 'مثال: شراء إسمنت'} aria-invalid={!!fieldErrors.description} />{fieldErrors.description && <small className="field-error">{fieldErrors.description}</small>}</div>
          {type === 'expense' && <div className="form-field"><label htmlFor="category">التصنيف <span className="optional">اختياري</span></label><select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">بدون تصنيف</option>{categories.map((item) => <option key={item.id} value={item.id}>{normalizeDigits(item.name)}</option>)}</select></div>}
          {type === 'expense' && <div className="form-field"><label htmlFor="stage">المرحلة <span className="optional">اختياري</span></label><select id="stage" value={stageId} onChange={(e) => setStageId(e.target.value)}><option value="">بدون مرحلة</option>{stages.map((item) => <option key={item.id} value={item.id}>{normalizeDigits(item.name)}</option>)}</select></div>}
          <div className="form-field form-wide"><label htmlFor="client">العميل <span className="optional">اختياري</span></label><select id="client" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">بدون عميل</option>{clients.map((item) => <option key={item.id} value={item.id}>{normalizeDigits(item.name)}{item.phone ? ` · ${normalizeDigits(item.phone)}` : ''}</option>)}</select></div>
          <div className="form-field form-wide"><label htmlFor="person">{labels.person} <span className="optional">اختياري</span></label><input id="person" value={person} onChange={(e) => setPerson(normalizeDigits(e.target.value))} placeholder="اسم المورد أو الشخص" /></div>
          <div className="form-field form-wide"><label htmlFor="notes">الملاحظات <span className="optional">اختياري</span></label><textarea id="notes" value={notes} onChange={(e) => setNotes(normalizeDigits(e.target.value))} placeholder="أضف ملاحظة إذا لزم الأمر" rows={3} /></div>
          <div className="form-field form-wide"><span className="field-label">{labels.file} <span className="optional">اختياري</span></span><input ref={fileInputRef} className="sr-only" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const selected = e.target.files?.[0] ?? null; if (selected && (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(selected.type) || selected.size > 10 * 1024 * 1024)) { setError('الملف غير مدعوم أو يتجاوز 10 ميغابايت'); e.currentTarget.value = ''; return; } setError(''); setFile(selected); if (selected) setRemoveFile(false); }} /><div className="upload-row"><button type="button" className="upload-button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={17} />{file ? 'تغيير المرفق' : hasAttachment ? 'استبدال المرفق' : 'اختيار مرفق'}</button><small>صورة أو PDF · حتى 10 ميغابايت</small></div>
            {(localPreview || (hasAttachment && attachmentURL)) && <div className="new-file-preview">{(file?.type ?? storedAttachment?.fileType ?? '').startsWith('image/') ? <img src={localPreview ?? attachmentURL ?? ''} alt="معاينة الصورة المرفقة" /> : <FileDown size={22} />}<span>{normalizeDigits(file?.name ?? storedAttachment?.fileName ?? '')}</span><button type="button" className="remove-file" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; if (storedAttachment) setRemoveFile(true); }} aria-label="حذف المرفق"><X size={16} /></button></div>}
          </div>
        </div>
        {error && <p className="error-banner" role="alert">{error}</p>}
      </div>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={close}>إلغاء</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'جاري الحفظ…' : <><Check size={16} />{mode === 'edit' ? 'حفظ التعديلات' : 'حفظ العملية'}</>}</button></div>
    </form>}
  </dialog>;
}

function DetailItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) { return <div className={`detail-item ${wide ? 'wide' : ''}`}><span>{label}</span><b>{value}</b></div>; }

function SettingsPage({ categories, stages, transactions, clients, projectName, logoUrl, dashboardOrder, dashboardSize, onToast, fontPreferences, onFontPreferenceChange, user, projectId, onRefresh, onProjectName, onLogo, onDashboardOrder, onDashboardSize }: { categories: NamedOption[]; stages: NamedOption[]; transactions: Transaction[]; clients: Client[]; projectName: string; logoUrl: string | null; dashboardOrder: DashboardCard[]; dashboardSize: 'compact' | 'normal' | 'large'; onToast: (message: string) => void; fontPreferences: FontPreferences; onFontPreferenceChange: (role: keyof FontPreferences, font: FontStyleId) => void; user: User; projectId: string; onRefresh: () => Promise<void>; onProjectName: (name: string) => void; onLogo: (url: string | null) => void; onDashboardOrder: (order: DashboardCard[]) => void; onDashboardSize: (size: 'compact' | 'normal' | 'large') => void }) {
  const [newCategory, setNewCategory] = useState('');
  const [newStage, setNewStage] = useState('');
  const [backupReady, setBackupReady] = useState(false);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationMessage, setMigrationMessage] = useState('');
  const backupFileRef = useRef<HTMLInputElement>(null);
  async function addOption(kind: 'category' | 'stage') {
    const value = normalizeDigits(kind === 'category' ? newCategory.trim() : newStage.trim());
    if (!value) return;
    const options = kind === 'category' ? categories : stages;
    const duplicate = options.some((option) => option.name === value);
    if (duplicate) { onToast('هذا الاسم موجود مسبقاً'); return; }
    const now = Date.now();
    try { await saveCloudOption(user, projectId, kind, { id: crypto.randomUUID(), name: value, createdAt: now, updatedAt: now }); await onRefresh(); }
    catch { onToast('تعذرت إضافة العنصر. تحقق من الاتصال.'); return; }
    if (kind === 'category') setNewCategory(''); else setNewStage('');
    onToast('تمت الإضافة بنجاح');
  }
  async function renameOption(item: NamedOption, kind: 'category' | 'stage') {
    const value = normalizeDigits(window.prompt('اكتب الاسم الجديد', normalizeDigits(item.name))?.trim() ?? '');
    if (!value || value === item.name) return;
    const options = kind === 'category' ? categories : stages;
    const duplicate = options.some((option) => option.name === value && option.id !== item.id);
    if (duplicate) { onToast('هذا الاسم موجود مسبقاً'); return; }
    try { await saveCloudOption(user, projectId, kind, { ...item, name: value, updatedAt: Date.now() }); await onRefresh(); onToast('تم تعديل الاسم'); }
    catch { onToast('تعذر تعديل الاسم. تحقق من الاتصال.'); }
  }
  async function deleteOption(item: NamedOption, kind: 'category' | 'stage') {
    const inUse = transactions.some((record) => kind === 'category' ? record.categoryId === item.id : record.stageId === item.id);
    if (inUse) { onToast('لا يمكن حذف عنصر مستخدم في عملية مسجلة'); return; }
    if (!window.confirm(`هل تريد حذف «${normalizeDigits(item.name)}»؟`)) return;
    try { await deleteCloudOption(projectId, kind, item.id); await onRefresh(); onToast('تم الحذف بنجاح'); }
    catch { onToast('تعذر حذف العنصر. تحقق من الاتصال.'); }
  }
  async function createBackup() {
    try { await downloadLocalBackup(); setBackupReady(true); setMigrationMessage('تم تنزيل النسخة الاحتياطية من بيانات هذا المتصفح.'); }
    catch { setMigrationMessage('تعذر إنشاء النسخة الاحتياطية.'); }
  }
  async function importBackup(file?: File) {
    if (!file) return;
    if (!backupReady) { setMigrationMessage('نزّل النسخة الاحتياطية قبل بدء النقل.'); if (backupFileRef.current) backupFileRef.current.value = ''; return; }
    if (file.size > 100 * 1024 * 1024) { setMigrationMessage('حجم النسخة يتجاوز الحد المسموح به (100 ميغابايت).'); return; }
    setMigrationBusy(true); setMigrationMessage('جارٍ التحقق من النسخة…');
    try {
      const backup = decodeBackup(await file.text());
      if (!window.confirm(`سيتم دمج ${formatAmount(backup.transactions.length)} عملية و${formatAmount(backup.attachments.length)} مرفق في حسابك السحابي. لن تُحذف البيانات المحلية. هل تريد المتابعة؟`)) return;
      setMigrationMessage('جارٍ نقل البيانات والمرفقات…');
      await importLocalBackup(user, projectId, backup);
      await onRefresh();
      setMigrationMessage(`اكتمل نقل ${formatAmount(backup.transactions.length)} عملية. قاعدة البيانات المحلية ما زالت محفوظة.`);
    } catch (error) {
      console.error(error); setMigrationMessage(error instanceof Error ? `تعذر إكمال النقل: ${error.message}` : 'تعذر قراءة النسخة أو نقلها.');
    } finally { setMigrationBusy(false); if (backupFileRef.current) backupFileRef.current.value = ''; }
  }
  return <section className="page-content settings-page"><div className="page-heading"><div><p className="eyebrow">تهيئة التطبيق</p><h1>الإعدادات</h1><p className="page-subtitle">تحكم بالنظام والعملاء والتصنيفات ومراحل البناء</p></div><button className="secondary-button" onClick={() => void requireSupabase().auth.signOut()}>تسجيل الخروج</button></div>
    <SystemSettingsPanel projectId={projectId} user={user} projectName={projectName} logoUrl={logoUrl} dashboardOrder={dashboardOrder} dashboardSize={dashboardSize} onToast={onToast} onRefresh={onRefresh} onProjectName={onProjectName} onLogo={onLogo} onDashboardOrder={onDashboardOrder} onDashboardSize={onDashboardSize} />
    <section className="content-card client-settings"><div className="section-header"><div className="settings-title"><Users size={19} /><div><h2>العملاء</h2><p>بيانات العملاء المرتبطة بكشف الحساب والعمليات</p></div></div><span className="item-count">{formatAmount(clients.length)}</span></div><ClientManager clients={clients} transactions={transactions} user={user} projectId={projectId} onToast={onToast} onRefresh={onRefresh} /></section>
    <div className="settings-grid"><SettingsGroup title="التصنيفات" description="تصنيفات المصاريف المستخدمة" icon={<ReceiptText size={18} />} items={categories} kind="category" newValue={newCategory} onValue={setNewCategory} onAdd={() => void addOption('category')} onRename={renameOption} onDelete={deleteOption} /><SettingsGroup title="مراحل البناء" description="مراحل تنفيذ البيت" icon={<HardHat size={18} />} items={stages} kind="stage" newValue={newStage} onValue={setNewStage} onAdd={() => void addOption('stage')} onRename={renameOption} onDelete={deleteOption} /></div>
    <section className="font-settings-section" aria-labelledby="font-settings-title"><div className="section-header"><div><h2 id="font-settings-title">التحكم بالخطوط</h2><p>اختر خطاً مستقلاً للعناوين وللنصوص المساندة</p></div><span className="font-section-icon" aria-hidden="true">Aa</span></div><div className="font-settings-grid"><FontPicker role="primary" title="النصوص الرئيسية" description="العناوين والأسماء البارزة" value={fontPreferences.primary} onChange={(font) => onFontPreferenceChange('primary', font)} /><FontPicker role="secondary" title="النصوص الثانوية" description="النصوص والوصف والقوائم" value={fontPreferences.secondary} onChange={(font) => onFontPreferenceChange('secondary', font)} /></div><p className="font-note">تعرض المعاينة نماذج رقمية قريبة من أسماء الخطوط التقليدية، وقد يختلف رسم بعض الخطوط عن النسخ الخطية الأصلية.</p></section>
    <div className="local-data-note"><span><Wallet size={18} /></span><div><b>نقل البيانات المحلية إلى الحساب السحابي</b><p>نزّل نسخة JSON تشمل العمليات والتصنيفات والمراحل والمرفقات، ثم استوردها. تبقى بيانات المتصفح محفوظة بعد النقل.</p><div className="migration-actions"><button className="secondary-button" onClick={() => void createBackup()} disabled={migrationBusy}><Download size={16} />تنزيل النسخة الاحتياطية</button><input ref={backupFileRef} type="file" accept="application/json,.json" onChange={(event) => void importBackup(event.target.files?.[0])} disabled={migrationBusy} aria-label="اختيار نسخة احتياطية للاستيراد" /><button className="primary-button" onClick={() => backupFileRef.current?.click()} disabled={migrationBusy || !backupReady}>استيراد النسخة إلى الحساب</button></div>{migrationMessage && <p role="status">{migrationMessage}</p>}</div></div><p className="gate-hint">الحساب: <bdi dir="ltr">{user.email}</bdi> · البيانات الحالية محفوظة في Supabase.</p></section>;
}

function SystemSettingsPanel({ projectId, user, projectName, logoUrl, dashboardOrder, dashboardSize, onToast, onRefresh, onProjectName, onLogo, onDashboardOrder, onDashboardSize }: {
  projectId: string; user: User; projectName: string; logoUrl: string | null; dashboardOrder: DashboardCard[]; dashboardSize: 'compact' | 'normal' | 'large';
  onToast: (message: string) => void; onRefresh: () => Promise<void>; onProjectName: (name: string) => void; onLogo: (url: string | null) => void; onDashboardOrder: (order: DashboardCard[]) => void; onDashboardSize: (size: 'compact' | 'normal' | 'large') => void;
}) {
  const [name, setName] = useState(projectName);
  const [busy, setBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  useEffect(() => setName(projectName), [projectName]);
  async function saveSettings(nextOrder = dashboardOrder, nextSize = dashboardSize, nextName = name) {
    const cleanName = normalizeDigits(nextName.trim());
    if (!cleanName) { onToast('اكتب اسماً للنظام'); return; }
    setBusy(true);
    try {
      await saveCloudProjectSettings(projectId, cleanName, nextOrder, nextSize);
      onProjectName(cleanName); onDashboardOrder(nextOrder); onDashboardSize(nextSize); setName(cleanName); onToast('تم حفظ إعدادات النظام');
    } catch { onToast('تعذر حفظ إعدادات النظام. تحقق من الاتصال وتطبيق ترحيل قاعدة البيانات.'); }
    finally { setBusy(false); }
  }
  async function moveCard(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= dashboardOrder.length) return;
    const next = [...dashboardOrder]; [next[index], next[target]] = [next[target], next[index]];
    await saveSettings(next);
  }
  async function changeSize(size: 'compact' | 'normal' | 'large') { await saveSettings(dashboardOrder, size); }
  async function uploadLogo(file?: File) {
    if (!file) return;
    setBusy(true);
    try { await uploadCloudLogo(user.id, projectId, file); await onRefresh(); onToast('تم تحديث شعار النظام'); }
    catch (error) { onToast(error instanceof Error && error.message === 'logo-invalid' ? 'اختر شعاراً بصيغة PNG أو JPG أو WebP أو SVG وبحجم لا يتجاوز 2 ميغابايت' : 'تعذر رفع الشعار. تحقق من تطبيق ترحيل قاعدة البيانات.'); }
    finally { setBusy(false); if (logoInput.current) logoInput.current.value = ''; }
  }
  async function removeLogo() {
    if (!window.confirm('هل تريد إزالة شعار النظام؟')) return;
    setBusy(true);
    try { await deleteCloudLogo(projectId); onLogo(null); onToast('تمت إزالة الشعار'); }
    catch { onToast('تعذر إزالة الشعار'); }
    finally { setBusy(false); }
  }
  const labels: Record<DashboardCard, string> = { balance: 'الرصيد الحالي', income: 'إجمالي القبض', expense: 'إجمالي الصرف' };
  return <section className="system-settings content-card"><div className="section-header"><div className="settings-title"><Settings size={19} /><div><h2>لوحة التحكم بالنظام</h2><p>اسم النظام وشعاره وترتيب بطاقات الرئيسية وحجمها</p></div></div></div>
    <div className="system-settings-body"><form className="system-name-form" onSubmit={(event) => { event.preventDefault(); void saveSettings(dashboardOrder, dashboardSize, name); }}><label className="form-field"><span className="field-label">اسم النظام</span><input value={name} onChange={(event) => setName(normalizeDigits(event.target.value))} maxLength={60} /></label><button className="primary-button" disabled={busy}><Check size={15} />حفظ الاسم</button></form>
      <div className="logo-control"><div className="logo-preview">{logoUrl ? <img src={logoUrl} alt="شعار النظام الحالي" /> : <HardHat size={25} />}</div><div><b>شعار النظام</b><p>PNG أو JPG أو WebP أو SVG · 2 ميغابايت كحد أقصى</p><input ref={logoInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void uploadLogo(event.target.files?.[0])} /><div className="settings-inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => logoInput.current?.click()}><Upload size={15} />{logoUrl ? 'تغيير الشعار' : 'إضافة شعار'}</button>{logoUrl && <button type="button" className="danger-outline" disabled={busy} onClick={() => void removeLogo()}><Trash2 size={15} />إزالة</button>}</div></div></div>
      <div className="dashboard-controls"><div><b>ترتيب بطاقات الرئيسية</b><p>غيّر موضع كل بطاقة باستخدام الأسهم</p></div><ol>{dashboardOrder.map((card, index) => <li key={card}><span>{formatAmount(index + 1)}. {labels[card]}</span><div><button className="icon-button" aria-label={`تحريك ${labels[card]} للأعلى`} disabled={index === 0 || busy} onClick={() => void moveCard(index, -1)}><ArrowUp size={16} /></button><button className="icon-button" aria-label={`تحريك ${labels[card]} للأسفل`} disabled={index === dashboardOrder.length - 1 || busy} onClick={() => void moveCard(index, 1)}><ArrowDown size={16} /></button></div></li>)}</ol></div>
      <label className="form-field dashboard-size-field"><span className="field-label">حجم بطاقات الرئيسية</span><select value={dashboardSize} disabled={busy} onChange={(event) => void changeSize(event.target.value as 'compact' | 'normal' | 'large')}><option value="compact">صغير</option><option value="normal">متوسط</option><option value="large">كبير</option></select></label>
    </div>
  </section>;
}

function ClientManager({ clients, transactions, user, projectId, onToast, onRefresh }: { clients: Client[]; transactions: Transaction[]; user: User; projectId: string; onToast: (message: string) => void; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [profession, setProfession] = useState('');
  const [busy, setBusy] = useState(false);
  async function saveClient(event: React.FormEvent) {
    event.preventDefault();
    const cleanName = normalizeDigits(name.trim());
    if (!cleanName) return;
    if (clients.some((client) => client.name.trim() === cleanName)) { onToast('اسم العميل موجود مسبقاً'); return; }
    const now = Date.now(); setBusy(true);
    try { await saveCloudClient(user, projectId, { id: crypto.randomUUID(), name: cleanName, phone: normalizeDigits(phone.trim()), profession: normalizeDigits(profession.trim()), createdAt: now, updatedAt: now }); await onRefresh(); setName(''); setPhone(''); setProfession(''); onToast('تمت إضافة العميل'); }
    catch { onToast('تعذرت إضافة العميل. تحقق من الاتصال وتطبيق ترحيل قاعدة البيانات.'); }
    finally { setBusy(false); }
  }
  async function editClient(client: Client) {
    const nextName = normalizeDigits(window.prompt('اسم العميل', client.name)?.trim() ?? '');
    if (!nextName) return;
    const nextPhone = normalizeDigits(window.prompt('رقم الهاتف', client.phone)?.trim() ?? client.phone);
    const nextProfession = normalizeDigits(window.prompt('المهنة', client.profession)?.trim() ?? client.profession);
    setBusy(true);
    try { await saveCloudClient(user, projectId, { ...client, name: nextName, phone: nextPhone, profession: nextProfession, updatedAt: Date.now() }); await onRefresh(); onToast('تم تعديل بيانات العميل'); }
    catch { onToast('تعذر تعديل بيانات العميل'); }
    finally { setBusy(false); }
  }
  async function removeClient(client: Client) {
    if (transactions.some((record) => record.clientId === client.id)) { onToast('لا يمكن حذف عميل مرتبط بعمليات؛ سيبقى كشف حسابه محفوظاً'); return; }
    if (!window.confirm(`حذف العميل «${client.name}»؟`)) return;
    setBusy(true);
    try { await deleteCloudClient(projectId, client.id); await onRefresh(); onToast('تم حذف العميل'); }
    catch { onToast('تعذر حذف العميل'); }
    finally { setBusy(false); }
  }
  return <><form className="client-add-form" onSubmit={(event) => void saveClient(event)}><label>الاسم<input required value={name} onChange={(event) => setName(normalizeDigits(event.target.value))} placeholder="اسم العميل" /></label><label>رقم الهاتف<input inputMode="tel" dir="ltr" value={phone} onChange={(event) => setPhone(normalizeDigits(event.target.value))} placeholder="07XXXXXXXXX" /></label><label>المهنة<input value={profession} onChange={(event) => setProfession(normalizeDigits(event.target.value))} placeholder="المهنة" /></label><button className="primary-button" disabled={busy || !name.trim()}><Plus size={16} />إضافة عميل</button></form>{clients.length ? <ul className="client-list">{clients.map((client) => <li key={client.id}><div><b>{normalizeDigits(client.name)}</b><span>{client.phone ? <bdi dir="ltr">{normalizeDigits(client.phone)}</bdi> : 'بدون رقم هاتف'}{client.profession ? ` · ${normalizeDigits(client.profession)}` : ''}</span></div><div><button className="icon-button" disabled={busy} onClick={() => void editClient(client)} aria-label={`تعديل ${client.name}`}><Pencil size={15} /></button><button className="icon-button delete-icon" disabled={busy} onClick={() => void removeClient(client)} aria-label={`حذف ${client.name}`}><Trash2 size={15} /></button></div></li>)}</ul> : <div className="settings-empty">أضف العملاء لتظهر أسماؤهم في العمليات وكشف الحساب.</div>}</>;
}

function ClientStatementPage({ clients, transactions, categories, stages, onDetails, onExport, exporting }: { clients: Client[]; transactions: Transaction[]; categories: Map<string, string>; stages: Map<string, string>; onDetails: (record: Transaction) => void; onExport: (kind: 'pdf' | 'excel', records: Transaction[], label: string, sums?: ReturnType<typeof summarizeTransactions>) => Promise<void>; exporting: 'pdf' | 'excel' | null }) {
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState<'all' | TransactionType>('all');
  const base = useMemo(() => clientId ? summarizeClientStatement(transactions, clientId).transactions : [], [transactions, clientId]);
  const records = base.filter((record) => (!from || record.date >= from) && (!to || record.date <= to) && (type === 'all' || record.type === type));
  const summary = summarizeTransactions(records);
  const selected = clients.find((client) => client.id === clientId);
  const label = `${selected?.name ?? 'كشف حساب'} · ${from || 'البداية'} — ${to || 'اليوم'} · ${type === 'all' ? 'القبض والصرف' : type === 'income' ? 'القبض' : 'الصرف'}`;
  return <section className="page-content statement-page"><div className="page-heading"><div><p className="eyebrow">حسابات العملاء</p><h1>كشف حساب</h1><p className="page-subtitle">راجع كل عمليات القبض والصرف المرتبطة بالعميل</p></div><div className="settings-inline-actions"><button className="secondary-button" disabled={!selected || !!exporting} onClick={() => void onExport('pdf', records, label, summary)}><FileDown size={16} />PDF</button><button className="secondary-button" disabled={!selected || !!exporting} onClick={() => void onExport('excel', records, label, summary)}><FileSpreadsheet size={16} />Excel</button></div></div>
    <section className="content-card statement-filter"><label>العميل<select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">اختر عميلاً</option>{clients.map((client) => <option key={client.id} value={client.id}>{normalizeDigits(client.name)}</option>)}</select></label><label>من تاريخ<input type="date" lang="en" dir="ltr" value={from} onChange={(event) => setFrom(normalizeDigits(event.target.value))} /></label><label>إلى تاريخ<input type="date" lang="en" dir="ltr" value={to} onChange={(event) => setTo(normalizeDigits(event.target.value))} /></label><label>النوع<select value={type} onChange={(event) => setType(event.target.value as 'all' | TransactionType)}><option value="all">القبض والصرف</option><option value="income">قبض</option><option value="expense">صرف</option></select></label></section>
    {!clients.length ? <section className="content-card settings-empty">أضف العملاء من الإعدادات أولاً.</section> : !selected ? <section className="content-card settings-empty">اختر عميلاً لعرض كشف حسابه.</section> : <><section className="report-summary-grid"><SummaryTile label="إجمالي القبض" value={summary.income} kind="income" /><SummaryTile label="إجمالي الصرف" value={summary.expenses} kind="expense" /><SummaryTile label="الرصيد (القبض - الصرف)" value={summary.balance} kind="balance" /></section><section className="content-card statement-transactions"><div className="section-header"><div><h2>{normalizeDigits(selected.name)}</h2><p>{selected.phone ? <bdi dir="ltr">{normalizeDigits(selected.phone)}</bdi> : 'بدون رقم هاتف'}{selected.profession ? ` · ${normalizeDigits(selected.profession)}` : ''} · {formatAmount(records.length)} عملية</p></div></div><TransactionTable records={records} categories={categories} stages={stages} onDetails={onDetails} emptyText="لا توجد عمليات لهذا العميل ضمن الفترة المحددة" /></section></>}
  </section>;
}

function TrashPage({ records, categories, stages, projectId, onToast, onRefresh }: { records: Transaction[]; categories: Map<string, string>; stages: Map<string, string>; projectId: string; onToast: (message: string) => void; onRefresh: () => Promise<void> }) {
  const [busyId, setBusyId] = useState('');
  async function restore(record: Transaction) { setBusyId(record.id); try { await restoreCloudTransaction(projectId, record.id); await onRefresh(); onToast('تمت استعادة العملية'); } catch { onToast('تعذرت استعادة العملية'); } finally { setBusyId(''); } }
  async function removeForever(record: Transaction) { if (!window.confirm('سيتم حذف العملية ومرفقها نهائياً ولا يمكن استعادتها. هل تريد المتابعة؟')) return; setBusyId(record.id); try { await permanentlyDeleteCloudTransaction(projectId, record.id); await onRefresh(); onToast('تم حذف العملية نهائياً'); } catch { onToast('تعذر حذف العملية نهائياً'); } finally { setBusyId(''); } }
  return <section className="page-content trash-page"><div className="page-heading"><div><p className="eyebrow">استعادة العمليات المحذوفة</p><h1>المهملات</h1><p className="page-subtitle">العمليات هنا لا تدخل في الرصيد حتى تستعيدها</p></div><span className="item-count">{formatAmount(records.length)}</span></div><section className="content-card"><TrashTable records={records} categories={categories} stages={stages} busyId={busyId} onRestore={restore} onDelete={removeForever} /></section></section>;
}

function TrashTable({ records, categories, stages, busyId, onRestore, onDelete }: { records: Transaction[]; categories: Map<string, string>; stages: Map<string, string>; busyId: string; onRestore: (record: Transaction) => void; onDelete: (record: Transaction) => void }) {
  if (!records.length) return <div className="table-empty"><div className="empty-icon"><ArchiveRestore size={24} /></div><b>المهملات فارغة</b><span>أي عملية تحذفها ستظهر هنا ويمكن استعادتها.</span></div>;
  return <div className="table-scroll"><table className="transaction-table trash-table"><thead><tr><th>النوع</th><th>البيان</th><th>التصنيف</th><th>المرحلة</th><th>التاريخ</th><th>المبلغ</th><th>الإجراءات</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td><span className={`type-badge ${record.type}`}><span />{record.type === 'income' ? 'قبض' : 'صرف'}</span></td><td><div className="transaction-description">{normalizeDigits(record.description)}<small>{normalizeDigits(record.person || 'بدون اسم')}</small></div></td><td>{normalizeDigits(categories.get(record.categoryId ?? '') ?? '—')}</td><td>{normalizeDigits(stages.get(record.stageId ?? '') ?? '—')}</td><td className="date-cell">{compactDate.format(new Date(`${record.date}T12:00:00`))}</td><td><strong className={`table-amount ${record.type}`} dir="ltr"><bdi>{formatAmount(record.amount)}</bdi><small>د.ع</small></strong></td><td><div className="trash-actions"><button className="outline-button" disabled={!!busyId} onClick={() => onRestore(record)}><ArchiveRestore size={14} />استعادة</button><button className="danger-outline" disabled={!!busyId} onClick={() => onDelete(record)} aria-label="حذف نهائي">{busyId === record.id ? '...' : <Trash2 size={15} />}</button></div></td></tr>)}</tbody></table></div>;
}

function FontPicker({ role, title, description, value, onChange }: { role: keyof FontPreferences; title: string; description: string; value: FontStyleId; onChange: (font: FontStyleId) => void }) {
  const fieldId = `font-picker-${role}`;
  const selected = FONT_OPTIONS.find((option) => option.id === value) ?? FONT_OPTIONS[0];
  return <section className="content-card font-picker-card"><div className="font-picker-heading"><div><h3>{title}</h3><p>{description}</p></div><span className="font-selected-name">{selected.label}</span></div><label className="font-select-label" htmlFor={fieldId}>نوع الخط</label><select id={fieldId} className="font-select" value={value} onChange={(event) => onChange(event.target.value as FontStyleId)}>{FONT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><div className="font-preview" style={{ fontFamily: fontFamilyFor(value) }} aria-live="polite"><span>معاينة الخط · <bdi>{selected.family}</bdi></span><strong>{selected.label} — بيتي</strong><p>بيتُنا يبدأ بخطوة، وكل مصروف له حساب</p><small>إجمالي البناء: 123,456 د.ع</small></div></section>;
}

function SettingsGroup({ title, description, icon, items, kind, newValue, onValue, onAdd, onRename, onDelete }: {
  title: string; description: string; icon: React.ReactNode; items: NamedOption[]; kind: 'category' | 'stage'; newValue: string; onValue: (value: string) => void; onAdd: () => void;
  onRename: (item: NamedOption, kind: 'category' | 'stage') => void; onDelete: (item: NamedOption, kind: 'category' | 'stage') => void;
}) {
  return <section className="content-card settings-group"><div className="section-header"><div className="settings-title">{icon}<div><h2>{title}</h2><p>{description}</p></div></div><span className="item-count">{formatAmount(items.length)}</span></div><form className="option-add" onSubmit={(e) => { e.preventDefault(); onAdd(); }}><label className="sr-only" htmlFor={`add-${kind}`}>إضافة {title}</label><input id={`add-${kind}`} value={newValue} onChange={(e) => onValue(normalizeDigits(e.target.value))} placeholder={`اكتب ${title === 'التصنيفات' ? 'تصنيفاً جديداً' : 'مرحلة جديدة'}`} /><button className="primary-button" type="submit" disabled={!newValue.trim()}><Plus size={16} />إضافة</button></form><ul className="option-list">{items.map((item) => <li key={item.id}><span>{normalizeDigits(item.name)}</span><div><button className="icon-button" onClick={() => onRename(item, kind)} aria-label={`تعديل ${normalizeDigits(item.name)}`}><Pencil size={15} /></button><button className="icon-button delete-icon" onClick={() => onDelete(item, kind)} aria-label={`حذف ${normalizeDigits(item.name)}`}><Trash2 size={15} /></button></div></li>)}</ul></section>;
}

export default App;
