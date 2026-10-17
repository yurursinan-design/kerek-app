import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Flag, Loader2, MessageSquareText, Phone, Search, ShieldCheck, Users, X } from 'lucide-react';
import { Language, Provider } from '../types';
import { getFriendlyErrorMessage } from '../services';
import { REPORT_REASONS } from '../services/reports';
import { toTelHref } from '../services/phoneLinks';
import { reviewsCountLabel } from '../services/publicStats';
import {
  AdminReport,
  blockAccount,
  checkAdminRole,
  decideReviewCheck,
  HealthNumbers,
  AdminLogEntry,
  ConversationEvidence,
  isAccountBlocked,
  loadAdminLog,
  loadConversationEvidence,
  loadHealthNumbers,
  loadMasters,
  loadReports,
  loadReviewChecks,
  MasterFlag,
  reportedAccount,
  resolveReport,
  ReviewCheck,
  ReviewContext,
  reviewerPhone,
  reviewNeedsDecision,
  setMasterFlag,
  unblockAccount,
} from '../services/admin';

type Tab = 'health' | 'reviews' | 'reports' | 'masters';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A check that has not finished after this long will not finish by itself: the operator decides */
const CHECK_STUCK_MS = 5 * 60 * 1000;

/** Published by the review check although something was noticed: shown until the operator looks at it */
const flaggedByCheck = (r: ReviewCheck) => r.status === 'published' && r.decidedBy === 'ai' && r.signals.length > 0;

/** The operator's panel: health numbers, review check, reports and masters (badges, hiding, blocking). */
export const AdminScreen: React.FC<{ language: Language; onClose: () => void }> = ({ language, onClose }) => {
  const kz = language === 'kz';
  const tx = (k: string, r: string) => (kz ? k : r);
  const [tab, setTab] = useState<Tab>('health');
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthNumbers | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [masters, setMasters] = useState<Provider[] | null>(null);
  const [reviewChecks, setReviewChecks] = useState<ReviewCheck[] | null>(null);
  const [showDecided, setShowDecided] = useState(false);
  // Customers' numbers the operator looked up for a check call, by review
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});
  const [evidence, setEvidence] = useState<Record<string, ConversationEvidence>>({});
  const [adminLog, setAdminLog] = useState<AdminLogEntry[] | null>(null);
  // Opening the panel asks the server again, which also refreshes the operator list the rules check
  const [ready, setReady] = useState(false);

  useEffect(() => {
    checkAdminRole(true)
      .catch(() => false)
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    setError(null);
    const fail = (err: unknown) => setError(getFriendlyErrorMessage(err, language));
    if (tab === 'health' && !health) loadHealthNumbers().then(setHealth).catch(fail);
    if (tab === 'health' && !adminLog) loadAdminLog().then(setAdminLog).catch(() => setAdminLog([]));
    if (tab === 'reports' && !reports) loadReports().then(setReports).catch(fail);
    if (tab === 'masters' && !masters) loadMasters().then(setMasters).catch(fail);
    if (tab === 'reviews' && !reviewChecks) loadReviewChecks().then(setReviewChecks).catch(fail);
  }, [ready, tab, health, adminLog, reports, masters, reviewChecks, language]);

  // Loaded at once so the tab shows how many reviews wait for a decision
  useEffect(() => {
    if (!ready) return;
    loadReviewChecks()
      .then(setReviewChecks)
      .catch(() => {
        // shown when the tab is opened
      });
  }, [ready]);

  const visibleReports = useMemo(
    () => (reports || []).filter((r) => showResolved || r.status !== 'resolved'),
    [reports, showResolved]
  );
  const visibleChecks = useMemo(
    () => (reviewChecks || []).filter((r) => showDecided || reviewNeedsDecision(r) || flaggedByCheck(r)),
    [reviewChecks, showDecided]
  );
  const waitingReviews = (reviewChecks || []).filter(reviewNeedsDecision).length;
  const visibleMasters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (masters || []).filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.phone || '').includes(q));
  }, [masters, search]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(getFriendlyErrorMessage(err, language));
    } finally {
      setBusy(null);
    }
  };

  const toggleFlag = (m: Provider, flag: MasterFlag) =>
    run(`${m.id}_${flag}`, async () => {
      const value = !m[flag];
      await setMasterFlag(m.id, flag, value);
      setMasters((list) => (list || []).map((x) => (x.id === m.id ? { ...x, [flag]: value } : x)));
    });

  const reportAction = (r: AdminReport, action: 'block' | 'resolve') =>
    run(`${r.id}_${action}`, async () => {
      if (action === 'block') {
        const who = r.targetType === 'conversation' ? (evidence[r.id] || (await loadConversationEvidence(r.id))).reported : await reportedAccount(r);
        if (!who) throw new Error('Validation Error: ' + tx('Тіркелгі табылмады', 'Аккаунт не найден'));
        await blockAccount(who.uid, r.reason, who.isMaster);
        setBlocked((b) => ({ ...b, [who.uid]: true }));
        await resolveReport(r.id, tx('Бұғатталды', 'Заблокирован'));
      } else {
        await resolveReport(r.id, tx('Қаралды', 'Рассмотрено'));
      }
      setReports((list) => (list || []).map((x) => (x.id === r.id ? { ...x, status: 'resolved' } : x)));
    });

  /** A chat report: the conversation is shown only on request, and every look is logged */
  const showEvidence = (r: AdminReport) =>
    run(`${r.id}_evidence`, async () => {
      const ev = await loadConversationEvidence(r.id);
      setEvidence((e) => ({ ...e, [r.id]: ev }));
    });

  const decideReview = (r: ReviewCheck, action: 'publish' | 'reject') =>
    run(`${r.id}_${action}`, async () => {
      const status = await decideReviewCheck(r.id, action);
      setReviewChecks((list) => (list || []).map((x) => (x.id === r.id ? { ...x, status, decidedBy: 'operator' } : x)));
    });

  const showPhone = (r: ReviewCheck) =>
    run(`${r.id}_phone`, async () => {
      const phone = await reviewerPhone(r.id);
      setPhones((p) => ({ ...p, [r.id]: phone }));
    });

  const toggleBlockMaster = (m: Provider) =>
    run(`${m.id}_block`, async () => {
      const isBlocked = blocked[m.id] ?? (await isAccountBlocked(m.id));
      if (isBlocked || m.blocked) await unblockAccount(m.id);
      else await blockAccount(m.id, 'admin', true);
      const next = !(isBlocked || m.blocked);
      setBlocked((b) => ({ ...b, [m.id]: next }));
      setMasters((list) => (list || []).map((x) => (x.id === m.id ? { ...x, blocked: next } : x)));
    });

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'health', label: tx('Шолу', 'Обзор'), icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'reviews', label: tx('Пікірлер', 'Отзывы'), icon: <MessageSquareText className="w-4 h-4" />, badge: waitingReviews },
    { id: 'reports', label: tx('Шағымдар', 'Жалобы'), icon: <Flag className="w-4 h-4" /> },
    { id: 'masters', label: tx('Шеберлер', 'Мастера'), icon: <Users className="w-4 h-4" /> },
  ];

  const reasonLabels: Record<string, [string, string]> = {
    ok: ['мәтін дұрыс', 'текст в порядке'],
    insult: ['балағат немесе қорлау', 'мат или оскорбления'],
    contacts: ['байланыс деректері', 'контакты или личные данные'],
    advert: ['жарнама', 'реклама'],
    off_topic: ['жұмысқа қатысы жоқ', 'не о работе'],
    self_promotion: ['шебер өзін мақтағандай', 'похоже, пишет сам мастер'],
    rating_mismatch: ['жұлдыз мәтінге сай емес', 'звёзды не совпадают с текстом'],
    unclear: ['сенімді емес', 'не уверен'],
    unavailable: ['жауап бермеді', 'не ответил'],
  };

  /** Gemini's verdict on the text as a chip: "ИИ: текст в порядке" */
  const verdictChip = (v: { decision: string; reason: string }) => (
    <span
      className={`px-2 py-1 rounded-full border text-[11px] font-bold ${
        v.decision === 'approve' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
      }`}
    >
      {tx('ИИ', 'ИИ')}: {(reasonLabels[v.reason] || reasonLabels.unclear)[kz ? 0 : 1]}
    </span>
  );

  /** 25 мин / 3 ч / 2 дн. */
  const duration = (m: number) =>
    m < 60 ? `${m} ${tx('мин', 'мин')}` : m < 2880 ? `${Math.round(m / 60)} ${tx('сағ', 'ч')}` : `${Math.round(m / 1440)} ${tx('күн', 'дн.')}`;

  /** What the check knew about the two accounts and the job, in up to three short lines */
  const contextLines = (c?: ReviewContext): string[] => {
    if (!c) return [];
    const lines: string[] = [];
    const customer: string[] = [];
    if (c.customerAgeDays !== undefined) customer.push(tx(`тіркелгіге ${c.customerAgeDays} күн`, `аккаунту ${c.customerAgeDays} дн.`));
    if (c.customerJobs !== undefined) customer.push(tx(`${c.customerJobs} тапсырыс`, `заказов ${c.customerJobs}`));
    if (c.customerMasters !== undefined) customer.push(tx(`${c.customerMasters} шеберге пікір`, `отзывов мастерам ${c.customerMasters}`));
    if (customer.length) lines.push(`${tx('Клиент', 'Клиент')}: ${customer.join(', ')}`);
    const master: string[] = [];
    if (c.masterAgeDays !== undefined) master.push(tx(`тіркелгіге ${c.masterAgeDays} күн`, `аккаунту ${c.masterAgeDays} дн.`));
    if (c.masterPublished !== undefined) master.push(tx(`${c.masterPublished} пікір жарияланған`, `опубликовано ${c.masterPublished}`));
    if (c.masterRejected) master.push(tx(`${c.masterRejected} қабылданбаған`, `отклонено ${c.masterRejected}`));
    if (master.length) lines.push(`${tx('Шебер', 'Мастер')}: ${master.join(', ')}`);
    const job: string[] = [];
    if (c.minutesToChoose !== undefined) job.push(tx(`таңдау: ${duration(c.minutesToChoose)}`, `выбран через ${duration(c.minutesToChoose)}`));
    if (c.minutesToDone !== undefined) job.push(tx(`аяқталуы: ${duration(c.minutesToDone)}`, `готово через ${duration(c.minutesToDone)}`));
    if (c.offers !== undefined) job.push(tx(`${c.offers} ұсыныс`, `предложений ${c.offers}`));
    if (job.length) lines.push(`${tx('Тапсырыс', 'Заказ')}: ${job.join(', ')}`);
    return lines;
  };

  const signalLabel = (s: ReviewCheck['signals'][number]) => {
    const n = typeof s.detail === 'number' ? s.detail : null;
    switch (s.code) {
      case 'same_device':
        return tx('Клиент пен шебер бір телефоннан', 'Клиент и мастер с одного телефона');
      case 'same_network':
        return tx('Бір желіден кірген', 'Вход из одной сети');
      case 'ring_device':
        return tx('Шебердің басқа клиентімен бір телефон', 'Один телефон с другим клиентом мастера');
      case 'ring_network':
        return tx('Шебердің басқа клиентімен бір желі', 'Одна сеть с другим клиентом мастера');
      case 'instant_pick':
        return n === null
          ? tx('Бірден таңдалды', 'Выбран сразу')
          : tx(`${n} минутта таңдалды, басқа ұсыныс жоқ`, `Выбран через ${n} мин, других предложений нет`);
      case 'new_master':
        return tx('Жаңа шебер: алғашқы 3 пікірді сіз тексересіз', 'Новый мастер: первые 3 отзыва проверяете вы');
      case 'review_burst':
        return n === null
          ? tx('Қысқа уақытта көп пікір', 'Много отзывов за короткое время')
          : tx(`7 күнде жаңа клиенттерден ${n} пікір`, `${reviewsCountLabel(n, 'ru')} от новых клиентов за 7 дней`);
      case 'quick_job':
        return n === null ? tx('Тез аяқталған', 'Завершён очень быстро') : tx(`Таңдаудан ${n} мин кейін аяқталды`, `Завершён через ${n} мин после выбора`);
      case 'new_account':
        return n === null ? tx('Клиенттің жаңа тіркелгісі', 'Новый аккаунт клиента') : tx(`Клиенттің жаңа тіркелгісі (${n} сағ)`, `Новый аккаунт клиента (${n} ч)`);
      case 'contact_in_text':
        return tx('Мәтінде телефон не сілтеме', 'В тексте телефон или ссылка');
      default:
        return String(s.code);
    }
  };

  const reviewStatus = (r: ReviewCheck): { text: string; tone: string } => {
    if (r.status === 'held') return { text: tx('Сіздің шешіміңізді күтеді', 'Ждёт вашего решения'), tone: 'text-amber-700' };
    if (r.status === 'rejected') return { text: tx('✕ Жарияланбады', '✕ Отклонён'), tone: 'text-rose-700' };
    if (r.status === 'published') {
      return r.decidedBy === 'operator'
        ? { text: tx('✓ Жарияланды (сіз)', '✓ Опубликован (вы)'), tone: 'text-emerald-700' }
        : { text: tx('✓ ИИ жариялады', '✓ Опубликован ИИ'), tone: 'text-emerald-700' };
    }
    const stuck = Date.now() - Date.parse(r.createdAt) > CHECK_STUCK_MS;
    return stuck
      ? { text: tx('Тексеру аяқталмады: өзіңіз шешіңіз', 'Проверка не завершилась: решите сами'), tone: 'text-amber-700' }
      : { text: tx('Тексерілуде…', 'Проверяется…'), tone: 'text-slate-500' };
  };

  const decisionButton = (r: ReviewCheck, action: 'publish' | 'reject', label: string) => (
    <button
      type="button"
      onClick={() => decideReview(r, action)}
      disabled={busy === `${r.id}_${action}`}
      className={`flex-1 h-9 rounded-xl text-xs font-bold disabled:opacity-50 ${
        action === 'publish' ? 'bg-emerald-600 text-white' : 'bg-rose-50 text-rose-800 border border-rose-200'
      }`}
    >
      {label}
    </button>
  );

  const chip = (on: boolean, label: string, onClick: () => void, key: string, danger = false) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      disabled={busy === key}
      aria-pressed={on}
      className={`h-8 px-2.5 rounded-full border text-[11px] font-bold disabled:opacity-50 ${
        on ? (danger ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800') : 'border-slate-200 bg-white text-slate-600'
      }`}
    >
      {on ? '✓ ' : ''}
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] bg-slate-50 flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 h-14 bg-white border-b border-slate-200">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-sky-600" />
          {tx('Басқару панелі', 'Панель управления')}
        </h2>
        <button type="button" onClick={onClose} aria-label={tx('Жабу', 'Закрыть')} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex gap-1 p-2 bg-white border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`relative flex-1 min-w-0 h-12 px-1 rounded-xl text-[11px] font-bold flex flex-col items-center justify-center gap-0.5 ${
              tab === t.id ? 'bg-sky-600 text-white' : 'text-slate-600 bg-slate-100'
            }`}
          >
            {t.icon}
            <span className="max-w-full truncate">{t.label}</span>
            {t.badge ? (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] leading-4 text-center">
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3 max-w-md w-full mx-auto">
        {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">{error}</p>}

        {tab === 'health' &&
          (!health ? (
            <Loader2 className="w-6 h-6 animate-spin text-sky-600 mx-auto mt-8" />
          ) : (
            <>
              <p className="text-[11px] text-slate-500">{tx('Соңғы 30 күн', 'Последние 30 дней')}</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: tx('Өтінімдер', 'Заявки'), value: String(health.requests) },
                  { label: tx('Өтінімге ұсыныс (орташа)', 'Предложений на заявку'), value: health.offersPerRequest.toFixed(1), hint: tx('Мақсат: 3+', 'Цель: 3+') },
                  { label: tx('Ұсыныс түскен өтінімдер', 'Заявки с предложениями'), value: pct(health.withOffersShare) },
                  { label: tx('Шебер таңдалды', 'Выбран мастер'), value: pct(health.hiredShare) },
                  {
                    label: tx('Шеберлердің жауап уақыты', 'Время ответа мастеров'),
                    value: health.avgResponseMinutes === null ? '—' : health.avgResponseMinutes < 60 ? `${health.avgResponseMinutes} ${tx('мин', 'мин')}` : `${Math.round(health.avgResponseMinutes / 60)} ${tx('сағ', 'ч')}`,
                  },
                  { label: tx('Шеберлер (үзілісте)', 'Мастера (на паузе)'), value: `${health.masters} (${health.pausedMasters})` },
                ].map((c) => (
                  <div key={c.label} className="p-3 bg-white rounded-2xl border border-slate-200">
                    <div className="text-[11px] text-slate-500 leading-tight">{c.label}</div>
                    <div className="text-xl font-extrabold text-slate-900 mt-1">{c.value}</div>
                    {'hint' in c && c.hint && <div className="text-[10px] text-slate-400">{c.hint}</div>}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {tx(
                  'Өтінімге ұсыныс аз немесе жауап уақыты ұзақ болса, көбірек шебер шақырыңыз.',
                  'Если предложений на заявку мало или мастера отвечают долго, привлеките больше мастеров.'
                )}
              </p>
              <h3 className="text-sm font-bold text-slate-900 pt-2">{tx('Әрекеттер тарихы', 'История действий')}</h3>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {tx(
                  'Бұғаттау, белгілер, шағым мен пікір шешімдері және жеке деректерді қарау серверде жазылады; оны өзгерту не өшіру мүмкін емес.',
                  'Блокировки, значки, решения по жалобам и отзывам и просмотр личных данных записываются на сервере; изменить или удалить запись нельзя.'
                )}
              </p>
              {!adminLog ? (
                <Loader2 className="w-5 h-5 animate-spin text-sky-600 mx-auto" />
              ) : adminLog.length === 0 ? (
                <p className="text-xs text-slate-500">{tx('Әзірге жазба жоқ', 'Записей пока нет')}</p>
              ) : (
                <div className="space-y-1.5">
                  {adminLog.map((e) => (
                    <div key={e.id} className="p-2 bg-white rounded-xl border border-slate-200 text-[11px] leading-snug">
                      <div className="flex justify-between gap-2">
                        <span className="font-bold text-slate-900">{e.action}</span>
                        <span className="text-slate-400 shrink-0">{e.at.slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      <div className="text-slate-600 font-mono break-all">{e.target}</div>
                      {e.changed && e.changed.length > 0 && (
                        <div className="text-slate-500 break-words">
                          {e.changed.map((k) => `${k}: ${JSON.stringify(e.before?.[k] ?? '—')} → ${JSON.stringify(e.after?.[k] ?? '—')}`).join('; ')}
                        </div>
                      )}
                      {e.reason && <div className="text-slate-500">{e.reason}</div>}
                      <div className="text-slate-400 font-mono break-all">{e.actorUid || e.actorType || ''}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ))}

        {tab === 'reviews' &&
          (!reviewChecks ? (
            <Loader2 className="w-6 h-6 animate-spin text-sky-600 mx-auto mt-8" />
          ) : (
            <>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {tx(
                  'Әр пікірді ИИ мен жалған пікір белгілерін іздейтін жүйе тексереді. Күдікті пікір сіз шешкенше жарияланбайды: клиентке қоңырау шалып тексеруге болады. Әр шебердің алғашқы 3 пікірін сіз тексересіз. Шебер бағасында әр клиент бір рет есептеледі.',
                  'Каждый отзыв проверяют ИИ и система, которая ищет признаки накрутки. Подозрительный отзыв не публикуется, пока вы не решите: можно проверить звонком клиенту. Первые 3 отзыва каждого мастера проверяете вы. В оценке мастера каждый клиент учитывается один раз.'
                )}
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} />
                {tx('Шешілгендерді де көрсету', 'Показывать решённые')}
              </label>
              {visibleChecks.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">{tx('Шешім күтетін пікір жоқ', 'Нет отзывов, ждущих решения')}</p>
              )}
              {visibleChecks.map((r) => {
                const status = reviewStatus(r);
                const facts = contextLines(r.context);
                return (
                  <div key={r.id} className="p-3 bg-white rounded-2xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base leading-none tracking-wider" aria-label={`${r.rating}/5`}>
                        <span className="text-amber-500">{'★'.repeat(r.rating)}</span>
                        <span className="text-slate-200">{'★'.repeat(5 - r.rating)}</span>
                      </span>
                      <span className="text-[10px] text-slate-400">{r.createdAt.slice(0, 10)}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 break-words">
                      {r.customerName || tx('Клиент', 'Клиент')} → {r.providerName || tx('Шебер', 'Мастер')}
                    </div>
                    {r.comment ? (
                      <p className="text-xs text-slate-700 bg-slate-50 rounded-xl p-2 whitespace-pre-wrap break-words">{r.comment}</p>
                    ) : (
                      <p className="text-[11px] text-slate-400">{tx('Мәтінсіз, тек жұлдыздар', 'Без текста, только звёзды')}</p>
                    )}
                    {(r.ai || r.signals.length > 0) && (
                      <div className="flex flex-wrap gap-1.5">
                        {r.ai && verdictChip(r.ai)}
                        {r.signals.map((s) => (
                          <span
                            key={s.code}
                            className={`px-2 py-1 rounded-full border text-[11px] font-bold ${
                              s.code === 'same_device' || s.code === 'ring_device' || s.code === 'contact_in_text'
                                ? 'border-rose-200 bg-rose-50 text-rose-800'
                                : s.code === 'new_master'
                                ? 'border-sky-200 bg-sky-50 text-sky-800'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                            }`}
                          >
                            {signalLabel(s)}
                          </span>
                        ))}
                      </div>
                    )}
                    {facts.length > 0 && (
                      <div className="text-[11px] text-slate-500 leading-relaxed">
                        {facts.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    )}
                    <p className={`text-[11px] font-bold ${status.tone}`}>{status.text}</p>
                    {reviewNeedsDecision(r) &&
                      (phones[r.id] ? (
                        <a
                          href={toTelHref(phones[r.id]) || undefined}
                          className="w-full h-9 rounded-xl border border-sky-200 bg-sky-50 text-sky-800 text-xs font-bold flex items-center justify-center gap-2"
                        >
                          <Phone className="w-4 h-4" />
                          {tx('Қоңырау шалу', 'Позвонить')}: {phones[r.id]}
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => showPhone(r)}
                          disabled={busy === `${r.id}_phone`}
                          className="w-full h-9 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          <Phone className="w-4 h-4" />
                          {tx('Клиентке қоңырау шалып тексеру', 'Проверить звонком клиенту')}
                        </button>
                      ))}
                    {reviewNeedsDecision(r) && phones[r.id] && (
                      <p className="text-[10px] text-slate-500">
                        {tx('Сұраңыз: не істелді, қашан, қанша төледіңіз?', 'Спросите: что сделали, когда, сколько заплатили?')}
                      </p>
                    )}
                    <div className="flex gap-2">
                      {reviewNeedsDecision(r) && (
                        <>
                          {decisionButton(r, 'publish', tx('Жариялау', 'Опубликовать'))}
                          {decisionButton(r, 'reject', tx('Жарияламау', 'Отклонить'))}
                        </>
                      )}
                      {flaggedByCheck(r) && decisionButton(r, 'publish', tx('Қалдыру', 'Оставить'))}
                      {r.status === 'published' && decisionButton(r, 'reject', tx('Алып тастау', 'Снять'))}
                      {r.status === 'rejected' && decisionButton(r, 'publish', tx('Жариялау', 'Опубликовать'))}
                    </div>
                  </div>
                );
              })}
            </>
          ))}

        {tab === 'reports' &&
          (!reports ? (
            <Loader2 className="w-6 h-6 animate-spin text-sky-600 mx-auto mt-8" />
          ) : (
            <>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
                {tx('Қаралғандарды да көрсету', 'Показывать рассмотренные')}
              </label>
              {visibleReports.length === 0 && <p className="text-sm text-slate-500 text-center py-6">{tx('Жаңа шағым жоқ', 'Новых жалоб нет')}</p>}
              {visibleReports.map((r) => {
                const reason = REPORT_REASONS.find((x) => x.id === r.reason);
                const isChat = r.targetType === 'conversation';
                const ev = evidence[r.id];
                const canBlock = !isChat || Boolean(ev?.reported.uid);
                return (
                  <div key={r.id} className="p-3 bg-white rounded-2xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">{reason ? (kz ? reason.kz : reason.ru) : r.reason}</span>
                      <span className="text-[10px] text-slate-400">{(r.createdAt || '').slice(0, 10)}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {{ provider: tx('Шебер', 'Мастер'), offer: tx('Ұсыныс', 'Предложение'), request: tx('Өтінім', 'Заявка'), conversation: tx('Чат', 'Чат') }[r.targetType]}
                      {' · '}
                      <span className="font-mono">{r.targetId.slice(0, 24)}</span>
                    </div>
                    {r.details && <p className="text-xs text-slate-700 bg-slate-50 rounded-xl p-2">{r.details}</p>}
                    {isChat && !ev && (
                      <button
                        type="button"
                        onClick={() => showEvidence(r)}
                        disabled={busy === `${r.id}_evidence`}
                        className="w-full h-9 rounded-xl border border-slate-200 text-slate-800 text-xs font-bold disabled:opacity-50"
                      >
                        {tx('Хат алмасуды көру (тіркеледі)', 'Посмотреть переписку (записывается)')}
                      </button>
                    )}
                    {ev && (
                      <div className="max-h-64 overflow-y-auto space-y-1.5 bg-slate-50 rounded-xl p-2">
                        {ev.messages.length === 0 && <p className="text-[11px] text-slate-500">{tx('Хабарлама жоқ', 'Сообщений нет')}</p>}
                        {ev.messages.map((m, i) => (
                          <div key={i} className="text-[11px] leading-snug">
                            <span className={`font-bold ${m.senderRole === 'provider' ? 'text-sky-700' : 'text-amber-700'}`}>
                              {m.senderRole === 'provider' ? tx('Шебер', 'Мастер') : tx('Клиент', 'Клиент')}
                            </span>
                            <span className="text-slate-400"> · {(m.createdAt || '').slice(5, 16).replace('T', ' ')}</span>
                            <div className="text-slate-800 whitespace-pre-wrap break-words">{m.text}</div>
                            {m.files.length > 0 && <div className="text-slate-500">📎 {m.files.join(', ')}</div>}
                          </div>
                        ))}
                        <p className="text-[10px] text-slate-500 pt-1">
                          {ev.reported.isMaster ? tx('Шағым шебер туралы', 'Жалоба на мастера') : tx('Шағым клиент туралы', 'Жалоба на клиента')}
                        </p>
                      </div>
                    )}
                    {r.status === 'resolved' ? (
                      <p className="text-[11px] font-bold text-emerald-700">✓ {r.resolution || tx('Қаралды', 'Рассмотрено')}</p>
                    ) : (
                      <div className="flex gap-2">
                        {canBlock && (
                          <button
                            type="button"
                            onClick={() => reportAction(r, 'block')}
                            disabled={busy === `${r.id}_block`}
                            className="flex-1 h-9 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-50"
                          >
                            {tx('Бұғаттау', 'Заблокировать')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => reportAction(r, 'resolve')}
                          disabled={busy === `${r.id}_resolve`}
                          className="flex-1 h-9 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold disabled:opacity-50"
                        >
                          {tx('Қаралды', 'Рассмотрено')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ))}

        {tab === 'masters' &&
          (!masters ? (
            <Loader2 className="w-6 h-6 animate-spin text-sky-600 mx-auto mt-8" />
          ) : (
            <>
              <div className="flex items-center gap-2 h-11 px-3 bg-white border border-slate-200 rounded-xl">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tx('Аты немесе телефоны', 'Имя или телефон')}
                  className="flex-1 bg-transparent text-sm outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {tx('Белгіні тек тексергеннен кейін қойыңыз.', 'Ставьте значок только после проверки.')}
              </p>
              {visibleMasters.map((m) => (
                <div key={m.id} className="p-3 bg-white rounded-2xl border border-slate-200 space-y-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{m.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {m.category} · {m.phone || '—'}
                      {m.paused ? ` · ${tx('үзілісте', 'на паузе')}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {chip(Boolean(m.iinVerified), tx('Жеке басы тексерілген', 'Личность проверена'), () => toggleFlag(m, 'iinVerified'), `${m.id}_iinVerified`)}
                    {chip(Boolean(m.verified), tx('Тексерілген маман', 'Проверенный специалист'), () => toggleFlag(m, 'verified'), `${m.id}_verified`)}
                    {chip(Boolean(m.hasCertificate), tx('Сертификат', 'Сертификат'), () => toggleFlag(m, 'hasCertificate'), `${m.id}_hasCertificate`)}
                    {chip(Boolean(m.hidden), tx('Жасырылған', 'Скрыт'), () => toggleFlag(m, 'hidden'), `${m.id}_hidden`, true)}
                    {chip(Boolean(m.blocked || blocked[m.id]), tx('Бұғатталған', 'Заблокирован'), () => toggleBlockMaster(m), `${m.id}_block`, true)}
                  </div>
                </div>
              ))}
            </>
          ))}
      </div>
    </div>
  );
};
