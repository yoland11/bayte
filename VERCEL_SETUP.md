# ربط «بيتي» بـ Vercel

المشروع الحالي تطبيق React + Vite ثابت، ومجلد المستودع نفسه هو مجلد التطبيق. إعداد Vercel مخصص غير مطلوب؛ استخدم إعدادات البناء التالية عند استيراد GitHub:

| الإعداد | القيمة |
|---|---|
| Framework Preset | Vite |
| Root Directory | `.` |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Production Branch | `main` |

## ربط GitHub

1. افتح لوحة Vercel واختر **Add New → Project**.
2. اربط GitHub إذا طُلب ذلك، ثم استورد مستودع «بيتي» المرتبط بـ `origin` في هذا المجلد.
3. اترك Root Directory على جذر المستودع (`.`)، وتحقق من إعدادات البناء أعلاه.
4. أكمل إنشاء مشروع Vercel. ستنشئ Vercel معاينة للفروع وعمليات Pull Request، وتنشر فرع الإنتاج المحدد تلقائيًا.

لا تستخدم مشروع Vercel آخر بالاسم المشابه. قائمة الحساب الحالية لم تعرض مشروعًا باسم «بيتي»، ولا يوجد ربط Vercel محفوظ في هذا المجلد.

## متغيرات Supabase

من **Project → Settings → Environment Variables** أضف المتغيرين التاليين إلى **Production** و**Preview**. أضفهما إلى **Development** أيضًا إذا كنت ستستخدم `vercel dev`:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

استخدم القيم العامة نفسها الموجودة في `.env.local`. بادئة `VITE_` تعني أن القيم تدخل ضمن كود المتصفح؛ المفتاح publishable/anon مخصص لهذا الاستخدام. **لا تضف `service_role` أو كلمة مرور قاعدة البيانات أو أي مفتاح سري إلى متغير يبدأ بـ `VITE_` أو إلى GitHub.**

بعد إضافة المتغيرات أو تعديلها، أعد النشر حتى تُضمّن في build الجديد. لا ترفع `.env.local`؛ هو متجاهَل في `.gitignore`. إعداد متغيرات Vercel منفصل عن ملف البيئة المحلي، ومتغيرات Vite تُقرأ عند البناء. [Vercel: Vite](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel: Environment Variables](https://vercel.com/docs/environment-variables)

## إعداد روابط Supabase Auth

بعد إنشاء مشروع Vercel والحصول على عنوانه:

1. في Supabase افتح **Authentication → URL Configuration**.
2. عيّن **Site URL** إلى عنوان الإنتاج النهائي، مثل `https://اسم-المشروع.vercel.app` أو النطاق الخاص.
3. أضف عنوان الإنتاج إلى **Redirect URLs**. أضف عناوين Preview التي تريد السماح بتسجيل الدخول منها، بالإضافة إلى عناوين التطوير المحلي `http://localhost:5173/**` و`http://localhost:4173/**` عند الحاجة.
4. استخدم أضيق أنماط Preview تطابق نطاقات المشروع، ولا تسمح بنطاقات غير مملوكة لك.

## قبل إعلان الإنتاج

هذا المستودع غير مربوط حاليًا بمشروع Vercel، كما أن ربط Supabase CLI متوقف بسبب عدم امتلاك الحساب المسجل صلاحية إدارة Project Ref الموجود في `.env.local`. استورد GitHub وأنشئ إعدادات Vercel، لكن اختبر Supabase migrations وRLS وAuth وStorage على المشروع الصحيح قبل استخدام بيانات حقيقية أو اعتبار الموقع جاهزًا للإنتاج.

بعد الربط، تحقّق من إعدادات المشروع باستخدام `vercel project inspect --non-interactive`، ومن متغيرات البيئة بأسمائها فقط دون طباعة قيمها. لا تنفّذ `vercel --prod` قبل نجاح الاختبارات الوظيفية الفعلية.
