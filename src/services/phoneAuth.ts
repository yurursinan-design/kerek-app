import {
  ConfirmationResult,
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  signInWithCredential,
  signInWithPhoneNumber,
  signOut,
} from 'firebase/auth';
import { auth, ensureFirebaseAuth, isFirebaseConfigured } from './firebase';
import { clearPersonalLocalData } from './storage';

/**
 * SMS login.
 *
 * Everyone starts with an anonymous account. Verifying a phone number links it to that same
 * account, so requests and a provider profile created before logging in are kept, and the same
 * number later signs in to the same account on any device. Publishing (requests, offers, provider
 * profiles) requires a verified phone; the Firestore rules enforce that as well.
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

/** Sends an SMS code. `containerId` is an element that hosts the invisible reCAPTCHA. */
export async function sendSmsCode(phoneE164: string, containerId: string): Promise<ConfirmationResult> {
  if (!auth) throw new Error('Firebase Auth is not configured');
  await ensureFirebaseAuth();
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

type Lang = 'kz' | 'ru' | 'tr';

/** Localized message for Firebase phone-auth errors. */
export function phoneAuthErrorMessage(err: any, lang: Lang): string {
  const code = String(err?.code || '');
  const m = (kz: string, ru: string, tr: string) => (lang === 'kz' ? kz : lang === 'tr' ? tr : ru);
  switch (code) {
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return m('Телефон нөмірі қате. Мысалы: +7 701 123 45 67', 'Неверный номер. Например: +7 701 123 45 67', 'Telefon numarası hatalı. Örnek: +7 701 123 45 67');
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return m('Код қате. Қайта тексеріңіз.', 'Неверный код. Проверьте и попробуйте снова.', 'Kod hatalı. Kontrol edip tekrar deneyin.');
    case 'auth/code-expired':
      return m('Кодтың мерзімі өтті. Жаңа код сұраңыз.', 'Срок действия кода истёк. Запросите новый.', 'Kodun süresi doldu. Yeni kod isteyin.');
    case 'auth/too-many-requests':
      return m('Тым көп әрекет. Біраз уақыттан кейін қайталаңыз.', 'Слишком много попыток. Попробуйте позже.', 'Çok fazla deneme. Biraz sonra tekrar deneyin.');
    case 'auth/quota-exceeded':
      return m('Бүгінгі SMS шегі таусылды. Кейінірек қайталаңыз.', 'Лимит SMS на сегодня исчерпан. Попробуйте позже.', 'Bugünkü SMS sınırı doldu. Daha sonra tekrar deneyin.');
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return m('SMS арқылы кіру әлі қосылмаған.', 'Вход по SMS ещё не включён.', 'SMS ile giriş henüz açılmadı.');
    case 'auth/network-request-failed':
      return m('Интернет байланысы жоқ сияқты.', 'Похоже, нет подключения к интернету.', 'İnternet bağlantısı yok gibi görünüyor.');
    default:
      return m('SMS жіберу мүмкін болмады. Қайталап көріңіз.', 'Не удалось отправить SMS. Попробуйте снова.', 'SMS gönderilemedi. Tekrar deneyin.');
  }
}
