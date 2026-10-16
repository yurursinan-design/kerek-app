import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Flag, Loader2, Search, ShieldCheck, Users, X } from 'lucide-react';
import { Language, Provider } from '../types';
import { getFriendlyErrorMessage } from '../services';
import { REPORT_REASONS } from '../services/reports';
import {
  AdminReport,
  blockAccount,
  HealthNumbers,
  isAccountBlocked,
  loadHealthNumbers,
  loadMasters,
  loadReports,
  MasterFlag,
  reportedAccount,
  resolveReport,
  setMasterFlag,
  unblockAccount,
} from '../services/admin';

type Tab = 'health' | 'reports' | 'masters';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The operator's panel: health numbers, reports and masters (badges, hiding, blocking). */
export const AdminScreen: React.FC<{ language: Language; onClose: () => void }> = ({ language, onClose }) => {
  const kz = language === 'kz';
  const tx = (k: string, r: string) => (kz ? k : r);
  const [tab, setTab] = useState<Tab>('health');
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<HealthNumbers | null>(null);
  const [reports, setReports] = useState<AdminReport[] | null>(null);
  const [masters, setMasters] = useState<Provider[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setError(null);
    const fail = (err: unknown) => setError(getFriendlyErrorMessage(err, language));
    if (tab === 'health' && !health) loadHealthNumbers().then(setHealth).catch(fail);
    if (tab === 'reports' && !reports) loadReports().then(setReports).catch(fail);
    if (tab === 'masters' && !masters) loadMasters().then(setMasters).catch(fail);
  }, [tab, health, reports, masters, language]);

  const visibleReports = useMemo(
    () => (reports || []).filter((r) => showResolved || r.status !== 'resolved'),
    [reports, showResolved]
  );
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
        const who = await reportedAccount(r);
        if (!who) throw new Error('Validation Error: ' + tx('Тіркелгі табылмады', 'Аккаунт не найден'));
        await blockAccount(who.uid, r.reason, who.isMaster);
        setBlocked((b) => ({ ...b, [who.uid]: true }));
        await resolveReport(r.id, tx('Бұғатталды', 'Заблокирован'));
      } else {
        await resolveReport(r.id, tx('Қаралды', 'Рассмотрено'));
      }
      setReports((list) => (list || []).map((x) => (x.id === r.id ? { ...x, status: 'resolved' } : x)));
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

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'health', label: tx('Көрсеткіштер', 'Показатели'), icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'reports', label: tx('Шағымдар', 'Жалобы'), icon: <Flag className="w-4 h-4" /> },
    { id: 'masters', label: tx('Шеберлер', 'Мастера'), icon: <Users className="w-4 h-4" /> },
  ];

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
            className={`flex-1 h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 ${
              tab === t.id ? 'bg-sky-600 text-white' : 'text-slate-600 bg-slate-100'
            }`}
          >
            {t.icon}
            {t.label}
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
                const canBlock = r.targetType !== 'conversation';
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
