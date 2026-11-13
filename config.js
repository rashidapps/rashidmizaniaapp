// إعدادات التطبيق الثابتة. عند إصدار نسخة جديدة: غيّر APP_VERSION هنا وVERSION في sw.js معاً.
export const APP_VERSION = '1.0.0';
export const APP_ID = 'mizaniyati';
export const DB_NAME = 'mizaniyati-db';
// ارفع هذا الرقم عند تغيير هيكل قاعدة البيانات، وأضف دالة ترحيل في db.js (MIGRATIONS).
export const DB_VERSION = 1;
export const CURRENCY_LABEL = 'ر.ع.';
export const DEFAULT_CATEGORIES = ['مطعم', 'قهوة', 'وقود', 'تسوق', 'مشتريات شخصية', 'ترفيه', 'مصاريف طارئة', 'أخرى'];
export const UNCATEGORIZED = 'غير مصنف';
export const BANK_PLACEHOLDER_NAME = 'عملية بنكية';
