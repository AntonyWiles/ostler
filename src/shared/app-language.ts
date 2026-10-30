/**
 * The language the interface is written in: `<html lang>` (P9.2, WCAG 3.1.1),
 * filled into index.html at build time, so screen readers pick the right
 * voice and pronunciation. A language without a region: Chromium formats
 * date fields from `lang`, and a region here would override the person's own
 * date order from Windows. Since P11.1 this is only the page's starting value:
 * the window sets `<html lang>` to the chosen language before it renders
 * (`src/renderer/i18n/LocaleProvider.tsx`).
 */
export const APP_LANGUAGE = 'en'
