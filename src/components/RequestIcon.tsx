import React from 'react';
import { getGroup, getService } from '../data/serviceCatalog';
import { normalizeCategoryId } from '../services/taxonomy';
import { groupPhoto, servicePhoto } from '../data/photos';
import { CategoryIcon } from './CategoryIcon';

type RequestLike = { serviceId?: string; categoryId?: string; category?: string };

/** Photo, 3D icon and colour of a request: its service if known, otherwise its category. */
export function requestVisual(req: RequestLike): { emoji: string; color: string; photo?: string } {
  const found = getService(req.serviceId);
  if (found) return { emoji: found.service.emoji, color: found.group.color, photo: servicePhoto(found.service.id, found.group.id) };
  const group = getGroup(normalizeCategoryId(req.categoryId || req.category));
  if (group) return { emoji: group.emoji, color: group.color, photo: groupPhoto(group.id) };
  return { emoji: '1f9f0', color: 'sky' };
}

export const RequestIcon: React.FC<{ request: RequestLike; size?: 'xs' | 'sm' | 'md' | 'lg' }> = ({ request, size = 'md' }) => (
  <CategoryIcon {...requestVisual(request)} size={size} />
);
