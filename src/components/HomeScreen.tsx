import React, { useState, useRef, useEffect } from 'react';
import {
  Language,
  PendingAttachment,
  RequestLocation,
  validateRequestAttachment,
  sanitizeFileName,
} from '../types';
import { translations } from '../i18n/translations';
import {
  Mic,
  MicOff,
  Search,
  Sparkles,
  Briefcase,
  ChevronRight,
  Image as ImageIcon,
  Video as VideoIcon,
  MapPin,
  Square,
  AlertCircle,
  Loader2,
} from 'lucide-react';
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
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  language,
  onSearch,
  isAnalyzing,
  onOpenProviderMode,
}) => {
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

  // Cleanup audio timer on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
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

  const handleExampleClick = (example: string) => {
    setQuery(example);
    onSearch(example, attachments, location);
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
    setAttachments((prev) => prev.filter((a) => a.id !== id));
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

      <div className="space-y-5">
        {/* Top Kazakhstan Accent Banner */}
        <div className="text-center pt-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-sky-50 border border-sky-100 rounded-full text-xs font-semibold text-sky-800 mb-2.5">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>{t.tagline}</span>
          </div>

          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight font-display mb-1.5">
            {t.headline}
          </h1>
          <p className="text-sm text-slate-600 max-w-xs mx-auto leading-relaxed">
            {t.subheadline}
          </p>
        </div>

        {/* Provider Entry Point Banner */}
        <button
          type="button"
          onClick={onOpenProviderMode}
          className="w-full p-3.5 bg-gradient-to-r from-sky-50 via-slate-50 to-amber-50/50 hover:from-sky-100/70 border border-sky-200/80 rounded-2xl flex items-center justify-between text-left transition-all active:scale-[0.99] shadow-2xs group"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 group-hover:text-sky-700 transition-colors">
                {t.providerEntryBanner}
              </div>
              <div className="text-xs text-slate-500">
                {t.providerEntrySubtext}
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-sky-600 transition-colors shrink-0" />
        </button>

        {/* Search & Media Input Box */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative bg-white rounded-2xl border-2 border-slate-200 focus-within:border-sky-500 shadow-sm transition-all overflow-hidden">
            <textarea
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
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                  isListening
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600 active:scale-95'
                }`}
                aria-label={t.micTooltip}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            </div>

            {/* Request 2.0 Action Toolbar: Photo, Video, Audio, Location */}
            <div className="px-3 py-2 bg-slate-50/90 border-t border-slate-100 flex items-center justify-between gap-1 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* 📷 Photo */}
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="px-2.5 py-1.5 bg-white hover:bg-sky-50 border border-slate-200 hover:border-sky-300 rounded-xl text-xs font-semibold text-slate-700 hover:text-sky-700 flex items-center gap-1.5 transition-all shadow-2xs active:scale-95"
                  title={t.reqAddPhoto}
                >
                  <ImageIcon className="w-4 h-4 text-sky-600" />
                  <span>{t.reqAddPhoto}</span>
                </button>

                {/* 🎥 Video */}
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className="px-2.5 py-1.5 bg-white hover:bg-purple-50 border border-slate-200 hover:border-purple-300 rounded-xl text-xs font-semibold text-slate-700 hover:text-purple-700 flex items-center gap-1.5 transition-all shadow-2xs active:scale-95"
                  title={t.reqAddVideo}
                >
                  <VideoIcon className="w-4 h-4 text-purple-600" />
                  <span>{t.reqAddVideo}</span>
                </button>

                {/* 🎤 Voice Recording */}
                <button
                  type="button"
                  onClick={isRecordingAudio ? stopAudioRecording : startAudioRecording}
                  className={`px-2.5 py-1.5 border rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs active:scale-95 ${
                    isRecordingAudio
                      ? 'bg-red-500 border-red-600 text-white animate-pulse'
                      : 'bg-white hover:bg-emerald-50 border-slate-200 hover:border-emerald-300 text-slate-700 hover:text-emerald-700'
                  }`}
                  title={isRecordingAudio ? t.reqStopRecording : t.reqAddAudio}
                >
                  {isRecordingAudio ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>{formatTimer(recordingSeconds)}</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4 text-emerald-600" />
                      <span>{t.reqAddAudio}</span>
                    </>
                  )}
                </button>

                {/* 📍 Location */}
                <button
                  type="button"
                  onClick={handleDetectLocation}
                  disabled={isDetectingLocation}
                  className={`px-2.5 py-1.5 border rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs active:scale-95 ${
                    location
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white hover:bg-sky-50 border-slate-200 hover:border-sky-300 text-slate-700 hover:text-sky-700'
                  }`}
                  title={t.reqAddLocation}
                >
                  {isDetectingLocation ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
                      <span className="text-[11px]">...</span>
                    </>
                  ) : (
                    <>
                      <MapPin className={`w-4 h-4 ${location ? 'text-blue-600' : 'text-sky-600'}`} />
                      <span>{location ? (language === 'kz' ? 'Орналасты' : 'Локация') : t.reqAddLocation}</span>
                    </>
                  )}
                </button>
              </div>

              {/* Counter badge for added attachments */}
              {attachments.length > 0 && (
                <span className="text-[11px] font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full">
                  +{attachments.length}
                </span>
              )}
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
            className={`w-full min-h-[52px] rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.99] ${
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
        </form>

        {/* Examples Section */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>{t.examplesTitle}</span>
          </div>

          <div className="flex flex-col gap-2">
            {t.examples.map((example, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleExampleClick(example)}
                className="w-full text-left p-3.5 bg-white hover:bg-sky-50/60 active:bg-sky-100 border border-slate-200/90 rounded-xl transition-all group flex items-start justify-between gap-3 shadow-2xs"
              >
                <span className="text-sm font-medium text-slate-700 group-hover:text-sky-900 leading-snug">
                  «{example}»
                </span>
                <span className="shrink-0 text-sky-600 opacity-60 group-hover:opacity-100 text-xs font-semibold mt-0.5">
                  →
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <footer className="text-center text-xs text-slate-400 py-3 border-t border-slate-100">
        <span>КЕРЕК 2026 · Қазақстан · Екі жақты маркетплейс MVP</span>
      </footer>
    </div>
  );
};
