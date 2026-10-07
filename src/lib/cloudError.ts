const schemaErrorCodes = new Set(['PGRST202', 'PGRST205', '42P01']);

export function cloudLoadErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (typeof code === 'string' && schemaErrorCodes.has(code)) {
    return 'قاعدة بيانات «بيتي» غير مهيأة بالكامل. أعد المحاولة بعد إعداد جداول النظام.';
  }
  return 'تعذر تحميل بيانات الحساب. تحقق من الاتصال ثم أعد المحاولة.';
}
