// Photos made for the app (scripts/images). PHOTO_NAMES is written by scripts/images/manifest.mjs
// from the files in public/img/photo, so the app never asks for a photo that does not exist.
import { PHOTO_NAMES } from './photoNames';

const AVAILABLE = new Set<string>(PHOTO_NAMES);

export function hasPhoto(name: string): boolean {
  return AVAILABLE.has(name);
}

export function photoSrc(name: string): string {
  return `/img/photo/${name}.webp`;
}

/** Photo of a category, if one was made */
export function groupPhoto(groupId?: string): string | undefined {
  return groupId && hasPhoto(`g_${groupId}`) ? `g_${groupId}` : undefined;
}

/** Photo of a service: its own if made, otherwise its category's */
export function servicePhoto(serviceId?: string, groupId?: string): string | undefined {
  if (serviceId && hasPhoto(`s_${serviceId}`)) return `s_${serviceId}`;
  return groupPhoto(groupId);
}
