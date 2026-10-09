# تشغيل بيتي باستخدام Docker

## المتطلبات

- Docker Desktop يعمل على macOS أو Linux أو Windows.
- Node.js غير مطلوب على الجهاز لتشغيل نسخة الإنتاج داخل Docker.
- ملف `.env.local` موجود في مجلد المشروع ويحتوي على الإعدادات العامة المطلوبة لـ Supabase:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`، أو `VITE_SUPABASE_ANON_KEY` للمشاريع التي تستخدم الاسم القديم.

قيم `VITE_*` عامة ومضمنة في JavaScript الذي يصل إلى المتصفح. لا تضع `service_role` أو كلمات مرور قواعد البيانات أو مفاتيح خاصة ضمن هذه المتغيرات.

## تشغيل نسخة الإنتاج

من مجلد المشروع:

```bash
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up -d --build
```

افتح [http://localhost:8080](http://localhost:8080). إذا كان المنفذ 8080 مستخدماً على الجهاز، شغّل نسخة الاختبار على منفذ بديل مثل 8081:

```bash
BAYTI_HOST_PORT=8081 docker compose --env-file .env.local up -d --build
```

## الإيقاف وإعادة التشغيل

```bash
docker compose stop
docker compose start
```

لإيقاف الحاوية وحذفها مع إبقاء ملفات المشروع وبيانات المتصفح:

```bash
docker compose down
```

## السجلات والحالة

```bash
docker compose ps
docker compose logs --tail=100 bayti
```

## إعادة البناء بعد تغييرات المشروع

```bash
docker compose --env-file .env.local up -d --build
```

## وضع التطوير مع التحديث المباشر

يعيد ملف التطوير استخدام اعتماديات الحاوية مع تركيب ملفات المصدر فقط، ويضع `node_modules` في مساحة مستقلة داخل الحاوية:

```bash
docker compose -p bayti-dev --env-file .env.local -f compose.dev.yaml up --build
```

افتح [http://localhost:5173](http://localhost:5173). أوقف وضع التطوير بـ `Ctrl+C`، أو أوقف خدمات المشروع بـ:

```bash
docker compose -p bayti-dev -f compose.dev.yaml down
```

## النقل إلى جهاز آخر

انسخ ملفات المشروع وملف `package-lock.json` وملفات Docker. ثبّت Docker Desktop على الجهاز الجديد وأنشئ `.env.local` بالقيم العامة الخاصة بمشروع Supabase، ثم نفّذ أوامر تشغيل الإنتاج. لا تنسخ ملف `.env.local` إلى Git أو ترسله ضمن ملفات الصورة.

الصور مبنية على Node.js 24 وNginx Alpine، وتدعم بنية Apple Silicon ARM64 عبر الصور الرسمية متعددة البنى.

## التخزين المحلي في المتصفح

Docker يقدّم ملفات الواجهة فقط؛ لا ينقل IndexedDB أو التخزين المحلي في المتصفح إلى الحاوية. بيانات Supabase تبقى في المشروع السحابي، أما أي بيانات محلية محفوظة في متصفح أو أصل مختلف فتظل مرتبطة بذلك المتصفح. استخدم النسخ الاحتياطي داخل التطبيق عند نقل بيانات المتصفح.
