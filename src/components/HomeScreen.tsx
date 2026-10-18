import React, { useState, useRef, useEffect } from 'react';
import {
  ExtractedNeed,
  Language,
  PendingAttachment,
  RequestLocation,
  validateRequestAttachment,
  sanitizeFileName,
} from '../types';
import { translations } from '../i18n/translations';
import { AlertCircle, Image as ImageIcon, Loader2, MapPin, Mic, MicOff, PenLine, Search, ShieldCheck, Square, Video as VideoIcon } from 'lucide-react';
import { LegalLinks } from './LegalModal';
import { LEGAL_OPERATOR } from '../data/legalTexts';
import { ServiceDiscovery } from './ServiceDiscovery';
import { RequestWizard } from './RequestWizard';
import type { CatalogGroup, CatalogService } from '../data/serviceCatalog';
import { RequestMediaView } from './RequestMediaView';

interface HomeScreenProps {
  language: Language;
  onSearch: (
    query: string,
    attachments?: PendingAttachment[],
    location?: RequestLocation
  ) => void;
  isAnalyzing: boolean;
  onOpenProviderMode: () => void;
  /** A request built step by step from a catalogue service */
  onServiceRequest: (need: ExtractedNeed) => void | Promise<void>;
  /** The request is being sent */
  isSubmitting?: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  language,
  onSearch,
  isAnalyzing,
  onOpenProviderMode,
  onServiceRequest,
  isSubmitting = false,
}) => {
  const [picked, setPicked] = useState<{ group: CatalogGroup; service: CatalogService } | null>(null);
  const freeTextRef = useRef<HTMLElement>(null);
  const freeTextInputRef = useRef<HTMLTextAreaElement>(null);
  const t = translations[language];
  const [query, setQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);

  // Request 2.0 State
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [location, setLocation] = useState<RequestLocation | undefined>(undefined);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Audio Recording State
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Leaving the screen stops the timer and releases the microphone
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
        recorder.stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
      }
    };
  }, []);

  const showMediaError = (msg: string) => {
    setMediaError(msg);
    setTimeout(() => setMediaError(null), 4500);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanText = query.trim();
    if ((!cleanText && attachments.length === 0) || isAnalyzing) return;
    const effectiveQuery =
      cleanText || (language === 'kz' ? 'Медиа файлдармен өтініш' : 'Заявка с медиа файлами');
    onSearch(effectiveQuery, attachments, location);
  };

  // 1. Photo Selection
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: PendingAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = validateRequestAttachment(
        { name: file.name, size: file.size, type: file.type },
        'image'
      );
      if (!validation.isValid) {
        const errorMsg =
          validation.errorKey === 'reqFileTooLarge'
            ? t.reqFileTooLarge
            : validation.errorKey === 'reqUnsupportedImageMime'
            ? t.reqUnsupportedImageMime
            : t.reqUnsupportedFileType;
        showMediaError(`${file.name}: ${errorMsg}`);
        continue;
      }

      const cleanName = sanitizeFileName(file.name);
      newItems.push({
        id: `pending_img_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        name: cleanName,
        size: file.size,
        type: file.type || 'image/jpeg',
        mediaType: 'image',
        previewUrl: URL.createObjectURL(file),
        file,
      });
    }

    if (newItems.length > 0) {
      setAttachments((prev) => [...prev, ...newItems]);
    }
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  // 2. Video Selection
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: PendingAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validation = validateRequestAttachment(
        { name: file.name, size: file.size, type: file.type },
        'video'
      );
      if (!validation.isValid) {
        const errorMsg =
          validation.errorKey === 'reqFileTooLarge'
            ? t.reqFileTooLarge
            : validation.errorKey === 'reqUnsupportedVideoMime'
            ? t.reqUnsupportedVideoMime
            : t.reqUnsupportedFileType;
        showMediaError(`${file.name}: ${errorMsg}`);
        continue;
      }

      const cleanName = sanitizeFileName(file.name);
      newItems.push({
        id: `pending_vid_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        name: cleanName,
        size: file.size,
        type: file.type || 'video/mp4',
        mediaType: 'video',
        previewUrl: URL.createObjectURL(file),
        file,
      });
    }

    if (newItems.length > 0) {
      setAttachments((prev) => [...prev, ...newItems]);
    }
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  // 3. Audio Recording
  const startAudioRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMediaError(t.micNotSupported);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      let mimeType = 'audio/webm';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          mimeType = 'audio/ogg';
        }
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
        const fileName = `voice_${Date.now().toString().slice(-4)}.${ext}`;

        const validation = validateRequestAttachment(
          { name: fileName, size: audioBlob.size, type: mimeType },
          'audio'
        );

        if (!validation.isValid) {
          showMediaError(t.reqFileTooLarge);
          return;
        }

        const newAudio: PendingAttachment = {
          id: `pending_aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: fileName,
          size: audioBlob.size,
          type: mimeType,
          mediaType: 'audio',
          previewUrl: URL.createObjectURL(audioBlob),
          file: audioBlob,
          durationSeconds: recordingSeconds,
        };

        setAttachments((prev) => [...prev, newAudio]);
        setIsRecordingAudio(false);
        setRecordingSeconds(0);
      };

      recorder.start(250);
      setIsRecordingAudio(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((sec) => sec + 1);
      }, 1000);
    } catch (err: any) {
      console.warn('[HomeScreen] Audio recording permission note:', err);
      showMediaError(t.reqLocationPermissionRequired || 'Микрофонға рұқсат берілмеді');
      setIsRecordingAudio(false);
    }
  };

  const stopAudioRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const cancelAudioRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      } catch {}
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    setIsRecordingAudio(false);
    setRecordingSeconds(0);
  };

  // 4. Geolocation Detection
  const handleDetectLocation = () => {
    if (!('geolocation' in navigator)) {
      showMediaError(t.reqLocationFailed);
      return;
    }

    setIsDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsDetectingLocation(false);
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
        });
      },
      (error) => {
        setIsDetectingLocation(false);
        if (error.code === error.PERMISSION_DENIED) {
          showMediaError(t.reqLocationPermissionRequired);
        } else {
          showMediaError(t.reqLocationFailed);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  };

  // Attachment removals
  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => {
      // Free the preview of the removed file
      const removed = prev.find((a) => a.id === id);
      if (removed?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleRemoveLocation = () => {
    setLocation(undefined);
  };

  // Speech Recognition
  const handleMicClick = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setSpeechNotice(t.micNotSupported);
      setTimeout(() => setSpeechNotice(null), 3500);
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = language === 'kz' ? 'kk-KZ' : 'ru-RU';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      setIsListening(true);
      setSpeechNotice(t.micListening);

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setQuery((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
        setIsListening(false);
        setSpeechNotice(null);
      };

      recognition.onerror = () => {
        setIsListening(false);
        setSpeechNotice(null);
      };

      recognition.onend = () => {
        setIsListening(false);
        setSpeechNotice(null);
      };

      recognition.start();
    } catch {
      setIsListening(false);
      setSpeechNotice(null);
    }
  };

  const formatTimer = (totalSeconds: number): string => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const canSubmit = (query.trim().length > 0 || attachments.length > 0) && !isAnalyzing;

  if (picked) {
    return (
      <RequestWizard
        language={language}
        group={picked.group}
        service={picked.service}
        onCancel={() => setPicked(null)}
        submitting={isSubmitting}
        // The wizard stays open until the request is saved (the app then shows it), so a failed
        // send can be retried without typing everything again
        onSubmit={(need) => {
          onServiceRequest(need);
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-5 flex flex-col justify-between space-y-6">
      {/* Hidden file pickers */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handlePhotoSelect}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        multiple
        className="hidden"
        onChange={handleVideoSelect}
      />

      {/* Search, popular services, all categories, free text, how it works */}
      <ServiceDiscovery
        language={language}
        onPickService={(group, service) => {
          setPicked({ group, service });
          window.scrollTo({ top: 0 });
        }}
        onFreeText={(text) => onSearch(text, [], undefined)}
        onDescribeOwn={() => {
          freeTextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          window.setTimeout(() => freeTextInputRef.current?.focus({ preventScroll: true }), 350);
        }}
        onBecomeProvider={onOpenProviderMode}
      >
        {/* Free text: describe the need in your own words (analysed by the app) */}
        <section
          ref={freeTextRef}
          className="scroll-mt-20 p-4 rounded-3xl bg-linear-to-br from-violet-50 via-white to-sky-50 border border-violet-100 space-y-3"
        >
          <div className="flex items-center gap-3">
            <span className="w-12 h-12 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0"><PenLine className="w-5 h-5" /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight leading-tight">
                {language === 'kz' ? 'Өз сөзіңізбен жазыңыз' : 'Опишите своими словами'}
              </h2>
              <p className="text-xs text-slate-500 leading-snug mt-0.5">
                {language === 'kz'
                  ? 'Жазыңыз немесе айтыңыз, фото мен видео қосыңыз — біз өзіміз түсінеміз'
                  : 'Напишите или наговорите, добавьте фото и видео — мы сами разберёмся'}
              </p>
            </div>
          </div>

        {/* Search & Media Input Box */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative bg-white rounded-2xl border-2 border-slate-200 focus-within:border-sky-500 shadow-sm transition overflow-hidden">
            <textarea
              ref={freeTextInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.inputPlaceholder}
              rows={3}
              className="w-full p-4 pr-12 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none bg-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />

            {/* Microphone Button inside textarea for voice dictation */}
            <div className="absolute right-3 top-3">
              <button
                type="button"
                onClick={handleMicClick}
                title={t.micTooltip}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition ${
                  isListening
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600 active:scale-95'
                }`}
                aria-label={t.micTooltip}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>

            {/* Photo, video, voice note, location */}
            <div className="grid grid-cols-4 gap-1 px-2 py-2 bg-slate-50/90 border-t border-slate-100">
              {[
                {
                  key: 'photo',
                  label: 'Фото',
                  title: t.reqAddPhoto,
                  icon: <ImageIcon className="w-5 h-5 text-sky-600" />,
                  onClick: () => photoInputRef.current?.click(),
                  active: false,
                },
                {
                  key: 'video',
                  label: 'Видео',
                  title: t.reqAddVideo,
                  icon: <VideoIcon className="w-5 h-5 text-violet-600" />,
                  onClick: () => videoInputRef.current?.click(),
                  active: false,
                },
                {
                  key: 'audio',
                  label: isRecordingAudio ? formatTimer(recordingSeconds) : language === 'kz' ? 'Дауыс' : 'Голос',
                  title: isRecordingAudio ? t.reqStopRecording : t.reqAddAudio,
                  icon: isRecordingAudio ? <Square className="w-4 h-4 fill-current text-white" /> : <Mic className="w-5 h-5 text-emerald-600" />,
                  onClick: isRecordingAudio ? stopAudioRecording : startAudioRecording,
                  active: isRecordingAudio,
                },
                {
                  key: 'location',
                  label: location ? (language === 'kz' ? 'Қосылды' : 'Добавлено') : language === 'kz' ? 'Орын' : 'Место',
                  title: t.reqAddLocation,
                  icon: isDetectingLocation ? (
                    <Loader2 className="w-5 h-5 animate-spin text-sky-600" />
                  ) : (
                    <MapPin className={`w-5 h-5 ${location ? 'text-blue-700' : 'text-rose-500'}`} />
                  ),
                  onClick: handleDetectLocation,
                  active: false,
                },
              ].map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={b.onClick}
                  disabled={b.key === 'location' && isDetectingLocation}
                  title={b.title}
                  aria-label={b.title}
                  className={`press min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
                    b.active
                      ? 'bg-red-500 text-white animate-pulse'
                      : b.key === 'location' && location
                      ? 'bg-blue-50 text-blue-800'
                      : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  {b.icon}
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Active Audio Recording Bar */}
          {isRecordingAudio && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-xs text-red-900 animate-fadeIn shadow-2xs">
              <div className="flex items-center gap-2 font-semibold">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping" />
                <span>{t.reqRecordingAudio}</span>
                <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-red-200">
                  {formatTimer(recordingSeconds)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={stopAudioRecording}
                  className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-xs"
                >
                  {t.reqStopRecording}
                </button>
                <button
                  type="button"
                  onClick={cancelAudioRecording}
                  className="text-slate-500 hover:text-slate-800 text-xs px-1.5 py-1"
                >
                  {language === 'kz' ? 'Болдырмау' : 'Отмена'}
                </button>
              </div>
            </div>
          )}

          {/* Media Error Notice */}
          {mediaError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{mediaError}</span>
            </div>
          )}

          {/* Speech notice */}
          {speechNotice && (
            <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-800 flex items-center gap-2 animate-fadeIn">
              <span className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />
              <span>{speechNotice}</span>
            </div>
          )}

          {/* Pre-submit Media & Location Preview */}
          {(attachments.length > 0 || location) && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                {t.reqAttachmentsSectionTitle}
              </div>
              <RequestMediaView
                attachments={attachments}
                location={location}
                language={language}
                onRemoveAttachment={handleRemoveAttachment}
                onRemoveLocation={handleRemoveLocation}
                isEditable={true}
              />
            </div>
          )}

          {/* Primary Action Button: "Найти решение" / "Шешім табу" */}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`w-full min-h-[52px] rounded-xl font-bold text-base flex items-center justify-center gap-2 transition shadow-md active:scale-[0.99] ${
              !canSubmit
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-600/20'
            }`}
          >
            {isAnalyzing ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{t.analyzing}</span>
              </>
            ) : (
              <>
                <Search className="w-5 h-5 stroke-[2.5]" />
                <span>{t.searchButton}</span>
              </>
            )}
          </button>
          <p className="px-1 text-[11px] text-slate-500 leading-relaxed">
            {language === 'kz'
              ? 'Мәтініңізді түсіну үшін оны жасанды интеллект (Google Gemini) өңдейді. Телефон нөмірін, мекенжайды немесе басқа жеке деректерді жазбаңыз.'
              : 'Чтобы понять ваш текст, его обрабатывает искусственный интеллект (Google Gemini). Не пишите сюда телефон, точный адрес и другие личные данные.'}
          </p>
        </form>

          {/* Phone number privacy */}
          <div className="flex items-start gap-2.5 text-xs text-slate-600">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="leading-relaxed">{t.phoneMaskingGuarantee}</p>
          </div>
        </section>
      </ServiceDiscovery>

      {/* Footer Info */}
      <footer className="text-center text-xs text-slate-400 py-3 border-t border-slate-100 space-y-1.5">
        <LegalLinks language={language} className="block text-slate-500" />
        <span className="block">Tapsyr 2026 · Қазақстан</span>
        {/* The registered business behind the app, by its official name (Meta business verification checks it) */}
        <span className="block">
          {LEGAL_OPERATOR.shortName} · {language === 'kz' ? LEGAL_OPERATOR.addressKz : LEGAL_OPERATOR.addressRu}
        </span>
      </footer>
    </div>
  );
};
