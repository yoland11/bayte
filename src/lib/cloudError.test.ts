import { describe, expect, it } from 'vitest';
import { cloudLoadErrorMessage } from './cloudError';

describe('cloud load error messages', () => {
  it('explains when the Bayti database schema has not been installed', () => {
    expect(cloudLoadErrorMessage({ code: 'PGRST205', message: 'table not found' })).toContain('قاعدة بيانات «بيتي» غير مهيأة');
    expect(cloudLoadErrorMessage({ code: '42P01', message: 'relation does not exist' })).toContain('قاعدة بيانات «بيتي» غير مهيأة');
    expect(cloudLoadErrorMessage({ code: 'PGRST202', message: 'function not found' })).toContain('قاعدة بيانات «بيتي» غير مهيأة');
  });

  it('keeps a connection message for unrelated failures', () => {
    expect(cloudLoadErrorMessage(new Error('network unavailable'))).toBe('تعذر تحميل بيانات الحساب. تحقق من الاتصال ثم أعد المحاولة.');
  });
});
