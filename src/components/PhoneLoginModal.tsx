import React, { useEffect, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { Loader2, Smartphone, X } from 'lucide-react';
import { Language } from '../types';
import { confirmSmsCode, normalizePhone, phoneAuthErrorMessage, resetPhoneVerifier, sendSmsCode } from '../services/phoneAuth';
import { recordLegalConsent } from '../services/account';
import { LegalLinks } from './LegalModal';

export type PhoneLoginReason = 'request' | 'provider' | 'header' | 'delete';

interface PhoneLoginModalProps {
  open: boolean;
  language: Language;
  reason: PhoneLoginReason;
  onSuccess: () => void;
  onCancel: () => void;
}

const RESEND_SECONDS = 60;

const TEXT = {
  title: { kz: 'Телефон арқылы кіру', ru: 'Вход по телефону', tr: 'Telefonla giriş' },
  reason: {
    request: {
      kz: 'Өтінішті шеберлерге жіберу үшін телефон нөміріңізді растаңыз. Нөміріңіз тапсырыс қабылданғанға дейін жасырын болады.',
      ru: 'Чтобы отправить заявку мастерам, подтвердите номер телефона. Номер скрыт до принятия заказа.',
      tr: 'Talebi ustalara göndermek için telefon numaranızı doğrulayın. Numaranız teklif kabul edilene kadar gizli kalır.',
    },
    provider: {
      kz: 'Орындаушы ретінде жұмыс істеу үшін телефон нөміріңізді растаңыз.',
      ru: 'Чтобы работать исполнителем, подтвердите номер телефона.',
      tr: 'Usta olarak çalışmak için telefon numaranızı doğrulayın.',
    },
    delete: {
      kz: 'Қауіпсіздік үшін аккаунтты жоюдан бұрын нөміріңізді қайта растаңыз.',
      ru: 'В целях безопасности подтвердите номер ещё раз перед удалением аккаунта.',
      tr: 'Güvenlik için hesabı silmeden önce numaranızı tekrar doğrulayın.',
    },
    header: {
      kz: 'Нөміріңізді растасаңыз, өтініштеріңіз бен профиліңіз кез келген құрылғыда сақталады.',
      ru: 'После подтверждения номера ваши заявки и профиль доступны на любом устройстве.',
      tr: 'Numaranızı doğruladığınızda talepleriniz ve profiliniz her cihazda erişilebilir olur.',
    },
  },
  phoneLabel: { kz: 'Телефон нөмірі', ru: 'Номер телефона', tr: 'Telefon numarası' },
  sendCode: { kz: 'Код жіберу', ru: 'Получить код', tr: 'Kod gönder' },
  codeLabel: { kz: 'SMS коды', ru: 'Код из SMS', tr: 'SMS kodu' },
  codeSentTo: { kz: 'Код жіберілді:', ru: 'Код отправлен на', tr: 'Kod gönderildi:' },
  confirm: { kz: 'Растау', ru: 'Подтвердить', tr: 'Doğrula' },
  changeNumber: { kz: 'Нөмірді өзгерту', ru: 'Изменить номер', tr: 'Numarayı değiştir' },
  resendIn: { kz: 'Қайта жіберу:', ru: 'Повторно через', tr: 'Tekrar gönder:' },
  resend: { kz: 'Кодты қайта жіберу', ru: 'Отправить код ещё раз', tr: 'Kodu tekrar gönder' },
  invalidPhone: {
    kz: 'Телефон нөмірі қате. Мысалы: +7 701 123 45 67',
    ru: 'Неверный номер. Например: +7 701 123 45 67',
    tr: 'Telefon numarası hatalı. Örnek: +7 701 123 45 67',
  },
  close: { kz: 'Жабу', ru: 'Закрыть', tr: 'Kapat' },
  consent: {
    kz: 'Мен Құпиялылық саясатымен және Пайдалану шарттарымен келісемін, дербес деректерімді өңдеуге келісім беремін. Маған 18 жас толған.',
    ru: 'Я принимаю Политику конфиденциальности и Условия использования и даю согласие на обработку персональных данных. Мне есть 18 лет.',
    tr: 'Gizlilik politikasını ve Kullanım şartlarını kabul ediyor, kişisel verilerimin işlenmesine onay veriyorum. 18 yaşından büyüğüm.',
  },
  consentRequired: {
    kz: 'Жалғастыру үшін келісім белгісін қойыңыз.',
    ru: 'Чтобы продолжить, отметьте согласие.',
    tr: 'Devam etmek için onay kutusunu işaretleyin.',
  },
} as const;

export const PhoneLoginModal: React.FC<PhoneLoginModalProps> = ({ open, language, reason, onSuccess, onCancel }) => {
  const lang = language as 'kz' | 'ru' | 'tr';
  const tx = (entry: { kz: string; ru: string; tr: string }) => entry[lang] || entry.ru;

  const [phone, setPhone] = useState('+7 ');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setCode('');
      setConfirmation(null);
      setError(null);
      setBusy(false);
      resetPhoneVerifier();
    }
  }, [open]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  useEffect(() => {
    if (confirmation) codeInputRef.current?.focus();
  }, [confirmation]);

  if (!open) return null;

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!agreed) {
      setError(tx(TEXT.consentRequired));
      return;
    }
    const normalized = normalizePhone(phone);
    if (!normalized) {
      setError(tx(TEXT.invalidPhone));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await sendSmsCode(normalized, 'kerek-recaptcha');
      setConfirmation(result);
      setSentTo(normalized);
      setSecondsLeft(RESEND_SECONDS);
    } catch (err) {
      setError(phoneAuthErrorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!confirmation || code.replace(/\D/g, '').length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await confirmSmsCode(confirmation, code.replace(/\D/g, ''));
      // Keep a record of the consent given in this form (date and policy version)
      recordLegalConsent().catch((err) => console.warn('[PhoneLogin] consent record note:', err));
      onSuccess();
    } catch (err) {
      setError(phoneAuthErrorMessage(err, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-login-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
    >
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 p-5 space-y-4 animate-slideUp">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <h2 id="phone-login-title" className="text-base font-bold text-slate-900 font-display leading-tight">
              {tx(TEXT.title)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={tx(TEXT.close)}
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed">{tx(TEXT.reason[reason])}</p>

        {!confirmation ? (
          <form onSubmit={handleSend} className="space-y-3">
            <label htmlFor="phone-login-number" className="block text-xs font-bold text-slate-700">
              {tx(TEXT.phoneLabel)}
            </label>
            <input
              id="phone-login-number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError(null);
              }}
              placeholder="+7 701 123 45 67"
              className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-base font-semibold text-slate-900 focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
            />
            <div className="flex items-start gap-2.5">
              <input
                id="phone-login-consent"
                type="checkbox"
                checked={agreed}
                onChange={(e) => {
                  setAgreed(e.target.checked);
                  if (error) setError(null);
                }}
                className="mt-0.5 w-5 h-5 shrink-0 accent-sky-600"
              />
              <div className="text-xs text-slate-600 leading-relaxed space-y-1">
                <label htmlFor="phone-login-consent">{tx(TEXT.consent)}</label>
                <LegalLinks language={language} className="block text-sky-700 font-semibold" />
              </div>
            </div>
            <button
              type="submit"
              disabled={busy || !agreed}
              className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm shadow-md shadow-sky-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{tx(TEXT.sendCode)}</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleConfirm} className="space-y-3">
            <p className="text-xs text-slate-500">
              {tx(TEXT.codeSentTo)} <span className="font-semibold text-slate-800">{sentTo}</span>
            </p>
            <label htmlFor="phone-login-code" className="block text-xs font-bold text-slate-700">
              {tx(TEXT.codeLabel)}
            </label>
            <input
              id="phone-login-code"
              ref={codeInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                if (error) setError(null);
              }}
              placeholder="••••••"
              className="w-full h-12 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-lg tracking-[0.4em] font-bold text-slate-900 text-center focus:outline-none focus:border-sky-500 focus:bg-white transition-colors"
            />
            <button
              type="submit"
              disabled={busy || code.length < 6}
              className="w-full min-h-[48px] rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm shadow-md shadow-sky-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{tx(TEXT.confirm)}</span>
            </button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => {
                  setConfirmation(null);
                  setCode('');
                  setError(null);
                }}
                className="min-h-[40px] font-semibold text-sky-700 hover:text-sky-900"
              >
                {tx(TEXT.changeNumber)}
              </button>
              {secondsLeft > 0 ? (
                <span className="text-slate-400">
                  {tx(TEXT.resendIn)} {secondsLeft}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={busy}
                  className="min-h-[40px] font-semibold text-sky-700 hover:text-sky-900 disabled:text-slate-400"
                >
                  {tx(TEXT.resend)}
                </button>
              )}
            </div>
          </form>
        )}

        {error && (
          <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
            {error}
          </div>
        )}

        {/* Host for the invisible reCAPTCHA that Firebase uses to protect SMS sending */}
        <div id="kerek-recaptcha" />
      </div>
    </div>
  );
};
