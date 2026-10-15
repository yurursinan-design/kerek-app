import React, { useState, useEffect, useRef } from 'react';
import { ReportButton } from './ReportButton';
import {
  ChatMessage,
  Conversation,
  Language,
  RequestStatus,
  ServiceRequest,
  validateChatAttachment,
} from '../types';
import { translations } from '../i18n/translations';
import { getRequestTitle } from '../services/requestTitle';
import { repository, getCurrentUserId, getFriendlyErrorMessage } from '../services';
import { chatRisk, chatRiskWarning } from '../services/chatSafety';
import { auth } from '../services/firebase';
import {
  ChevronLeft,
  Send,
  Check,
  CheckCheck,
  AlertCircle,
  MessageSquare,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Download,
  X,
  ShieldAlert,
} from 'lucide-react';
import { useMediaUrls } from '../services/storageUrls';

// One tap fills the message box with a common phrase; the sender can still edit it before sending
const QUICK_REPLIES: Record<'customer' | 'provider', { kz: string; ru: string }[]> = {
  customer: [
    { kz: 'Сәлеметсіз бе! Қашан келе аласыз?', ru: 'Здравствуйте! Когда сможете приехать?' },
    { kz: 'Бұл соңғы баға ма?', ru: 'Это окончательная цена?' },
    { kz: 'Келер алдында қоңырау шалыңызшы', ru: 'Позвоните, пожалуйста, перед приездом' },
    { kz: 'Рақмет!', ru: 'Спасибо!' },
  ],
  provider: [
    { kz: 'Сәлеметсіз бе! Ақаудың фотосын жібере аласыз ба?', ru: 'Здравствуйте! Можете прислать фото поломки?' },
    { kz: 'Мекенжайыңызды жіберіңізші', ru: 'Пришлите, пожалуйста, адрес' },
    { kz: 'Жолдамын, 15 минутта жетемін', ru: 'Я в пути, буду через 15 минут' },
    { kz: 'Жұмыс дайын, тексеріп көріңізші', ru: 'Работа готова, проверьте, пожалуйста' },
  ],
};

interface ChatScreenProps {
  requestId: string;
  language: Language;
  onBack: () => void;
  userRole?: 'customer' | 'provider';
}

interface PendingAttachment {
  file: File;
  previewUrl: string;
  type: 'image' | 'file';
  name: string;
  sizeBytes: number;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  requestId,
  language,
  onBack,
  userRole,
}) => {
  const t = translations[language];
  const currentUid = getCurrentUserId();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Viewing addresses of the files in the conversation (asked from Cloud Storage when shown)
  const chatMediaUrls = useMediaUrls(
    messages.flatMap((m) =>
      (Array.isArray(m.attachments) ? m.attachments : [])
        .filter((att) => att && typeof att === 'object')
        .map((att) => ({ ...att, id: `${m.id}/${att.id}` }))
    )
  );
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [, setUploadProgress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Attachment state
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [fullImageViewUrl, setFullImageViewUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scrolls only the message list: scrollIntoView would also scroll the page and push the chat
  // header (who you are talking to) under the app's sticky header
  const scrollToBottom = (smooth = true) => {
    const list = messagesEndRef.current?.parentElement;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Load conversation, request, and subscribe to messages
  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | null = null;

    const initChat = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const [req, conv] = await Promise.all([
          repository.getRequest(requestId),
          repository.getOrCreateConversation(requestId),
        ]);

        if (!isMounted) return;

        setRequest(req);
        setConversation(conv);

        // Mark as read immediately upon opening
        repository.markMessagesAsRead(conv.id).catch(() => {});

        // Initial fetch of messages
        const initialMsgs = await repository.getMessages(conv.id, 30);
        if (isMounted) {
          setMessages(initialMsgs);
          setIsLoading(false);
          setTimeout(() => scrollToBottom(false), 80);
        }

        // Realtime subscribe
        unsubscribe = repository.subscribeToMessages(
          conv.id,
          (updatedMsgs) => {
            if (!isMounted) return;
            setMessages((prev) => {
              // Deduplicate and merge by message.id, maintaining ascending order
              const map = new Map<string, ChatMessage>();
              prev.forEach((m) => map.set(m.id, m));
              updatedMsgs.forEach((m) => map.set(m.id, m));
              return Array.from(map.values()).sort(
                (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
              );
            });
            // Mark as read when new messages arrive while viewing
            repository.markMessagesAsRead(conv.id).catch(() => {});
            setTimeout(() => scrollToBottom(true), 80);
          },
          (err) => {
            if (!isMounted) return;
            console.warn('[ChatScreen] Realtime listener note (resilient fallback active):', err?.message || err);
          }
        );
      } catch (err: any) {
        if (!isMounted) return;
        setIsLoading(false);
        setErrorMessage(
          err?.message?.includes('OPEN requests')
            ? translations[language].chatOpenWarning
            : getFriendlyErrorMessage(err, language)
        );
      }
    };

    initChat();

    return () => {
      isMounted = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {}
      }
    };
  }, [requestId, language]);

  // A photo picked but not sent is freed when it is replaced (below) or the chat closes
  useEffect(() => {
    const url = pendingAttachment?.previewUrl || null;
    return () => {
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
    };
  }, [pendingAttachment]);

  // Live conversation: the other side's read mark turns sent ticks into double ticks
  const conversationId = conversation?.id;
  useEffect(() => {
    if (!conversationId) return;
    return repository.subscribeToConversation(conversationId, (conv) => {
      if (conv) setConversation(conv);
    });
  }, [conversationId]);

  const handleFileSelected = (file: File, forcedType?: 'image' | 'file') => {
    setIsAttachmentMenuOpen(false);
    setErrorMessage(null);

    const validation = validateChatAttachment(
      { name: file.name, size: file.size, type: file.type },
      forcedType
    );

    if (!validation.isValid) {
      if (validation.errorKey === 'chatFileTooLarge') {
        setErrorMessage(t.chatFileTooLarge);
      } else if (validation.errorKey === 'chatUnsupportedImageMime') {
        setErrorMessage(t.chatUnsupportedImageMime);
      } else if (validation.errorKey === 'chatUnsupportedFileType') {
        setErrorMessage(t.chatUnsupportedFileType);
      } else {
        setErrorMessage(t.chatUploadFailed);
      }
      return;
    }

    let previewUrl = '';
    if (validation.type === 'image') {
      try {
        previewUrl = URL.createObjectURL(file);
      } catch {}
    }

    setPendingAttachment({
      file,
      previewUrl,
      type: validation.type,
      name: file.name,
      sizeBytes: file.size,
    });
  };

  const cancelPendingAttachment = () => {
    if (pendingAttachment?.previewUrl) {
      try {
        URL.revokeObjectURL(pendingAttachment.previewUrl);
      } catch {}
    }
    setPendingAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (photoInputRef.current) photoInputRef.current.value = '';
  };

  const viewerIsCustomer = userRole
    ? userRole === 'customer'
    : conversation
    ? currentUid === conversation.customerId || (Boolean(auth?.currentUser?.uid) && auth?.currentUser?.uid === conversation.customerId)
    : true;

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = inputText.trim();
    if ((!clean && !pendingAttachment) || !conversation || isSending) return;

    if (clean.length > 2000) {
      setErrorMessage(t.chatInputLengthError);
      return;
    }

    setIsSending(true);
    setUploadProgress(pendingAttachment ? t.chatUploading : null);
    setErrorMessage(null);

    const isCustomerParticipant = viewerIsCustomer;

    const senderRole: 'customer' | 'provider' = isCustomerParticipant ? 'customer' : 'provider';
    const authUid = auth?.currentUser?.uid;
    const senderId = isCustomerParticipant
      ? (authUid && authUid === conversation.customerId ? authUid : (conversation.customerId || currentUid))
      : (authUid && (authUid === conversation.providerUserId || authUid === conversation.providerId)
          ? authUid
          : (conversation.providerUserId || conversation.providerId || currentUid));

    try {
      let sentMessage: ChatMessage;

      if (pendingAttachment) {
        sentMessage = await repository.sendChatMessageWithAttachment(conversation.id, {
          text: clean,
          senderId,
          senderRole,
          file: {
            name: pendingAttachment.name,
            size: pendingAttachment.sizeBytes,
            type: pendingAttachment.file.type,
            data: pendingAttachment.file,
          },
        });
        cancelPendingAttachment();
      } else {
        sentMessage = await repository.sendMessage(conversation.id, {
          text: clean,
          senderId,
          senderRole,
        });
      }

      // Immediately display sent message in UI; deduplicate if onSnapshot arrives later
      setMessages((prev) => {
        if (prev.some((m) => m.id === sentMessage.id)) {
          return prev;
        }
        return [...prev, sentMessage];
      });

      setInputText('');
      setTimeout(() => scrollToBottom(true), 60);
    } catch (err: any) {
      setErrorMessage(
        err?.message?.includes('cancelled')
          ? t.chatCannotSendCancelled
          : err?.message?.includes('Upload') || err?.message?.includes('Failed to upload')
          ? t.chatUploadFailed
          : getFriendlyErrorMessage(err, language)
      );
    } finally {
      setIsSending(false);
      setUploadProgress(null);
    }
  };

  const isCustomer = userRole
    ? userRole === 'customer'
    : conversation
    ? currentUid === conversation.customerId || (Boolean(auth?.currentUser?.uid) && auth?.currentUser?.uid === conversation.customerId)
    : true;
  const otherLastReadAt = isCustomer ? conversation?.providerLastReadAt : conversation?.customerLastReadAt;
  const otherPartyName = conversation
    ? isCustomer
      ? conversation.providerName || t.chatParticipantMaster
      : conversation.customerName || t.chatParticipantClient
    : '';

  const isCancelled = request?.status === 'CANCELLED';

  const formatMessageTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusLabel = (status?: RequestStatus) => {
    if (!status) return '';
    switch (status) {
      case 'PROVIDER_SELECTED':
      case 'ACCEPTED':
        return language === 'kz' ? 'Шебер таңдалды' : 'Мастер выбран';
      case 'IN_PROGRESS':
        return language === 'kz' ? 'Орындалуда' : 'В работе';
      case 'COMPLETED':
        return language === 'kz' ? 'Аяқталды' : 'Завершено';
      case 'CANCELLED':
        return language === 'kz' ? 'Тоқтатылды' : 'Отменено';
      default:
        return '';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-139px)] supports-[height:100dvh]:h-[calc(100dvh-139px)] sm:h-[650px] max-w-xl mx-auto bg-slate-50 border border-slate-200/90 rounded-none sm:rounded-3xl shadow-sm overflow-hidden animate-fadeIn relative">
      {/* Hidden File Pickers */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileSelected(f, 'image');
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileSelected(f);
        }}
      />

      {/* Full Image Modal */}
      {fullImageViewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setFullImageViewUrl(null)}
        >
          <button
            type="button"
            onClick={() => setFullImageViewUrl(null)}
            className="absolute top-4 right-4 p-2.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
            aria-label={t.closeButton}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={fullImageViewUrl}
            alt="Full preview"
            className="max-h-[85vh] max-w-[90vw] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Chat Top Header */}
      <header className="p-3.5 sm:p-4 bg-white border-b border-slate-200/90 flex items-center justify-between gap-2 shrink-0 shadow-2xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors active:scale-95"
            aria-label={language === 'kz' ? 'Артқа' : 'Назад'}
          >
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-2xl bg-sky-600 text-white font-extrabold text-base flex items-center justify-center font-display shadow-xs">
              {otherPartyName.charAt(0).toUpperCase() || 'K'}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-slate-900 leading-tight">
                  {otherPartyName}
                </h2>
                {request && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200">
                    {getStatusLabel(request.status)}
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-500 truncate max-w-[200px] sm:max-w-xs font-medium">
                {(request && getRequestTitle(request, language)) || request?.requestText || requestId} · <span className="font-mono text-slate-400">{requestId}</span>
              </p>
            </div>
          </div>
        </div>
        {conversation?.id && (
          <ReportButton
            language={language}
            targetType="conversation"
            targetId={conversation.id}
            requestId={requestId}
            className="inline-flex shrink-0 items-center gap-1.5 min-h-[40px] px-2 text-xs font-semibold text-slate-500 hover:text-rose-600"
          />
        )}
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div className="m-3 p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-xs text-rose-800 shrink-0 animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-500 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <main className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
        <div className="shrink-0 flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] leading-relaxed text-amber-900">
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 mt-px" />
          <span>
            {language === 'kz'
              ? 'Қауіпсіздік: жұмыс басталмай тұрып алдын ала ақша аудармаңыз, SMS-кодтарды ешкімге айтпаңыз. Күдікті хабарлама болса, шағым жіберіңіз.'
              : 'Безопасность: не переводите предоплату до начала работы и никому не сообщайте коды из SMS. Если сообщение подозрительное, отправьте жалобу.'}
          </span>
        </div>
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-xs gap-2">
            <span className="w-5 h-5 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
            <span>{language === 'kz' ? 'Жүктелуде...' : 'Загрузка сообщений...'}</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2.5 text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shadow-2xs">
              <MessageSquare className="w-6 h-6 stroke-1" />
            </div>
            <p className="text-xs font-bold text-slate-600">
              {t.chatEmptyMessages}
            </p>
            <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
              {language === 'kz'
                ? 'Мекенжайды нақтылаңыз, фото немесе құжат жіберіңіз.'
                : 'Уточните адрес, согласуйте детали или отправьте фото неисправности.'}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const authUid = auth?.currentUser?.uid;
            const effectiveCurrentUid = authUid || currentUid;
            const isMe =
              msg.senderId === effectiveCurrentUid ||
              msg.senderId === currentUid ||
              (Boolean(msg.senderRole) && msg.senderRole === (isCustomer ? 'customer' : 'provider'));

            const hasAttachments = Boolean(msg.attachments && msg.attachments.length > 0);
            const risk = isMe ? null : chatRisk(msg.text);

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1 animate-fadeIn`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[78%] px-3.5 py-2.5 text-xs rounded-2xl shadow-2xs leading-relaxed ${
                    isMe
                      ? 'bg-sky-600 text-white rounded-tr-xs'
                      : 'bg-white text-slate-900 border border-slate-200/90 rounded-tl-xs'
                  }`}
                >
                  {/* Attachments rendering */}
                  {hasAttachments && (
                    <div className="space-y-2 mb-2">
                      {msg.attachments!.filter((att) => att && typeof att === 'object').map((att) => {
                        if (att.type === 'image') {
                          return (
                            <div key={att.id} className="relative group overflow-hidden rounded-xl bg-slate-900/10">
                              <img
                                src={chatMediaUrls[`${msg.id}/${att.id}`] || undefined}
                                alt={att.fileName}
                                className="w-full max-h-60 object-cover cursor-pointer hover:opacity-95 transition-opacity rounded-xl"
                                onClick={() => setFullImageViewUrl(chatMediaUrls[`${msg.id}/${att.id}`] || '')}
                                loading="lazy"
                              />
                              <div className="flex items-center justify-between text-[10px] mt-1 px-1 opacity-80">
                                <span className="truncate max-w-[150px]">{att.fileName}</span>
                                <span>{formatFileSize(att.sizeBytes)}</span>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={att.id}
                            className={`flex items-center justify-between p-2.5 rounded-xl border ${
                              isMe
                                ? 'bg-sky-700/60 border-sky-500/50 text-white'
                                : 'bg-slate-50 border-slate-200 text-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 mr-2">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                  isMe ? 'bg-sky-800/80 text-white' : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold truncate text-[11px] leading-tight">
                                  {att.fileName}
                                </p>
                                <p className="text-[10px] opacity-75">
                                  {formatFileSize(att.sizeBytes)}
                                </p>
                              </div>
                            </div>

                            <a
                              href={chatMediaUrls[`${msg.id}/${att.id}`] || undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={att.fileName}
                              className={`p-1.5 rounded-lg transition-colors flex items-center gap-1 text-[10px] font-semibold ${
                                isMe
                                  ? 'bg-white/20 hover:bg-white/30 text-white'
                                  : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                              }`}
                              title={t.chatOpenFile}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Text message content */}
                  {msg.text && (
                    <p className="whitespace-pre-wrap break-words font-medium">
                      {msg.text}
                    </p>
                  )}

                  <div
                    className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                      isMe ? 'text-sky-200' : 'text-slate-400'
                    }`}
                  >
                    <span>{formatMessageTime(msg.createdAt)}</span>
                    {isMe && (
                      msg.isRead || Boolean(otherLastReadAt && msg.createdAt <= otherLastReadAt) ? (
                        <CheckCheck className="w-3.5 h-3.5 text-emerald-300" />
                      ) : (
                        <Check className="w-3.5 h-3.5 text-sky-200" />
                      )
                    )}
                  </div>
                </div>
                {!isMe && risk && (
                  <div className="max-w-[85%] flex items-start gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] leading-snug text-amber-900">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-px" />
                    <span>{chatRiskWarning(risk, language === 'kz' ? 'kz' : 'ru')}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Pending Attachment Preview Bar */}
      {pendingAttachment && (
        <div className="px-3.5 py-2.5 bg-slate-100 border-t border-slate-200/90 flex items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2.5 min-w-0">
            {pendingAttachment.type === 'image' && pendingAttachment.previewUrl ? (
              <img
                src={pendingAttachment.previewUrl}
                alt="Preview"
                className="w-10 h-10 object-cover rounded-lg border border-slate-300 shadow-2xs shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-800 truncate">
                {pendingAttachment.name}
              </p>
              <p className="text-[10px] text-slate-500 font-medium">
                {formatFileSize(pendingAttachment.sizeBytes)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={cancelPendingAttachment}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
            aria-label={t.chatCancelUpload}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Attachment Selection Menu Popup */}
      {isAttachmentMenuOpen && (
        <div className="absolute bottom-20 left-4 z-40 bg-white border border-slate-200 rounded-2xl shadow-xl p-2 w-56 animate-fadeIn">
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <span>{t.chatChoosePhoto}</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors"
          >
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <span>{t.chatChooseFile}</span>
          </button>
        </div>
      )}

      {/* Input Area Bottom */}
      <footer className="p-3 bg-white border-t border-slate-200/90 shrink-0">
        {isCancelled ? (
          <div className="p-3 bg-slate-100 rounded-xl text-center text-xs font-medium text-slate-500">
            {t.chatCannotSendCancelled}
          </div>
        ) : (
          <>
          {!inputText && !pendingAttachment && !isLoading && conversation && (
            <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1" aria-label={language === 'kz' ? 'Дайын жауаптар' : 'Быстрые ответы'}>
              {QUICK_REPLIES[viewerIsCustomer ? 'customer' : 'provider'].map((q) => (
                <button
                  key={q.ru}
                  type="button"
                  onClick={() => setInputText(language === 'kz' ? q.kz : q.ru)}
                  className="shrink-0 px-3 py-1.5 rounded-full bg-sky-50 border border-sky-200 text-sky-800 text-xs font-semibold hover:bg-sky-100 active:scale-95 transition-all"
                >
                  {language === 'kz' ? q.kz : q.ru}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            {/* Attachment Button */}
            <button
              type="button"
              disabled={isLoading || isSending}
              onClick={() => setIsAttachmentMenuOpen((prev) => !prev)}
              className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-colors shrink-0 ${
                isAttachmentMenuOpen
                  ? 'bg-sky-100 text-sky-700'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              } disabled:opacity-50`}
              aria-label={t.chatAttachFile}
              title={t.chatAttachFile}
            >
              <Paperclip className="w-5 h-5 stroke-[2]" />
            </button>

            <input
              type="text"
              value={inputText}
              disabled={isLoading || isSending}
              maxLength={2000}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={pendingAttachment ? t.chatSendAttachment : t.chatPlaceholder}
              aria-label={t.chatPlaceholder}
              className="flex-1 h-12 px-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={(!inputText.trim() && !pendingAttachment) || isSending || isLoading}
              className="h-12 w-12 rounded-2xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white flex items-center justify-center shadow-md shadow-sky-600/20 transition-all disabled:opacity-40 disabled:pointer-events-none shrink-0"
              aria-label={t.chatSendBtn}
            >
              {isSending ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
          </>
        )}
      </footer>
    </div>
  );
};

