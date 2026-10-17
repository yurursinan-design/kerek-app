/**
 * Push messages in the phone app (Android now, iPhone later). Once someone is signed in, the app
 * asks for permission, registers this phone's push token under the account (pushTokens/{token},
 * with the screen language) so the server can send notices while the app is closed, and opens
 * the right screen when a notice is tapped. The website keeps its in-app notices.
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

type Lang = 'kz' | 'ru';
type OpenHandler = (data: Record<string, string>) => void;

let token: string | null = null;
let lang: Lang = 'ru';
let onOpen: OpenHandler | null = null;
let listening = false;
/** Account and language the token was last saved under */
let savedFor = '';

const isPhoneApp = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PushNotifications');

async function saveToken(): Promise<void> {
  const uid = auth?.currentUser?.uid;
  if (!token || !uid || !db) return;
  const key = `${uid}|${lang}`;
  if (key === savedFor) return;
  try {
    await setDoc(doc(db, 'pushTokens', token), {
      uid,
      platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
      lang,
      updatedAt: new Date().toISOString(),
    });
    savedFor = key;
  } catch (err) {
    console.warn('[Push] token not saved:', err);
  }
}

/**
 * Android plays a notice's sound from its channel, so new-job notices get their own channel with
 * KEREK's dombra strum (res/raw/dombra.wav). The server sends those notices on this channel id.
 * Creating it again only refreshes the name in the current language.
 */
const NEW_JOB_CHANNEL = 'new_jobs';

async function createNewJobChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await PushNotifications.createChannel({
      id: NEW_JOB_CHANNEL,
      name: lang === 'kz' ? 'Жаңа тапсырыстар' : 'Новые заказы',
      description: lang === 'kz' ? 'Жаңа тапсырыс келгенде домбыра дыбысы' : 'Звук домбры при новом заказе',
      sound: 'dombra.wav',
      importance: 4,
      visibility: 1,
      vibration: true,
    });
  } catch (err) {
    console.warn('[Push] new-job channel not created:', err);
  }
}

/** Registers this phone for the signed-in account; call again when the account or language changes. */
export async function startPushNotifications(language: Lang, handler: OpenHandler): Promise<void> {
  if (!isPhoneApp()) return;
  lang = language;
  onOpen = handler;
  try {
    if (!listening) {
      listening = true;
      await PushNotifications.addListener('registration', (t) => {
        token = t.value;
        void saveToken();
      });
      await PushNotifications.addListener('registrationError', (e) => console.warn('[Push] registration error:', e?.error));
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        onOpen?.((action.notification?.data || {}) as Record<string, string>);
      });
    }
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;
    await createNewJobChannel();
    if (token) await saveToken();
    else await PushNotifications.register();
  } catch (err) {
    console.warn('[Push] not available:', err);
  }
}

export type NotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** Whether this phone (push) or browser (notices while the tab is open) may show notifications */
export async function getNotificationPermission(): Promise<NotificationPermissionState> {
  if (isPhoneApp()) {
    try {
      const perm = await PushNotifications.checkPermissions();
      return perm.receive === 'granted' ? 'granted' : perm.receive === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'prompt';
}

/** "Turn on" on the profile tab: asks for permission and, on the phone, registers for push */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (isPhoneApp()) {
    try {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return perm.receive === 'denied' ? 'denied' : 'prompt';
      await createNewJobChannel();
      if (token) await saveToken();
      else await PushNotifications.register();
      return 'granted';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unsupported';
  }
}

/** Logout or account deletion: this phone stops getting the account's notices. */
export async function forgetPushToken(): Promise<void> {
  if (!token || !db || !auth?.currentUser) return;
  try {
    await deleteDoc(doc(db, 'pushTokens', token));
  } catch {
    // Already removed or owned by another account
  }
  savedFor = '';
}
