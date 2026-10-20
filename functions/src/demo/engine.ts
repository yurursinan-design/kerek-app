import type { Content, GenerateContentConfig, GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { ThinkingLevel } from '@google/genai';
import { GEMINI_CONFIG } from '../config';
import { nextId } from './calendar';
import { systemPrompt } from './prompt';
import { ALERT_TEXT, dayLabel, detectLang, T } from './texts';
import { runTool, toolDeclarations } from './tools';
import type { Alert, ChatMessage, Session } from './types';

/** What the engine needs from the Gemini client (GoogleGenAI fits; tests pass a fake). */
export interface GeminiLike {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}

export interface MediaInput {
  data: string;
  mime: string;
}

export interface CustomerInput {
  text?: string;
  /** A tapped button's id */
  button?: string;
  voice?: MediaInput & { seconds: number };
  photo?: MediaInput;
}

const MAX_MESSAGES = 120;
const HISTORY = 24;
const TOOL_ROUNDS = 6;
const CALL_TIMEOUT_MS = 20_000;
/**
 * Chat answers come from the light model first: under load the main model took a minute or more
 * per answer in tests, the light one a few seconds, and tool use and Kazakh were fine. The main
 * model reads price lists (photos) first, where quality matters more than speed.
 */
export const FAST_FIRST = [GEMINI_CONFIG.fallbackModel, GEMINI_CONFIG.model];
export const QUALITY_FIRST = [GEMINI_CONFIG.model, GEMINI_CONFIG.fallbackModel];

/**
 * One Gemini call with fallbacks: the main model, then the lighter one. Low thinking keeps answers
 * fast; a model that doesn't accept the setting is asked again without it.
 */
export async function generate(ai: GeminiLike, contents: Content[], config: GenerateContentConfig, models: string[] = FAST_FIRST): Promise<GenerateContentResponse> {
  let last: unknown = null;
  for (const model of models) {
    for (const thinking of [true, false]) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          // A stuck call gives up in time for the fallback model and the function's own time limit
          config: { ...config, httpOptions: { timeout: CALL_TIMEOUT_MS }, ...(thinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}) },
        });
      } catch (err) {
        last = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[demo] ${model}${thinking ? ' (low thinking)' : ''} failed:`, msg.slice(0, 200));
        if (!thinking || !/thinking/i.test(msg)) break;
      }
    }
  }
  throw last ?? new Error('Gemini failed');
}

function push(session: Session, m: Omit<ChatMessage, 'id' | 'at'>, nowMs: number): ChatMessage {
  const msg: ChatMessage = { id: nextId(session, 'm'), at: nowMs, ...m };
  for (const k of Object.keys(msg) as (keyof ChatMessage)[]) if (msg[k] === undefined) delete msg[k];
  session.messages.push(msg);
  if (session.messages.length > MAX_MESSAGES) session.messages.splice(0, session.messages.length - MAX_MESSAGES);
  return msg;
}

function openAlert(session: Session, kind: Alert['kind'], text: { ru: string; kz: string }, nowMs: number, refId?: string): void {
  if (session.alerts.some((a) => !a.done && a.kind === kind && a.refId === refId)) return;
  const alert: Alert = { id: nextId(session, 'a'), at: nowMs, kind, text_ru: text.ru, text_kz: text.kz, done: false };
  if (refId) alert.refId = refId;
  session.alerts.push(alert);
  if (session.alerts.length > 40) session.alerts.splice(0, session.alerts.length - 40);
}

function closeAlerts(session: Session, kinds: Alert['kind'][]): void {
  for (const a of session.alerts) if (kinds.includes(a.kind)) a.done = true;
}

/** WhatsApp formatting: *bold*, not Markdown's **bold**; no leaked labels. */
export function cleanReply(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#+\s*/gm, '')
    .replace(/\(Ответил администратор лично\)\s*/g, '')
    .replace(/\[(Голосовое|Фото)[^\]]*\]\s*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500);
}

/** The conversation as Gemini sees it: consent messages left out, consecutive turns merged. */
export function historyContents(session: Session): Content[] {
  const out: Content[] = [];
  for (const m of session.messages.filter((x) => x.fixed !== 'consent').slice(-HISTORY)) {
    const role = m.from === 'customer' ? 'user' : 'model';
    let text = m.text;
    if (m.from === 'customer' && m.kind === 'voice') text = `[Голосовое] ${m.note || '(не удалось разобрать)'}`;
    if (m.from === 'customer' && m.kind === 'photo') text = `[Фото: ${m.note || 'фото'}] ${m.text}`.trim();
    if (m.from === 'owner') text = `(Ответил администратор лично) ${m.text}`;
    if (!text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts!.push({ text });
    else out.push({ role, parts: [{ text }] });
  }
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', parts: [{ text: '(начало переписки)' }] });
  return out;
}

/** "I passed it to the administrator", "the administrator will reply" (Russian and Kazakh) */
const PROMISED_OWNER = /(администратор\S*[^.!?\n]{0,40}(свяж|ответ|напиш|перезвон)|(передал|передала|передам)[^.!?\n]{0,40}администратор|әкімші\S*[^.!?\n]{0,40}(жауап бер|хабарлас|жаз)|әкімшіге[^.!?\n]{0,30}(жібердім|жеткіздім|хабарладым|беремін))/i;

async function modelReply(session: Session, ai: GeminiLike, nowMs: number): Promise<string> {
  const contents = historyContents(session);
  const config: GenerateContentConfig = {
    systemInstruction: systemPrompt(session.business, nowMs),
    tools: [{ functionDeclarations: toolDeclarations(session.business) }],
    temperature: 0.3,
    maxOutputTokens: 1200,
  };
  let handedOff = false;
  for (let round = 0; round < TOOL_ROUNDS; round++) {
    const res = await generate(ai, contents, config);
    const calls = res.functionCalls ?? [];
    if (!calls.length) {
      const text = cleanReply(res.text ?? '');
      if (!text) throw new Error('empty answer');
      // Told the customer the owner will answer but forgot the tool: the owner is told anyway
      if (!handedOff && PROMISED_OWNER.test(text)) {
        const last = [...session.messages].reverse().find((m) => m.from === 'customer');
        runTool(session, 'handoff_to_owner', { reason: (last?.note || last?.text || '').slice(0, 120) }, nowMs);
      }
      return text;
    }
    if (calls.some((c) => c.name === 'handoff_to_owner')) handedOff = true;
    const content = res.candidates?.[0]?.content;
    if (!content) throw new Error('no content with the tool calls');
    // The model's own turn goes back unchanged: it carries the thought signatures Gemini checks
    contents.push(content);
    contents.push({
      role: 'user',
      parts: calls.map((c) => ({
        functionResponse: { id: c.id, name: c.name, response: runTool(session, c.name ?? '', (c.args ?? {}) as Record<string, unknown>, nowMs) },
      })),
    });
  }
  throw new Error('too many tool rounds');
}

async function answer(session: Session, ai: GeminiLike, nowMs: number): Promise<void> {
  const started = Date.now();
  try {
    const text = await modelReply(session, ai, nowMs);
    push(session, { from: 'bot', text, tookMs: Date.now() - started }, nowMs + (Date.now() - started));
  } catch (err) {
    console.warn('[demo] no answer:', err instanceof Error ? err.message : err);
    push(session, { from: 'bot', text: T.failed(session.chatLang), fixed: 'error' }, nowMs);
    openAlert(session, 'error', ALERT_TEXT.failed, nowMs);
  }
}

/** Speech to text, so the owner can read voice messages and the assistant can answer them. */
export async function transcribe(ai: GeminiLike, voice: MediaInput): Promise<string> {
  const res = await generate(
    ai,
    [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: voice.mime, data: voice.data } },
          { text: 'Дословно перепиши это голосовое сообщение клиента на языке оригинала (русский, казахский или смешанный). Только текст, без пояснений. Если речи не слышно, ответь: (неразборчиво)' },
        ],
      },
    ],
    { temperature: 0, maxOutputTokens: 500 },
  );
  return (res.text ?? '').trim().slice(0, 1000) || '(неразборчиво)';
}

export async function describePhoto(ai: GeminiLike, session: Session, photo: MediaInput, caption: string): Promise<string> {
  const b = session.business;
  const res = await generate(
    ai,
    [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: photo.mime, data: photo.data } },
          {
            text: `Клиент прислал это фото в WhatsApp заведению «${b.name}» (${b.type_ru})${caption ? ` с подписью: «${caption}»` : ''}. Опиши по-русски одним коротким предложением, что на фото и что, вероятно, нужно клиенту.`,
          },
        ],
      },
    ],
    { temperature: 0.2, maxOutputTokens: 200 },
  );
  return (res.text ?? '').trim().slice(0, 300) || 'фото';
}

function findButton(session: Session, id: string): string | null {
  for (let i = session.messages.length - 1; i >= Math.max(0, session.messages.length - 30); i--) {
    const b = session.messages[i].buttons?.find((x) => x.id === id);
    if (b) return b.label;
  }
  return null;
}

/** Media sent before consent waits unprocessed; the page sends it again with the consent tap. */
async function processPendingMedia(session: Session, ai: GeminiLike, input: CustomerInput): Promise<void> {
  const pending = session.messages.filter((m) => m.from === 'customer' && m.kind && !m.note);
  const latest = pending[pending.length - 1];
  if (!latest) return;
  try {
    if (latest.kind === 'voice' && input.voice) latest.note = await transcribe(ai, input.voice);
    if (latest.kind === 'photo' && input.photo) latest.note = await describePhoto(ai, session, input.photo, latest.text);
  } catch (err) {
    console.warn('[demo] media failed:', err instanceof Error ? err.message : err);
  }
}

/** A message or button tap from the customer side of the demo. */
export async function customerTurn(session: Session, input: CustomerInput, ai: GeminiLike, nowMs: number): Promise<void> {
  if (input.button) {
    const label = findButton(session, input.button);
    if (!label) throw new Error('unknown button');
    const [action, ref] = input.button.split(':');
    if (action === 'consent_yes' || action === 'consent_owner') {
      if (session.consent === 'given') return;
      push(session, { from: 'customer', text: label, fixed: 'consent' }, nowMs);
      if (action === 'consent_yes') {
        session.consent = 'given';
        closeAlerts(session, ['no_consent']);
        await processPendingMedia(session, ai, input);
        if (!session.botPaused) await answer(session, ai, nowMs);
      } else {
        push(session, { from: 'bot', text: T.ownerWillAnswer(session.chatLang), fixed: 'consent' }, nowMs);
        session.botPaused = true;
        openAlert(session, 'handoff', ALERT_TEXT.askedOwner, nowMs);
      }
      return;
    }
    if (action === 'remind_yes') {
      push(session, { from: 'customer', text: label }, nowMs);
      push(session, { from: 'bot', text: T.remindYes(session.chatLang), fixed: 'reminder' }, nowMs);
      return;
    }
    if (action === 'remind_move' && ref) {
      push(session, { from: 'customer', text: label }, nowMs);
      return afterCustomerMessage(session, ai, nowMs);
    }
    throw new Error('unknown button');
  }

  const text = String(input.text ?? '').replace(/\r/g, '').trim().slice(0, 1000);
  if (input.voice) {
    const msg = push(session, { from: 'customer', text: '', kind: 'voice', seconds: Math.max(1, Math.round(input.voice.seconds)) }, nowMs);
    // Nothing goes to the AI before consent; the voice waits for the consent tap
    if (session.consent === 'given') {
      try {
        msg.note = await transcribe(ai, input.voice);
      } catch (err) {
        console.warn('[demo] transcription failed:', err instanceof Error ? err.message : err);
      }
    }
    if (msg.note) session.chatLang = detectLang(msg.note, session.chatLang);
  } else if (input.photo) {
    const msg = push(session, { from: 'customer', text, kind: 'photo' }, nowMs);
    if (session.consent === 'given') {
      try {
        msg.note = await describePhoto(ai, session, input.photo, text);
      } catch (err) {
        console.warn('[demo] photo failed:', err instanceof Error ? err.message : err);
      }
    }
    if (text) session.chatLang = detectLang(text, session.chatLang);
  } else {
    if (!text) throw new Error('empty message');
    push(session, { from: 'customer', text }, nowMs);
    session.chatLang = detectLang(text, session.chatLang);
  }
  return afterCustomerMessage(session, ai, nowMs);
}

async function afterCustomerMessage(session: Session, ai: GeminiLike, nowMs: number): Promise<void> {
  if (session.botPaused) {
    openAlert(session, 'paused', ALERT_TEXT.paused, nowMs);
    return;
  }
  if (session.consent === 'none') {
    push(session, { from: 'bot', text: T.consent(session.business, session.chatLang), buttons: T.consentButtons(session.chatLang), fixed: 'consent' }, nowMs);
    session.consent = 'asked';
    return;
  }
  if (session.consent === 'asked') {
    // Typed instead of tapping: the owner is told, so the message isn't lost; the buttons come once more
    if (!session.alerts.some((a) => !a.done && a.kind === 'no_consent')) {
      push(session, { from: 'bot', text: T.consentAgain(session.chatLang), buttons: T.consentButtons(session.chatLang), fixed: 'consent' }, nowMs);
      openAlert(session, 'no_consent', ALERT_TEXT.noConsent, nowMs);
    }
    return;
  }
  await answer(session, ai, nowMs);
}

export type OwnerAction =
  | { action: 'reply'; text: string }
  | { action: 'resume' }
  | { action: 'confirm' | 'reject'; id: string }
  | { action: 'remind'; id: string }
  | { action: 'dismiss'; id: string };

/** What the owner does in the panel. Throws on an invalid action. */
export function ownerAction(session: Session, a: OwnerAction, nowMs: number): void {
  const lang = session.chatLang;
  switch (a.action) {
    case 'reply': {
      const text = String(a.text ?? '').replace(/\r/g, '').trim().slice(0, 800);
      if (!text) throw new Error('empty');
      push(session, { from: 'owner', text }, nowMs);
      // The owner took over this chat: the assistant stays quiet until handed back
      session.botPaused = true;
      closeAlerts(session, ['handoff', 'no_consent', 'paused', 'error']);
      return;
    }
    case 'resume':
      session.botPaused = false;
      closeAlerts(session, ['paused']);
      return;
    case 'confirm':
    case 'reject': {
      const o = session.orders.find((x) => x.id === a.id && x.source === 'bot' && x.status === 'new');
      if (!o) throw new Error('order not found');
      o.status = a.action === 'confirm' ? 'confirmed' : 'rejected';
      for (const al of session.alerts) if (al.refId === o.id) al.done = true;
      push(session, { from: 'bot', text: a.action === 'confirm' ? T.orderConfirmed(session.business, o, lang, nowMs) : T.orderRejected(lang), fixed: 'order_status' }, nowMs);
      return;
    }
    case 'remind': {
      const bk = session.bookings.find((x) => x.id === a.id && x.source === 'bot' && x.status === 'active');
      if (!bk) throw new Error('booking not found');
      const b = session.business;
      const service = b.services.find((s) => s.id === bk.serviceId);
      const staff = b.staff.find((s) => s.id === bk.staffId);
      push(
        session,
        {
          from: 'bot',
          text: T.reminder(lang, dayLabel(bk.date, nowMs, lang), bk.start, service ? (lang === 'kz' ? service.kz : service.ru) : '', staff?.name ?? '', b.address),
          buttons: T.reminderButtons(lang, bk.id),
          fixed: 'reminder',
        },
        nowMs,
      );
      bk.remindedAt = nowMs;
      return;
    }
    case 'dismiss': {
      const al = session.alerts.find((x) => x.id === a.id);
      if (al) al.done = true;
      return;
    }
    default:
      throw new Error('unknown action');
  }
}
