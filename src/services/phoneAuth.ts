import {
  ConfirmationResult,
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  signInWithCredential,
  signInWithCustomToken,
  signInWithPhoneNumber,
  signOut,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth, ensureFirebaseAuth, isFirebaseConfigured } from './firebase';
import { clearPersonalLocalData } from './storage';
import { forgetPushToken } from './pushNotifications';
import { getDeviceId } from './deviceId';
import { LEGAL_VERSION } from '../data/legalTexts';

/**
 * Phone login.
 *
 * Everyone starts with an anonymous account. Verifying a phone number links it to that same
 * account, so requests and a provider profile created before logging in are kept, and the same
 * number later signs in to the same account on any device. Publishing (requests, offers, provider
 * profiles) requires a verified phone; the Firestore rules enforce that as well.
 *
 * The code is sent to the number's WhatsApp or Telegram by the requestLoginCode / verifyLoginCode
 * cloud functions. Against the Auth emulator (tests) Firebase's phone sign-in is used, as the emulator
 * prints the codes.
 */

/** Normalizes Kazakhstan numbers typed as "+7 701 …", "8 701 …" or "701 …" to E.164 (+77011234567). */
export function normalizePhone(raw: string): string | null {
  const trimmed = (raw || '').trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
    else if (digits.length === 10 && digits.startsWith('7')) digits = '7' + digits;
  }
  // Kazakhstan numbers only (+7 7xx / +7 6xx). +7 is shared with Russia, and limiting codes to
  // Kazakhstan also keeps the login from being abused to send paid messages abroad.
  if (!/^7[67]\d{9}$/.test(digits)) return null;
  return `+${digits}`;
}

export function isPhoneVerified(): boolean {
  return Boolean(auth?.currentUser?.phoneNumber);
}

/** True when the cloud is active and the current account has no verified phone yet. */
export function requiresPhoneLogin(): boolean {
  return isFirebaseConfigured() && Boolean(auth) && !isPhoneVerified();
}

export function maskPhone(phone?: string | null): string {
  if (!phone) return '';
  return phone.length > 6 ? `${phone.slice(0, 2)} ••• ${phone.slice(-4, -2)} ${phone.slice(-2)}` : phone;
}

type Lang = 'kz' | 'ru';

let verifier: RecaptchaVerifier | null = null;

/** Drops the invisible reCAPTCHA; call when the login dialog closes (its host element goes away). */
export function resetPhoneVerifier() {
  resetVerifier();
}

function resetVerifier() {
  try {
    verifier?.clear();
  } catch {}
  verifier = null;
}

export type LoginChannel = 'whatsapp' | 'telegram';

/** A sent code: where it went (WhatsApp or Telegram) and which channels the server offers */
export type LoginConfirmation = ConfirmationResult & { channel?: LoginChannel; channels?: LoginChannel[] };

/**
 * Sends a login code. `containerId` hosts the invisible reCAPTCHA of the emulator flow; `lang` picks
 * the language of the WhatsApp message; `channel` asks for WhatsApp or Telegram (the server falls
 * back to the one that is set up).
 */
export async function sendLoginCode(
  phoneE164: string,
  containerId: string,
  lang: Lang = 'ru',
  channel?: LoginChannel
): Promise<LoginConfirmation> {
  if (!auth) throw new Error('Firebase Auth is not configured');
  await ensureFirebaseAuth();
  if (!auth.emulatorConfig) return sendCodeByMessage(phoneE164, lang, channel);
  if (auth.emulatorConfig) {
    // The Auth emulator has no reCAPTCHA
    auth.settings.appVerificationDisabledForTesting = true;
  }
  if (!verifier) {
    verifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  }
  try {
    const user = auth.currentUser;
    if (user && user.isAnonymous) {
      return await linkWithPhoneNumber(user, phoneE164, verifier);
    }
    return await signInWithPhoneNumber(auth, phoneE164, verifier);
  } catch (err) {
    resetVerifier();
    throw err;
  }
}

/**
 * Code sent by the requestLoginCode function to WhatsApp or Telegram. Confirming it returns a custom token for the
 * account that now carries this number (the caller's own, or the one already registered with it);
 * signing in with it is a fresh sign-in, so the phone_number claim is there right away.
 */
async function sendCodeByMessage(phoneE164: string, lang: Lang, channel?: LoginChannel): Promise<LoginConfirmation> {
  const functions = getFunctions(app!, 'asia-south1');
  const { data: sent } = await httpsCallable<
    { phone: string; lang: Lang; channel?: LoginChannel },
    { ok: true; retryAfter: number; channel?: LoginChannel; channels?: LoginChannel[] }
  >(functions, 'requestLoginCode')({
    phone: phoneE164,
    lang,
    ...(channel ? { channel } : {}),
  });
  return {
    verificationId: 'message-code',
    channel: sent?.channel || 'whatsapp',
    channels: sent?.channels || [],
    confirm: async (code: string) => {
      if (!auth) throw new Error('Firebase Auth is not configured');
      const deviceId = await getDeviceId();
      // The login form is sent only with the consent box ticked; the server records this version
      const { data } = await httpsCallable<{ phone: string; code: string; deviceId?: string; consentVersion: string }, { token: string }>(
        functions,
        'verifyLoginCode'
      )({
        phone: phoneE164,
        code,
        consentVersion: LEGAL_VERSION,
        ...(deviceId ? { deviceId } : {}),
      });
      return signInWithCustomToken(auth, data.token);
    },
  } as LoginConfirmation;
}

/**
 * Confirms the login code. If the number already belongs to another account (the person used KEREK
 * on another phone), that account is signed in instead of linking.
 */
export async function confirmLoginCode(confirmation: ConfirmationResult, code: string): Promise<void> {
  if (!auth) throw new Error('Firebase Auth is not configured');
  try {
    await confirmation.confirm(code.trim());
  } catch (err: any) {
    const code_ = err?.code || '';
    if (code_ === 'auth/credential-already-in-use' || code_ === 'auth/account-exists-with-different-credential') {
      const credential = PhoneAuthProvider.credentialFromError(err);
      if (!credential) throw err;
      await signInWithCredential(auth, credential);
    } else {
      throw err;
    }
  }
  resetVerifier();
  // Fresh ID token so Firestore sees the phone_number claim right away
  await auth.currentUser?.getIdToken(true);
}

/** Signs out and continues as a new anonymous visitor. */
export async function logoutToAnonymous(): Promise<void> {
  if (!auth) return;
  // This phone stops getting the account's push messages
  await forgetPushToken();
  await signOut(auth);
  clearPersonalLocalData();
  await ensureFirebaseAuth();
}


/** Localized message for Firebase phone-auth errors. */
export function phoneAuthErrorMessage(err: any, lang: Lang): string {
  const code = String(err?.code || '');
  const m = (kz: string, ru: string) => (lang === 'kz' ? kz : ru);
  const message = String(err?.message || '');
  switch (code) {
    case 'functions/invalid-argument':
      return /code/i.test(message)
        ? m('Код қате. Қайта тексеріңіз.', 'Неверный код. Проверьте и попробуйте снова.')
        : m('Телефон нөмірі қате. Мысалы: +7 701 123 45 67', 'Неверный номер. Например: +7 701 123 45 67');
    case 'functions/deadline-exceeded':
      return m('Кодтың мерзімі өтті. Жаңа код сұраңыз.', 'Срок действия кода истёк. Запросите новый.');
    case 'functions/resource-exhausted':
      return m('Тым көп әрекет. Бір минуттан кейін қайталаңыз.', 'Слишком много попыток. Попробуйте через минуту.');
    case 'functions/unavailable':
    case 'functions/internal':
      return m('Кодты жіберу мүмкін болмады. Біраз уақыттан кейін қайталаңыз.', 'Не удалось отправить код. Попробуйте чуть позже.');
    case 'functions/not-found':
      return m(
        'Бұл нөмірде Telegram жоқ. Telegram орнатып, осы нөмірмен тіркеліңіз де, кодты қайта сұраңыз.',
        'На этом номере нет Telegram. Установите Telegram, зарегистрируйтесь с этим номером и запросите код снова.'
      );
    case 'functions/failed-precondition':
      return m('Телефон арқылы кіру әлі қосылмаған.', 'Вход по номеру телефона ещё не включён.');
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return m('Телефон нөмірі қате. Мысалы: +7 701 123 45 67', 'Неверный номер. Например: +7 701 123 45 67');
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return m('Код қате. Қайта тексеріңіз.', 'Неверный код. Проверьте и попробуйте снова.');
    case 'auth/code-expired':
      return m('Кодтың мерзімі өтті. Жаңа код сұраңыз.', 'Срок действия кода истёк. Запросите новый.');
    case 'auth/too-many-requests':
      return m('Тым көп әрекет. Біраз уақыттан кейін қайталаңыз.', 'Слишком много попыток. Попробуйте позже.');
    case 'auth/quota-exceeded':
      return m('Бүгінгі код шегі таусылды. Кейінірек қайталаңыз.', 'Лимит кодов на сегодня исчерпан. Попробуйте позже.');
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return m('Телефон арқылы кіру әлі қосылмаған.', 'Вход по номеру телефона ещё не включён.');
    case 'auth/network-request-failed':
      return m('Интернет байланысы жоқ сияқты.', 'Похоже, нет подключения к интернету.');
    default: {
      // The technical reason in small print helps to find the cause when someone reports it
      const detail = code || message.slice(0, 80);
      const base = m('Кодты жіберу мүмкін болмады. Қайталап көріңіз.', 'Не удалось отправить код. Попробуйте снова.');
      return detail ? `${base} (${detail})` : base;
    }
  }
}
