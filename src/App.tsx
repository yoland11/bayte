import { useEffect, useMemo, useState, useLayoutEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownLeft, ArrowUpLeft, BarChart3, CalendarDays, Check, ChevronDown, CirclePlus, Download,
  FileDown, FileSpreadsheet, Filter, HardHat, Home, ImagePlus, Menu, MoreHorizontal, Pencil,
  Plus, Search, Settings, Trash2, TrendingDown, TrendingUp, Wallet, X, ReceiptText
} from 'lucide-react';
import { db, deleteTransaction, saveTransaction, seedOptions } from './lib/db';
import { formatAmount, formatCurrency, normalizeDigits, parseAmount, summarizeTransactions, sumAmounts } from './lib/money';
import { DEFAULT_FONT_PREFERENCES, FONT_OPTIONS, FONT_PREFERENCES_STORAGE_KEY, fontFamilyFor, parseFontPreferences, type FontPreferences, type FontStyleId } from './lib/fonts';
import { buildPdfReportHtml } from './lib/pdfReport';
import { filterAndSortTransactions, getPeriodBounds, type Period, type TransactionFilters } from './lib/transactions';
import type { NamedOption, Transaction, TransactionType } from './lib/types';

const navItems = [
  { id: 'home', label: 'الرئيسية', icon: Home },
  { id: 'transactions', label: 'العمليات', icon: ReceiptText },
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
  const transactions = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []) ?? [];
  const categories = useLiveQuery(async () => (await db.categories.orderBy('createdAt').toArray()).sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'ar')), []) ?? [];
  const stages = useLiveQuery(async () => (await db.stages.orderBy('createdAt').toArray()).sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'ar')), []) ?? [];
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

  function changeFontPreference(role: keyof FontPreferences, font: FontStyleId) {
    const next = { ...fontPreferences, [role]: font };
    setFontPreferences(next);
    try { window.localStorage.setItem(FONT_PREFERENCES_STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the live selection for this session if storage is unavailable. */ }
  }

  useEffect(() => { void seedOptions(); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const summary = useMemo(() => summarizeTransactions(transactions), [transactions]);
  const byId = useMemo(() => new Map(categories.map((item) => [item.id, normalizeDigits(item.name)])), [categories]);
  const stageById = useMemo(() => new Map(stages.map((item) => [item.id, normalizeDigits(item.name)])), [stages]);
  const visibleTransactions = useMemo(() => filterAndSortTransactions(transactions, filters), [transactions, filters]);
  const reportBounds = useMemo(() => getPeriodBounds(period, new Date(), periodFrom, periodTo), [period, periodFrom, periodTo]);
  const reportTransactions = useMemo(() => filterAndSortTransactions(transactions, { query: '', type: reportType, ...reportBounds, sort: 'newest' }), [transactions, reportBounds, reportType]);
  const recentTransactions = transactions.slice(0, 5);

  const showCreate = (type?: TransactionType) => setDialog({ mode: 'create', type });
  const onSaved = (message: string) => { setDialog(null); setToast(message); };
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
          { header: 'المورد / الشخص', key: 'person', width: 24 }, { header: 'الملاحظات', key: 'notes', width: 34 }
        ];
        transactionsSheet.addRows(records.map((row) => ({
          type: row.type === 'income' ? 'قبض' : 'صرف', description: normalizeDigits(row.description), amount: row.amount,
          date: new Date(`${row.date}T12:00:00`), category: normalizeDigits(byId.get(row.categoryId ?? '') ?? ''), stage: normalizeDigits(stageById.get(row.stageId ?? '') ?? ''), person: normalizeDigits(row.person ?? ''), notes: normalizeDigits(row.notes ?? '')
        })));
        transactionsSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(records.length + 1, 1), column: 8 } };
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
            const widths = [12, 34, 19, 16, 20, 22, 24, 34];
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
          records: records.map((row) => ({
            type: row.type,
            description: normalizeDigits(row.description),
            amount: row.amount,
            date: formatDate(row.date),
            category: normalizeDigits(byId.get(row.categoryId ?? '') ?? '—'),
            stage: normalizeDigits(stageById.get(row.stageId ?? '') ?? '—'),
            person: normalizeDigits(row.person ?? '—')
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

  return <div className="app-shell" style={{ '--font-primary': fontFamilyFor(fontPreferences.primary), '--font-secondary': fontFamilyFor(fontPreferences.secondary) } as React.CSSProperties}>
    <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><HardHat size={23} /></span><span><b>بيتي</b><small>متابعة بناء البيت</small></span></div>
      <div className="house-chip"><span className="house-dot" />مشروع البيت الوحيد</div>
      <nav aria-label="القائمة الرئيسية">
        <span className="nav-caption">القائمة</span>
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => changePage(id)} aria-current={page === id ? 'page' : undefined}><Icon size={19} /><span>{label}</span>{id === 'transactions' && transactions.length > 0 && <small>{formatAmount(transactions.length)}</small>}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span><Wallet size={17} /></span><div><b>كل حسابات بيتك</b><small>في مكان واحد</small></div></div><small className="version">بيتي · النسخة المحلية</small></div>
    </aside>

    <main id="main-content" className="main-area">
      <header className="topbar"><div className="topbar-heading"><button className="mobile-menu icon-button" aria-label="فتح القائمة" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20} /></button><div className="breadcrumbs"><span>بيتي</span><span className="crumb-separator">/</span><strong>{pageTitle}</strong></div></div><div className="topbar-actions"><span className="today-chip"><CalendarDays size={15} />{dateFormatter.format(new Date())}</span><button className="primary-button top-add" onClick={() => showCreate()}><Plus size={17} /> إضافة عملية</button></div></header>
      {mobileMenu && <div className="mobile-menu-panel"><div className="mobile-menu-head"><b>بيتي</b><button className="icon-button" onClick={() => setMobileMenu(false)} aria-label="إغلاق القائمة"><X size={18} /></button></div>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => changePage(id)}><Icon size={18} /><span>{label}</span></button>)}</div>}

      {page === 'home' && <section className="page-content dashboard-page">
        <div className="page-heading"><div><p className="eyebrow">متابعة بناء البيت</p><h1>الرئيسية</h1><p className="page-subtitle">نظرة سريعة على حركة أموال بيتك</p></div><button className="secondary-button desktop-export" onClick={() => exportFile('excel', transactions, 'كل الفترات')}><Download size={17} />تصدير البيانات</button></div>
        <section className="summary-grid" aria-label="ملخص الحسابات">
          <article className="balance-card"><div className="balance-top"><div className="balance-label"><span className="balance-icon"><Wallet size={20} /></span><span>الرصيد الحالي</span></div><span className="balance-period">من بداية البناء</span></div><strong className="balance-value" dir="ltr"><bdi>{formatAmount(summary.balance)}</bdi><small>د.ع</small></strong><div className="balance-bottom"><span>إجمالي القبض ناقص إجمالي الصرف</span><span className="balance-mark"><Check size={15} />محدّث</span></div></article>
          <article className="metric-card income-card"><div className="metric-top"><span className="metric-icon"><TrendingUp size={19} /></span><span className="metric-arrow"><ArrowDownLeft size={15} /></span></div><span className="metric-label">إجمالي القبض</span><strong className="metric-value" dir="ltr"><bdi>{formatAmount(summary.income)}</bdi><small>د.ع</small></strong><span className="metric-foot">مجموع المبالغ المستلمة</span></article>
          <article className="metric-card expense-card"><div className="metric-top"><span className="metric-icon"><TrendingDown size={19} /></span><span className="metric-arrow"><ArrowUpLeft size={15} /></span></div><span className="metric-label">إجمالي الصرف</span><strong className="metric-value" dir="ltr"><bdi>{formatAmount(summary.expenses)}</bdi><small>د.ع</small></strong><span className="metric-foot">مجموع مصاريف البناء</span></article>
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

      {page === 'reports' && <section className="page-content reports-page">
        <div className="page-heading"><div><p className="eyebrow">ملخص ومراجعة</p><h1>التقارير</h1><p className="page-subtitle">ملخص مالي ومصاريف البناء حسب التصنيف والمرحلة</p></div><div className="export-menu"><button className="secondary-button" onClick={() => document.getElementById('export-options')?.classList.toggle('open')} disabled={!!exporting}><Download size={17} />{exporting ? 'جاري إنشاء الملف…' : 'تصدير'}<ChevronDown size={15} /></button><div id="export-options" className="export-options"><button onClick={() => { void exportFile('pdf', reportTransactions, `${reportLabel} · النوع: ${reportType === 'all' ? 'الكل' : reportType === 'income' ? 'قبض' : 'صرف'}`); document.getElementById('export-options')?.classList.remove('open'); }}><FileDown size={16} />تنزيل النتائج بصيغة PDF</button><button onClick={() => { void exportFile('excel', reportTransactions, `${reportLabel} · النوع: ${reportType === 'all' ? 'الكل' : reportType === 'income' ? 'قبض' : 'صرف'}`); document.getElementById('export-options')?.classList.remove('open'); }}><FileSpreadsheet size={16} />تنزيل جدول النتائج</button><span className="export-divider" /><button onClick={() => { void exportFile('pdf', transactions, 'كل العمليات'); document.getElementById('export-options')?.classList.remove('open'); }}><FileDown size={16} />تقرير PDF لكل العمليات</button><button onClick={() => { void exportFile('excel', transactions, 'كل العمليات'); document.getElementById('export-options')?.classList.remove('open'); }}><FileSpreadsheet size={16} />جدول لكل العمليات</button></div></div></div>
        <section className="report-filter content-card"><div className="report-filter-title"><Filter size={17} /><b>تصفية التقرير</b></div><label>الفترة<select className="plain-select" value={period} onChange={(e) => setPeriod(e.target.value as Period)}><option value="today">اليوم</option><option value="week">هذا الأسبوع</option><option value="month">هذا الشهر</option><option value="year">هذه السنة</option><option value="custom">نطاق مخصص</option><option value="all">كل الفترات</option></select></label>{period === 'custom' && <><label>من<input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} /></label><label>إلى<input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} /></label></>}<label>النوع<select className="plain-select" value={reportType} onChange={(e) => setReportType(e.target.value as TransactionFilters['type'])}><option value="all">الكل</option><option value="income">قبض</option><option value="expense">صرف</option></select></label><span className="result-count">{formatAmount(reportTransactions.length)} عملية</span></section>
        {exportError && <p className="error-banner" role="alert">{exportError}</p>}
        <section className="report-summary-grid"><SummaryTile label="إجمالي القبض" value={summarizeTransactions(reportTransactions).income} kind="income" /><SummaryTile label="إجمالي الصرف" value={summarizeTransactions(reportTransactions).expenses} kind="expense" /><SummaryTile label="الرصيد الحالي" value={summarizeTransactions(reportTransactions).balance} kind="balance" /></section>
        <div className="report-columns"><ReportBreakdown title="الصرف حسب التصنيف" options={categories} records={reportTransactions} field="categoryId" /><ReportBreakdown title="الصرف حسب المرحلة" options={stages} records={reportTransactions} field="stageId" /></div>
        <section className="content-card report-periods"><div className="section-header"><div><h2>حركة الفترة المحددة</h2><p>{reportLabel}</p></div></div><div className="period-totals"><div><span className="period-dot income-dot" />القبض في الفترة<strong>{formatCurrency(summarizeTransactions(reportTransactions).income)}</strong></div><div><span className="period-dot expense-dot" />الصرف في الفترة<strong>{formatCurrency(summarizeTransactions(reportTransactions).expenses)}</strong></div></div></section>
      </section>}

      {page === 'settings' && <SettingsPage categories={categories} stages={stages} transactions={transactions} onToast={setToast} fontPreferences={fontPreferences} onFontPreferenceChange={changeFontPreference} />}
      <footer className="app-footer">بيتي <span>·</span> متابعة أموال بناء البيت</footer>
    </main>

    <nav className="bottom-nav" aria-label="التنقل السريع">{navItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => changePage(id)} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined}><Icon size={19} /><span>{label}</span></button>)}</nav>
    {dialog && <TransactionDialog key={dialog.record?.id ?? `new-${dialog.type ?? ''}`} mode={dialog.mode} record={dialog.record} initialType={dialog.type} categories={categories} stages={stages} onClose={() => setDialog(null)} onSaved={onSaved} onDeleted={() => { setDialog(null); setToast('تم حذف العملية بنجاح'); }} onEdit={() => setDialog({ mode: 'edit', record: dialog.record })} />}
    <div className="toast" role="status" aria-live="polite" aria-atomic="true">{toast}</div>
  </div>;
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

function TransactionDialog({ mode, record, initialType, categories, stages, onClose, onSaved, onDeleted, onEdit }: {
  mode: 'create' | 'edit' | 'detail'; record?: Transaction; initialType?: TransactionType; categories: NamedOption[]; stages: NamedOption[];
  onClose: () => void; onSaved: (message: string) => void; onDeleted: () => void; onEdit: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const storedAttachment = useLiveQuery(async () => record?.attachmentId ? await db.attachments.get(record.attachmentId) : undefined, [record?.attachmentId]);
  const [type, setType] = useState<TransactionType>(record?.type ?? initialType ?? 'expense');
  const [amount, setAmount] = useState(record ? formatAmount(record.amount) : '');
  const [description, setDescription] = useState(normalizeDigits(record?.description ?? ''));
  const [date, setDate] = useState(record?.date ?? todayISO());
  const [categoryId, setCategoryId] = useState(record?.categoryId ?? '');
  const [stageId, setStageId] = useState(record?.stageId ?? '');
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
  const attachmentURL = useMemo(() => hasAttachment && storedAttachment ? URL.createObjectURL(storedAttachment.blob) : null, [storedAttachment, hasAttachment]);
  useEffect(() => () => { if (attachmentURL) URL.revokeObjectURL(attachmentURL); }, [attachmentURL]);

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
      ...(person.trim() ? { person: normalizeDigits(person.trim()) } : {}), ...(notes.trim() ? { notes: normalizeDigits(notes.trim()) } : {}),
      createdAt: record?.createdAt ?? now, updatedAt: now
    };
    try {
      if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('invalid-file');
      await saveTransaction(next, file, removeFile);
      onSaved(mode === 'edit' ? 'تم تعديل العملية بنجاح' : 'تم حفظ العملية بنجاح');
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error && cause.message === 'invalid-file' ? 'الملف غير مدعوم، استخدم JPG أو PNG أو WEBP' : file ? 'تعذر رفع الصورة، حاول مرة أخرى' : 'تعذر حفظ العملية، حاول مرة أخرى');
      setBusy(false);
    }
  }

  async function deleteCurrent() {
    if (!record || !window.confirm('هل أنت متأكد من حذف هذه العملية؟')) return;
    setBusy(true);
    try { await deleteTransaction(record.id); onDeleted(); }
    catch (cause) { console.error(cause); setError('تعذر حذف العملية، حاول مرة أخرى'); setBusy(false); }
  }

  const labels = type === 'income' ? { title: 'إضافة قبض', person: 'المصدر / الشخص', file: 'صورة داعمة' } : { title: 'إضافة صرف', person: 'المورد / الشخص', file: 'فاتورة أو وصل' };
  const modalTitle = isDetail ? (record?.type === 'income' ? 'تفاصيل القبض' : 'تفاصيل الصرف') : mode === 'edit' ? 'تعديل العملية' : labels.title;
  const close = () => { if (!busy) onClose(); };

  return <dialog ref={dialogRef} className="transaction-dialog" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialogRef.current) close(); }} aria-labelledby="transaction-dialog-title">
    <div className="dialog-head"><div><span className={`dialog-type-icon ${type}`}>{type === 'income' ? <ArrowDownLeft size={18} /> : <ArrowUpLeft size={18} />}</span><div><h2 id="transaction-dialog-title">{modalTitle}</h2><p>{isDetail ? 'معلومات العملية المالية' : 'أدخل تفاصيل العملية'}</p></div></div><button className="icon-button" onClick={close} aria-label="إغلاق النافذة"><X size={19} /></button></div>
    {isDetail && record ? <div className="details-content">
      <div className={`details-amount ${record.type}`}><span>{record.type === 'income' ? 'مبلغ القبض' : 'مبلغ الصرف'}</span><strong dir="ltr"><bdi>{formatAmount(record.amount)}</bdi><small>د.ع</small></strong></div>
      <div className="details-grid"><DetailItem label="البيان" value={normalizeDigits(record.description)} /><DetailItem label="التاريخ" value={formatDate(record.date)} /><DetailItem label="التصنيف" value={normalizeDigits(categories.find((item) => item.id === record.categoryId)?.name ?? '—')} /><DetailItem label="المرحلة" value={normalizeDigits(stages.find((item) => item.id === record.stageId)?.name ?? '—')} /><DetailItem label={record.type === 'income' ? 'المصدر / الشخص' : 'المورد / الشخص'} value={normalizeDigits(record.person || '—')} /><DetailItem label="الملاحظات" value={normalizeDigits(record.notes || '—')} wide /></div>
      {hasAttachment && (attachmentURL || storedAttachment) && <div className="detail-attachment"><span className="field-label">الفاتورة / الصورة</span><a href={attachmentURL ?? undefined} target="_blank" rel="noreferrer" className="attachment-preview"><img src={attachmentURL ?? ''} alt={normalizeDigits(storedAttachment?.fileName ?? 'صورة مرفقة')} /><span>{normalizeDigits(storedAttachment?.fileName ?? '')} <Download size={15} /></span></a></div>}
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
          <div className="form-field form-wide"><label htmlFor="person">{labels.person} <span className="optional">اختياري</span></label><input id="person" value={person} onChange={(e) => setPerson(normalizeDigits(e.target.value))} placeholder="اسم المورد أو الشخص" /></div>
          <div className="form-field form-wide"><label htmlFor="notes">الملاحظات <span className="optional">اختياري</span></label><textarea id="notes" value={notes} onChange={(e) => setNotes(normalizeDigits(e.target.value))} placeholder="أضف ملاحظة إذا لزم الأمر" rows={3} /></div>
          <div className="form-field form-wide"><span className="field-label">{labels.file} <span className="optional">اختياري</span></span><input ref={fileInputRef} className="sr-only" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(e) => { const selected = e.target.files?.[0] ?? null; if (selected && !['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) { setError('الملف غير مدعوم، استخدم JPG أو PNG أو WEBP'); e.currentTarget.value = ''; return; } setError(''); setFile(selected); if (selected) setRemoveFile(false); }} /><div className="upload-row"><button type="button" className="upload-button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={17} />{file ? 'تغيير الصورة' : hasAttachment ? 'استبدال الصورة' : 'اختيار صورة'}</button><small>JPG أو PNG أو WEBP</small></div>
            {(localPreview || (hasAttachment && attachmentURL)) && <div className="new-file-preview"><img src={localPreview ?? attachmentURL ?? ''} alt="معاينة الصورة المرفقة" /><span>{normalizeDigits(file?.name ?? storedAttachment?.fileName ?? '')}</span><button type="button" className="remove-file" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; if (storedAttachment) setRemoveFile(true); }} aria-label="حذف الصورة"><X size={16} /></button></div>}
          </div>
        </div>
        {error && <p className="error-banner" role="alert">{error}</p>}
      </div>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={close}>إلغاء</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'جاري الحفظ…' : <><Check size={16} />{mode === 'edit' ? 'حفظ التعديلات' : 'حفظ العملية'}</>}</button></div>
    </form>}
  </dialog>;
}

function DetailItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) { return <div className={`detail-item ${wide ? 'wide' : ''}`}><span>{label}</span><b>{value}</b></div>; }

function SettingsPage({ categories, stages, transactions, onToast, fontPreferences, onFontPreferenceChange }: { categories: NamedOption[]; stages: NamedOption[]; transactions: Transaction[]; onToast: (message: string) => void; fontPreferences: FontPreferences; onFontPreferenceChange: (role: keyof FontPreferences, font: FontStyleId) => void }) {
  const [newCategory, setNewCategory] = useState('');
  const [newStage, setNewStage] = useState('');
  async function addOption(kind: 'category' | 'stage') {
    const value = normalizeDigits(kind === 'category' ? newCategory.trim() : newStage.trim());
    if (!value) return;
    const collection = kind === 'category' ? db.categories : db.stages;
    const duplicate = await collection.where('name').equals(value).first();
    if (duplicate) { onToast('هذا الاسم موجود مسبقاً'); return; }
    const now = Date.now(); await collection.add({ id: crypto.randomUUID(), name: value, createdAt: now, updatedAt: now });
    if (kind === 'category') setNewCategory(''); else setNewStage('');
    onToast('تمت الإضافة بنجاح');
  }
  async function renameOption(item: NamedOption, kind: 'category' | 'stage') {
    const value = normalizeDigits(window.prompt('اكتب الاسم الجديد', normalizeDigits(item.name))?.trim() ?? '');
    if (!value || value === item.name) return;
    const collection = kind === 'category' ? db.categories : db.stages;
    const duplicate = await collection.where('name').equals(value).first();
    if (duplicate) { onToast('هذا الاسم موجود مسبقاً'); return; }
    await collection.update(item.id, { name: value, updatedAt: Date.now() }); onToast('تم تعديل الاسم');
  }
  async function deleteOption(item: NamedOption, kind: 'category' | 'stage') {
    const inUse = transactions.some((record) => kind === 'category' ? record.categoryId === item.id : record.stageId === item.id);
    if (inUse) { onToast('لا يمكن حذف عنصر مستخدم في عملية مسجلة'); return; }
    if (!window.confirm(`هل تريد حذف «${normalizeDigits(item.name)}»؟`)) return;
    await (kind === 'category' ? db.categories : db.stages).delete(item.id); onToast('تم الحذف بنجاح');
  }
  return <section className="page-content settings-page"><div className="page-heading"><div><p className="eyebrow">تهيئة التطبيق</p><h1>الإعدادات</h1><p className="page-subtitle">إدارة التصنيفات ومراحل البناء والخطوط</p></div></div><div className="settings-grid"><SettingsGroup title="التصنيفات" description="تصنيفات المصاريف المستخدمة" icon={<ReceiptText size={18} />} items={categories} kind="category" newValue={newCategory} onValue={setNewCategory} onAdd={() => void addOption('category')} onRename={renameOption} onDelete={deleteOption} /><SettingsGroup title="مراحل البناء" description="مراحل تنفيذ البيت" icon={<HardHat size={18} />} items={stages} kind="stage" newValue={newStage} onValue={setNewStage} onAdd={() => void addOption('stage')} onRename={renameOption} onDelete={deleteOption} /></div><section className="font-settings-section" aria-labelledby="font-settings-title"><div className="section-header"><div><h2 id="font-settings-title">التحكم بالخطوط</h2><p>اختر خطاً مستقلاً للعناوين وللنصوص المساندة</p></div><span className="font-section-icon" aria-hidden="true">Aa</span></div><div className="font-settings-grid"><FontPicker role="primary" title="النصوص الرئيسية" description="العناوين والأسماء البارزة" value={fontPreferences.primary} onChange={(font) => onFontPreferenceChange('primary', font)} /><FontPicker role="secondary" title="النصوص الثانوية" description="النصوص والوصف والقوائم" value={fontPreferences.secondary} onChange={(font) => onFontPreferenceChange('secondary', font)} /></div><p className="font-note">تعرض المعاينة نماذج رقمية قريبة من أسماء الخطوط التقليدية، وقد يختلف رسم بعض الخطوط عن النسخ الخطية الأصلية.</p></section><div className="local-data-note"><span><Wallet size={18} /></span><div><b>بياناتك محفوظة على هذا الجهاز</b><p>تُحفظ العمليات والصور محلياً في هذا المتصفح. صدّر نسخة من جدول البيانات للاحتفاظ بنسخة خارجية.</p></div></div></section>;
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
