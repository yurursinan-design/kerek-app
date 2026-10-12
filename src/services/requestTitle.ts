import { Language, ServiceRequest } from '../types';
import { analyzeRequestUnderstanding } from './requestUnderstanding';
import { getCategoryDisplayName, normalizeCategoryId } from './taxonomy';

/**
 * Title of a request in the viewer's language. The stored `service` text is written in the
 * language the customer had selected, so a Kazakh screen could show a Russian title. The title is
 * rebuilt from the customer's own words in the current language; when that doesn't recognise the
 * same category, the stored text is kept.
 */
const cache = new Map<string, string>();

export function getRequestTitle(
  req: Pick<ServiceRequest, 'id' | 'service' | 'requestText' | 'description' | 'categoryId' | 'category'>,
  language: Language
): string {
  const stored = (req.service || '').trim();
  const key = `${req.id}|${language}|${stored}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let title = stored;
  const reqCategory = normalizeCategoryId(req.categoryId || req.category || '');
  if (language === 'tr') {
    // The local engine writes Russian for Turkish; the category name is available in Turkish
    if (reqCategory) title = getCategoryDisplayName(reqCategory, 'tr');
  } else {
    const text = (req.requestText || req.description || '').trim();
    let rebuilt = '';
    if (text) {
      try {
        const u = analyzeRequestUnderstanding(text, { language });
        const sameCategory = u.categoryId && reqCategory && normalizeCategoryId(u.categoryId) === reqCategory;
        // The engine echoes the customer's text when it has no structured title; that is not a title
        if (sameCategory && u.service && u.service.trim() && u.service.trim() !== text) rebuilt = u.service.trim();
      } catch {
        // keep the stored title
      }
    }
    if (rebuilt) {
      title = rebuilt;
    } else if (reqCategory && stored && looksLikeOtherLanguage(stored, language)) {
      title = getCategoryDisplayName(reqCategory, language);
    }
  }

  title = title || stored || getCategoryDisplayName(reqCategory, language);
  title = title.charAt(0).toUpperCase() + title.slice(1);
  cache.set(key, title);
  return title;
}

const KAZAKH_LETTERS = /[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/;
const CYRILLIC = /[а-яё]/i;

/** Rough check: Russian text on a Kazakh screen, or Kazakh text on a Russian screen. */
function looksLikeOtherLanguage(text: string, language: Language): boolean {
  if (!CYRILLIC.test(text)) return false;
  const kazakh = KAZAKH_LETTERS.test(text);
  return language === 'kz' ? !kazakh : kazakh;
}
