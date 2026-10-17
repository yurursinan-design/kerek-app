import React, { useState } from 'react';
import { emojiSrc } from '../data/serviceCatalog';
import { photoSrc } from '../data/photos';

// Literal class names so Tailwind keeps them in the build
export const TONES: Record<string, { tile: string; text: string; ring: string; glow: string }> = {
  orange: { tile: 'from-orange-50 to-orange-100', text: 'text-orange-700', ring: 'ring-orange-200', glow: 'bg-orange-300' },
  amber: { tile: 'from-amber-50 to-amber-100', text: 'text-amber-700', ring: 'ring-amber-200', glow: 'bg-amber-300' },
  sky: { tile: 'from-sky-50 to-sky-100', text: 'text-sky-700', ring: 'ring-sky-200', glow: 'bg-sky-300' },
  yellow: { tile: 'from-yellow-50 to-yellow-100', text: 'text-yellow-700', ring: 'ring-yellow-200', glow: 'bg-yellow-300' },
  red: { tile: 'from-red-50 to-red-100', text: 'text-red-700', ring: 'ring-red-200', glow: 'bg-red-300' },
  cyan: { tile: 'from-cyan-50 to-cyan-100', text: 'text-cyan-700', ring: 'ring-cyan-200', glow: 'bg-cyan-300' },
  indigo: { tile: 'from-indigo-50 to-indigo-100', text: 'text-indigo-700', ring: 'ring-indigo-200', glow: 'bg-indigo-300' },
  stone: { tile: 'from-stone-100 to-stone-200', text: 'text-stone-700', ring: 'ring-stone-200', glow: 'bg-stone-300' },
  emerald: { tile: 'from-emerald-50 to-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-200', glow: 'bg-emerald-300' },
  blue: { tile: 'from-blue-50 to-blue-100', text: 'text-blue-700', ring: 'ring-blue-200', glow: 'bg-blue-300' },
  lime: { tile: 'from-lime-50 to-lime-100', text: 'text-lime-700', ring: 'ring-lime-200', glow: 'bg-lime-300' },
  slate: { tile: 'from-slate-100 to-slate-200', text: 'text-slate-700', ring: 'ring-slate-200', glow: 'bg-slate-300' },
  pink: { tile: 'from-pink-50 to-pink-100', text: 'text-pink-700', ring: 'ring-pink-200', glow: 'bg-pink-300' },
  violet: { tile: 'from-violet-50 to-violet-100', text: 'text-violet-700', ring: 'ring-violet-200', glow: 'bg-violet-300' },
  fuchsia: { tile: 'from-fuchsia-50 to-fuchsia-100', text: 'text-fuchsia-700', ring: 'ring-fuchsia-200', glow: 'bg-fuchsia-300' },
  teal: { tile: 'from-teal-50 to-teal-100', text: 'text-teal-700', ring: 'ring-teal-200', glow: 'bg-teal-300' },
  rose: { tile: 'from-rose-50 to-rose-100', text: 'text-rose-700', ring: 'ring-rose-200', glow: 'bg-rose-300' },
  green: { tile: 'from-green-50 to-green-100', text: 'text-green-700', ring: 'ring-green-200', glow: 'bg-green-300' },
  zinc: { tile: 'from-zinc-100 to-zinc-200', text: 'text-zinc-700', ring: 'ring-zinc-200', glow: 'bg-zinc-300' },
};

export function tone(color?: string) {
  return TONES[color || ''] || TONES.sky;
}

interface Emoji3DProps {
  code: string;
  /** Rendered width and height in px */
  size: number;
  className?: string;
  style?: React.CSSProperties;
  /** Load right away (images above the fold) */
  eager?: boolean;
}

/** A 3D illustration from public/img/3d. Decorative: the text next to it carries the meaning. */
export const Emoji3D: React.FC<Emoji3DProps> = ({ code, size, className = '', style, eager }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return <span aria-hidden="true" style={{ width: size, height: size }} className={`inline-block shrink-0 ${className}`} />;
  return (
    <img
      src={emojiSrc(code)}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      style={style}
      className={`shrink-0 select-none pointer-events-none object-contain drop-shadow-sm ${className}`}
    />
  );
};

const BOX = {
  xs: { box: 'w-8 h-8 rounded-lg', img: 22 },
  sm: { box: 'w-10 h-10 rounded-xl', img: 28 },
  md: { box: 'w-12 h-12 rounded-2xl', img: 34 },
  lg: { box: 'w-16 h-16 rounded-2xl', img: 44 },
  xl: { box: 'w-20 h-20 rounded-3xl', img: 56 },
} as const;

interface PhotoProps {
  /** Name of a photo in public/img/photo (see data/photos.ts) */
  name: string;
  className?: string;
  eager?: boolean;
  alt?: string;
}

/** A photo made for the app; fills its box. Decorative unless alt is given. */
export const Photo: React.FC<PhotoProps> = ({ name, className = '', eager, alt = '' }) => {
  const [failed, setFailed] = useState(false);
  if (failed) return <span aria-hidden="true" className={`block bg-slate-200 ${className}`} />;
  return (
    <img
      src={photoSrc(name)}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={`block object-cover select-none bg-slate-200 ${className}`}
    />
  );
};

interface CategoryIconProps {
  /** 3D icon code (CatalogGroup.emoji or CatalogService.emoji) */
  emoji: string;
  color: string;
  /** Photo to show instead of the icon (data/photos.ts) */
  photo?: string;
  size?: keyof typeof BOX;
  eager?: boolean;
}

/** A small photo of the service, or a soft coloured tile with a 3D icon when there is no photo. */
export const CategoryIcon: React.FC<CategoryIconProps> = ({ emoji, color, photo, size = 'md', eager }) => {
  const b = BOX[size];
  if (photo) return <Photo name={photo} eager={eager} className={`${b.box} shrink-0 ring-1 ring-black/5`} />;
  return (
    <span className={`${b.box} bg-linear-to-br ${tone(color).tile} flex items-center justify-center shrink-0`}>
      <Emoji3D code={emoji} size={b.img} eager={eager} />
    </span>
  );
};
