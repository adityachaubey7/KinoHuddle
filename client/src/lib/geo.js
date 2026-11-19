/** Country / language helpers. Names come from the browser's Intl data, so they localise for free. */

export const COUNTRY_CODES = [
  'IN', 'US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'IT', 'PT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI',
  'PL', 'CZ', 'GR', 'TR', 'RU', 'UA', 'BR', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EG', 'SA', 'AE', 'IL', 'IR', 'PK', 'BD',
  'LK', 'NP', 'ID', 'MY', 'SG', 'TH', 'VN', 'PH', 'JP', 'KR', 'CN', 'TW', 'HK', 'NG', 'KE', 'ZA', 'GH', 'MA', 'DZ', 'ET',
];

export const LANGUAGE_CODES = [
  'en', 'hi', 'es', 'fr', 'ar', 'pt', 'de', 'ja', 'id', 'ru', 'zh', 'ko', 'tr', 'it', 'bn', 'ur', 'ta', 'te', 'mr', 'th', 'vi', 'pl', 'nl',
];

export const TOPICS = ['general', 'movies', 'anime', 'cartoons', 'music', 'sports', 'gaming'];
export const TOPIC_LABEL = {
  general: 'Hangout', movies: 'Movies', anime: 'Anime', cartoons: 'Cartoons', music: 'Music', sports: 'Sports', gaming: 'Gaming',
};
export const TOPIC_EMOJI = { general: '💬', movies: '🎬', anime: '🌸', cartoons: '🐰', music: '🎵', sports: '⚽', gaming: '🎮' };

export const flag = (cc) =>
  cc && /^[A-Za-z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '🌍';

/** The browser's language as a valid BCP-47 tag. Some systems report things like "en-US@posix", which Intl rejects. */
export function locale() {
  const raw = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  try {
    return Intl.getCanonicalLocales(raw.split('@')[0].replace(/_/g, '-'))[0] || 'en';
  } catch {
    return 'en';
  }
}

export function countryName(cc) {
  if (!cc) return 'Worldwide';
  try {
    return new Intl.DisplayNames([locale()], { type: 'region' }).of(cc.toUpperCase()) || cc;
  } catch {
    return cc;
  }
}

export function languageName(code) {
  if (!code || code === 'multi') return 'Any language';
  try {
    return new Intl.DisplayNames([locale()], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

/** Sorted [code, name] pairs for <select>s. */
export const countryOptions = () =>
  COUNTRY_CODES.map((c) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1], locale()));
export const languageOptions = () =>
  LANGUAGE_CODES.map((c) => [c, languageName(c)]).sort((a, b) => a[1].localeCompare(b[1], locale()));

/** Best-guess defaults from the browser; the person can always change them. */
export function guessLanguage() {
  const l = (locale().split('-')[0] || 'en').toLowerCase();
  return LANGUAGE_CODES.includes(l) ? l : 'multi';
}
export function guessCountry() {
  const region = locale().split('-')[1]?.toUpperCase();
  return region && COUNTRY_CODES.includes(region) ? region : '';
}
