import React, { useState } from 'react';
import { Language, RequestAttachment, RequestLocation, PendingAttachment } from '../types';
import { translations } from '../i18n/translations';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Mic,
  MapPin,
  ExternalLink,
  X,
  Maximize2,
} from 'lucide-react';
import { safeCoords, safeText } from '../services/safeData';
import { useMediaUrls } from '../services/storageUrls';

interface RequestMediaViewProps {
  attachments?: (RequestAttachment | PendingAttachment)[];
  location?: RequestLocation;
  language: Language;
  onRemoveAttachment?: (id: string) => void;
  onRemoveLocation?: () => void;
  isEditable?: boolean;
}

export const RequestMediaView: React.FC<RequestMediaViewProps> = ({
  attachments,
  location,
  language,
  onRemoveAttachment,
  onRemoveLocation,
  isEditable = false,
}) => {
  const t = translations[language];
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);

  // Values come from other people's documents: keep only well-formed items
  attachments = Array.isArray(attachments) ? attachments.filter((a) => a && typeof a === 'object') : undefined;
  const coords = safeCoords(location);
  location = coords ? { ...(location as RequestLocation), ...coords } : undefined;
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  const hasLocation = Boolean(coords);

  if (!hasAttachments && !hasLocation) {
    return null;
  }

  const formatSize = (bytes: number): string => {
    if (!bytes || isNaN(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const images = (attachments || []).filter(
    (a) => a.type === 'image' || (a as PendingAttachment).mediaType === 'image'
  );
  const videos = (attachments || []).filter(
    (a) => a.type === 'video' || (a as PendingAttachment).mediaType === 'video'
  );
  const audios = (attachments || []).filter(
    (a) => a.type === 'audio' || (a as PendingAttachment).mediaType === 'audio'
  );

  const mediaUrls = useMediaUrls((attachments || []) as Array<RequestAttachment & { previewUrl?: string }>);
  const getMediaUrl = (item: RequestAttachment | PendingAttachment): string => mediaUrls[item.id] || '';

  const getMediaName = (item: RequestAttachment | PendingAttachment): string => {
    return safeText((item as any).fileName) || safeText((item as any).name) || 'Media';
  };

  const getMediaSize = (item: RequestAttachment | PendingAttachment): number => {
    const n = Number((item as any).sizeBytes ?? (item as any).size ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="space-y-3 pt-2">
      {/* Location Card */}
      {hasLocation && location && (
        <div className="p-3 bg-gradient-to-r from-sky-50 to-blue-50/60 border border-sky-200 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                <span>{language === 'kz' ? 'Орналасқан жер' : 'Геолокация'}</span>
                {location.approximate ? (
                  <span className="text-[10px] font-semibold text-sky-700 bg-sky-100/80 px-1.5 py-0.2 rounded">
                    {language === 'kz' ? '≈1 км, шамамен' : '≈1 км, примерно'}
                  </span>
                ) : (
                  location.accuracy !== undefined && (
                    <span className="text-[10px] font-semibold text-sky-700 bg-sky-100/80 px-1.5 py-0.2 rounded">
                      ±{Math.round(location.accuracy)} m
                    </span>
                  )
                )}
              </div>
              <div className="text-[11px] text-slate-500 font-mono truncate">
                {location.latitude.toFixed(location.approximate ? 2 : 5)}, {location.longitude.toFixed(location.approximate ? 2 : 5)}
                {location.address ? ` · ${location.address}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:text-sky-900 bg-white px-2.5 py-1.5 rounded-lg border border-sky-200/80 shadow-2xs hover:shadow-xs transition-all"
              title="Google Maps"
            >
              <span>{language === 'kz' ? 'Карта' : 'Карта'}</span>
              <ExternalLink className="w-3 h-3" />
            </a>

            {isEditable && onRemoveLocation && (
              <button
                type="button"
                onClick={onRemoveLocation}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors"
                title={t.reqRemove}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Images Section */}
      {images.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <ImageIcon className="w-3.5 h-3.5 text-sky-600" />
            <span>{language === 'kz' ? 'Фотосуреттер' : 'Фотографии'} ({images.length})</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {images.map((img) => {
              const url = getMediaUrl(img);
              const name = getMediaName(img);
              const size = getMediaSize(img);

              return (
                <div
                  key={img.id}
                  className="relative group rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-square shadow-2xs flex flex-col justify-end"
                >
                  <img
                    src={url || undefined}
                    alt={name}
                    className="absolute inset-0 w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-200"
                    onClick={() => setActivePreviewImage(url)}
                    loading="lazy"
                  />

                  {/* Gradient overlay with name and size */}
                  <div className="relative z-10 p-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white text-[10px] pointer-events-none truncate">
                    <div className="truncate font-medium">{name}</div>
                    {size > 0 && <div className="text-[9px] opacity-80">{formatSize(size)}</div>}
                  </div>

                  {/* Top actions */}
                  <div className="absolute top-1 right-1 z-20 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActivePreviewImage(url)}
                      className="w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
                      title={language === 'kz' ? 'Үлкейту' : 'Увеличить'}
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>

                    {isEditable && onRemoveAttachment && (
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment(img.id)}
                        className="w-6 h-6 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center transition-colors shadow-xs"
                        title={t.reqRemove}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Videos Section */}
      {videos.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <VideoIcon className="w-3.5 h-3.5 text-purple-600" />
            <span>{language === 'kz' ? 'Бейне жазбалар' : 'Видео'} ({videos.length})</span>
          </div>

          <div className="space-y-2">
            {videos.map((vid) => {
              const url = getMediaUrl(vid);
              const name = getMediaName(vid);
              const size = getMediaSize(vid);

              return (
                <div
                  key={vid.id}
                  className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 text-white space-y-1.5 shadow-xs"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium truncate max-w-[200px] text-slate-200">
                      {name}
                    </span>
                    <div className="flex items-center gap-2">
                      {size > 0 && (
                        <span className="text-[10px] text-slate-400 font-mono">
                          {formatSize(size)}
                        </span>
                      )}
                      {isEditable && onRemoveAttachment && (
                        <button
                          type="button"
                          onClick={() => onRemoveAttachment(vid.id)}
                          className="w-6 h-6 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center transition-colors"
                          title={t.reqRemove}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <video
                    src={url || undefined}
                    controls
                    preload="metadata"
                    className="w-full max-h-56 rounded-lg bg-black object-contain"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Audio Recordings Section */}
      {audios.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
            <Mic className="w-3.5 h-3.5 text-emerald-600" />
            <span>{language === 'kz' ? 'Дыбыс жазбалары' : 'Голосовые сообщения'} ({audios.length})</span>
          </div>

          <div className="space-y-2">
            {audios.map((aud) => {
              const url = getMediaUrl(aud);
              const name = getMediaName(aud);
              const size = getMediaSize(aud);

              return (
                <div
                  key={aud.id}
                  className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1.5 shadow-2xs"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-emerald-950 font-bold truncate">
                      <Mic className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span className="truncate">{name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {size > 0 && (
                        <span className="text-[10px] text-emerald-800 font-mono">
                          {formatSize(size)}
                        </span>
                      )}
                      {isEditable && onRemoveAttachment && (
                        <button
                          type="button"
                          onClick={() => onRemoveAttachment(aud.id)}
                          className="w-6 h-6 rounded-full bg-slate-200 hover:bg-rose-600 hover:text-white text-slate-600 flex items-center justify-center transition-colors"
                          title={t.reqRemove}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <audio src={url || undefined} controls className="w-full h-9" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fullscreen Image Preview Lightbox */}
      {activePreviewImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 animate-fadeIn"
          onClick={() => setActivePreviewImage(null)}
        >
          <button
            type="button"
            onClick={() => setActivePreviewImage(null)}
            className="absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-all"
            aria-label={t.closeButton}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={activePreviewImage}
            alt="Preview"
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
