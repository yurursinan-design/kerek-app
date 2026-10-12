import React from 'react';
import {
  Armchair,
  Car,
  Flame,
  GraduationCap,
  Hammer,
  HardHat,
  HeartHandshake,
  Laptop,
  PaintRoller,
  PartyPopper,
  Scale,
  Scissors,
  Snowflake,
  Sparkles,
  Trees,
  Truck,
  WashingMachine,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Armchair,
  Car,
  Flame,
  GraduationCap,
  Hammer,
  HardHat,
  HeartHandshake,
  Laptop,
  PaintRoller,
  PartyPopper,
  Scale,
  Scissors,
  Snowflake,
  Sparkles,
  Trees,
  Truck,
  WashingMachine,
  Wrench,
  Zap,
};

// Literal class names so Tailwind keeps them in the build
const TONES: Record<string, { tile: string; icon: string }> = {
  orange: { tile: 'bg-orange-100', icon: 'text-orange-600' },
  amber: { tile: 'bg-amber-100', icon: 'text-amber-700' },
  sky: { tile: 'bg-sky-100', icon: 'text-sky-600' },
  yellow: { tile: 'bg-yellow-100', icon: 'text-yellow-600' },
  red: { tile: 'bg-red-100', icon: 'text-red-600' },
  cyan: { tile: 'bg-cyan-100', icon: 'text-cyan-600' },
  indigo: { tile: 'bg-indigo-100', icon: 'text-indigo-600' },
  stone: { tile: 'bg-stone-200', icon: 'text-stone-700' },
  emerald: { tile: 'bg-emerald-100', icon: 'text-emerald-600' },
  blue: { tile: 'bg-blue-100', icon: 'text-blue-600' },
  lime: { tile: 'bg-lime-100', icon: 'text-lime-700' },
  slate: { tile: 'bg-slate-200', icon: 'text-slate-700' },
  pink: { tile: 'bg-pink-100', icon: 'text-pink-600' },
  violet: { tile: 'bg-violet-100', icon: 'text-violet-600' },
  fuchsia: { tile: 'bg-fuchsia-100', icon: 'text-fuchsia-600' },
  teal: { tile: 'bg-teal-100', icon: 'text-teal-600' },
  rose: { tile: 'bg-rose-100', icon: 'text-rose-600' },
  green: { tile: 'bg-green-100', icon: 'text-green-700' },
  zinc: { tile: 'bg-zinc-200', icon: 'text-zinc-700' },
};

interface CategoryIconProps {
  icon: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
}

/** Rounded coloured tile with the group's icon. */
export const CategoryIcon: React.FC<CategoryIconProps> = ({ icon, color, size = 'md' }) => {
  const Icon = ICONS[icon] || Sparkles;
  const tone = TONES[color] || TONES.sky;
  const box = size === 'lg' ? 'w-14 h-14 rounded-2xl' : size === 'sm' ? 'w-9 h-9 rounded-xl' : 'w-12 h-12 rounded-2xl';
  const glyph = size === 'lg' ? 'w-7 h-7' : size === 'sm' ? 'w-4.5 h-4.5' : 'w-6 h-6';
  return (
    <span className={`${box} ${tone.tile} flex items-center justify-center shrink-0`}>
      <Icon className={`${glyph} ${tone.icon}`} strokeWidth={2.2} />
    </span>
  );
};
