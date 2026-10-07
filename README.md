# بيتي — متابعة حسابات بناء المنزل

تطبيق عربي باتجاه RTL لإدارة قبض وصرف مشروع بناء المنزل، مع تقارير PDF وExcel وخطوط قابلة للتخصيص. يعتمد التطبيق على React وVite وTypeScript، ويستخدم Supabase Auth وPostgreSQL وStorage لحفظ بيانات الحساب السحابي.

## التشغيل محلياً

```sh
npm install
cp .env.example .env.local
npm run dev
```

ضع عنوان مشروع Supabase والمفتاح العام في `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

يمكن استخدام `VITE_SUPABASE_ANON_KEY` بدلاً من `VITE_SUPABASE_PUBLISHABLE_KEY` للمشاريع التي ما زالت تعرض مفتاح anon القديم. كلاهما مفتاح واجهة عامة؛ لا تضع `service_role` أو أي سر في متغير يبدأ بـ `VITE_`.

## إعداد Supabase

1. أنشئ مشروع Supabase واضبط تسجيل البريد وكلمة المرور وروابط إعادة التوجيه المسموحة (`http://localhost:5173`، وإذا كان تشغيلك على المنفذ الحالي فأضف `http://localhost:4173`، وعنوان Vercel المنشور).
2. ثبّت Supabase CLI ثم اربط المشروع:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. ستنشئ migration الجداول والسياسات وBucket الخاص. فعّل البريد الإلكتروني أو أوقف تأكيد البريد حسب سياسة مشروعك.
4. أضف متغيرات الاتصال إلى `.env.local` ثم أعد تشغيل Vite.

لا تستخدم `supabase db reset` على مشروع سحابي. لا يوجد seed إنتاجي؛ اختبار المجاميع المالية يعمل على بيانات اختبار داخل Vitest فقط.

## قاعدة البيانات والأمان

Migrations are applied in order from `supabase/migrations/`:

- `20261007000100_bayti_cloud.sql` creates the initial cloud schema and owner policies.
- `20261008000100_bayti_clients_trash_settings.sql` adds client records and statements, recoverable transaction deletion, logo storage, and dashboard preferences. It is additive and keeps existing transactions.

- الجداول: `profiles`, `projects`, `transactions`, `categories`, `construction_stages`, `attachments`.
- كل جدول يفعّل RLS، وتقتصر القراءة والكتابة على `auth.uid() = user_id`.
- المفاتيح الأجنبية المركبة تربط السجل بالمشروع والمالك نفسه.
- Bucket `transaction-attachments` خاص، يسمح بالصور وPDF حتى 10 ميغابايت، وسياسة التخزين تقصر مسار الملف على مجلد صاحب الحساب.
- العملاء وكشوف الحساب مرتبطة بمعرف المالك والمشروع نفسه. الحذف العادي ينقل العملية إلى المهملات، والاستعادة تعيدها إلى الأرصدة؛ الحذف النهائي من المهملات يحذف المرفق المرتبط أيضاً.
- شعار النظام محفوظ في Bucket خاص، وحجم بطاقات الرئيسية وترتيبها محفوظان في إعدادات المشروع.
- لا توجد مفاتيح خادم أو صلاحيات `service_role` في المتصفح.

## نقل بيانات المتصفح

قاعدة IndexedDB القديمة (`bayti-house-tracker`) تبقى كما هي. بعد تسجيل الدخول، افتح **الإعدادات**:

1. نزّل ملف النسخة الاحتياطية JSON. يحتوي على العمليات والتصنيفات والمراحل والمرفقات بصيغة Base64.
2. اختر الملف نفسه للاستيراد إلى مشروع الحساب السحابي ووافق على رسالة النقل.
3. تُحفظ البيانات محليًا ولا تُحذف بعد النقل. يمكن إعادة الاستيراد؛ أرقام العمليات الأصلية محفوظة، والتصنيفات المتطابقة تُربط بدل تكرارها.

يجب أن يكون المرفق ضمن الأنواع المسموحة وحجمه 10 ميغابايت أو أقل. النسخ الأكبر تبقى في IndexedDB ويمكن الاحتفاظ بها في ملف النسخة الاحتياطية.

## Vercel

راجع [دليل إعداد Vercel](./VERCEL_SETUP.md) لربط GitHub، إعداد Vite، إضافة متغيرات Supabase العامة، وضبط روابط Auth.

## الاختبارات

```sh
npm test
npm run build
```

اختبار RLS لعمليتين ومستخدمين موجود في `supabase/tests/database/transactions_rls.test.sql`. لتشغيله محلياً ثبّت Docker ثم شغّل `supabase start` و`supabase test db`. تغطي اختبارات Vitest تنسيق المبالغ بالأرقام الإنجليزية وتحويل العربية/الفارسية، المجاميع الدقيقة، الفلاتر، النسخ الاحتياطي، الخطوط وبناء HTML التقرير. تتطلب اختبارات الدخول وStorage ورفع PDF/Excel والنقل بين الأجهزة بيانات مشروع Supabase ومستخدمين اختباريين؛ لم تُنفّذ على مشروع فعلي في هذه النسخة.
