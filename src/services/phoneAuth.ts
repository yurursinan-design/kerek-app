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

/**
 * SMS login.
 *
 * Everyone starts with an anonymous account. Verifying a phone number links it to that same
 * account, so requests and a provider profile created before logging in are kept, and the same
 * number later signs in to the same account on any device. Publishing (requests, offers, provider
 * profiles) requires a verified phone; the Firestore rules enforce that as well.
 *
 * The code is texted by the requestLoginCode / verifyLoginCode cloud functions through a
 * Kazakhstan SMS gateway (Firebase's own SMS doesn't reach +7 numbers for this project). Against
 * the Auth emulator (tests) Firebase's phone sign-in is used, as the emulator prints the codes.
 */

/** Normalizes Kazakhstan numbers typed as "+7 701 …", "8 701 …" or "701 …" to E.164 (+77011234567). */
export function normalizePhone(raw: string): string | null {
  const trimmed = (raw || '').trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+')) {
    if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
    else if (digits.length === 10 && digits.startsWith('7')) digits = '7' + digits;
  }
  // Kazakhstan numbers only (+7 7xx / +7 6xx). +7 is shared with Russia, and limiting SMS to
  // Kazakhstan also keeps the login from being abused to send paid SMS abroad.
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

/**
 * Sends an SMS code. `containerId` hosts the invisible reCAPTCHA of the emulator flow; `lang` picks
 * the SMS text.
 */
export async function sendSmsCode(phoneE164: string, containerId: string, lang: Lang = 'ru'): Promise<ConfirmationResult> {
  if (!auth) throw new Error('Firebase Auth is not configured');
  await ensureFirebaseAuth();
  if (!auth.emulatorConfig) return sendSmsCodeViaGateway(phoneE164, lang);
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
 * Code texted by the requestLoginCode function. Confirming it returns a custom token for the
 * account that now carries this number (the caller's own, or the one already registered with it);
 * signing in with it is a fresh sign-in, so the phone_number claim is there right away.
 */
async function sendSmsCodeViaGateway(phoneE164: string, lang: Lang): Promise<ConfirmationResult> {
  const functions = getFunctions(app!, 'asia-south1');
  await httpsCallable<{ phone: string; lang: Lang }, { ok: true; retryAfter: number }>(functions, 'requestLoginCode')({
    phone: phoneE164,
    lang,
  });
  return {
    verificationId: 'sms-gateway',
    confirm: async (code: string) => {
      if (!auth) throw new Error('Firebase Auth is not configured');
      const { data } = await httpsCallable<{ phone: string; code: string }, { token: string }>(functions, 'verifyLoginCode')({
        phone: phoneE164,
        code,
      });
      return signInWithCustomToken(auth, data.token);
    },
  } as ConfirmationResult;
}

/**
 * Confirms the SMS code. If the number already belongs to another account (the person used KEREK
 * on another phone), that account is signed in instead of linking.
 */
export async function confirmSmsCode(confirmation: ConfirmationResult, code: string): Promise<void> {
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
      return m('SMS жіберу мүмкін болмады. Біраз уақыттан кейін қайталаңыз.', 'Не удалось отправить SMS. Попробуйте чуть позже.');
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
      return m('Бүгінгі SMS шегі таусылды. Кейінірек қайталаңыз.', 'Лимит SMS на сегодня исчерпан. Попробуйте позже.');
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return m('SMS арқылы кіру әлі қосылмаған.', 'Вход по SMS ещё не включён.');
    case 'auth/network-request-failed':
      return m('Интернет байланысы жоқ сияқты.', 'Похоже, нет подключения к интернету.');
    default: {
      // The technical reason in small print helps to find the cause when someone reports it
      const detail = code || message.slice(0, 80);
      const base = m('SMS жіберу мүмкін болмады. Қайталап көріңіз.', 'Не удалось отправить SMS. Попробуйте снова.');
      return detail ? `${base} (${detail})` : base;
    }
  }
}
