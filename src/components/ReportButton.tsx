import React, { useState } from 'react';
import { Flag, Loader2, X } from 'lucide-react';
import { Language } from '../types';
import { REPORT_REASONS as REASONS, ReportReason, ReportTargetType, submitReport } from '../services/reports';

interface ReportButtonProps {
  language: Language;
  targetType: ReportTargetType;
  targetId: string;
  requestId?: string;
  className?: string;
}

/** Small "Report" link that opens a sheet with reasons; the report goes to the operator. */
export const ReportButton: React.FC<ReportButtonProps> = ({ language, targetType, targetId, requestId, className }) => {
  const kz = language === 'kz';
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  const close = () => {
    setOpen(false);
    setReason(null);
    setDetails('');
    setState('idle');
  };

  const send = async () => {
    if (!reason || state === 'sending') return;
    setState('sending');
    try {
      await submitReport({ targetType, targetId, requestId, reason, details });
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={className || 'inline-flex items-center gap-1.5 min-h-[40px] px-2 text-xs font-semibold text-slate-500 hover:text-rose-600'}
      >
        <Flag className="w-3.5 h-3.5" />
        {kz ? 'Шағымдану' : 'Пожаловаться'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-title"
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 id="report-title" className="text-base font-bold text-slate-900 font-display">
                {kz ? 'Шағым жіберу' : 'Отправить жалобу'}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label={kz ? 'Жабу' : 'Закрыть'}
                className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {state === 'done' ? (
              <>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {kz
                    ? 'Рақмет! Шағымыңыз Tapsyr командасына жіберілді. Біз оны қарап, қажет болса профильді бұғаттаймыз.'
                    : 'Спасибо! Жалоба отправлена команде Tapsyr. Мы её рассмотрим и при необходимости заблокируем профиль.'}
                </p>
                <button type="button" onClick={close} className="press w-full min-h-[48px] rounded-2xl bg-slate-900 text-white text-sm font-bold">
                  {kz ? 'Жақсы' : 'Хорошо'}
                </button>
              </>
            ) : (
              <>
                <div className="grid gap-2">
                  {REASONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setReason(r.id)}
                      aria-pressed={reason === r.id}
                      className={`press min-h-[48px] rounded-2xl border-2 px-3 text-left text-sm font-semibold ${
                        reason === r.id ? 'border-rose-400 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {kz ? r.kz : r.ru}
                    </button>
                  ))}
                </div>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder={kz ? 'Не болды? (міндетті емес)' : 'Что случилось? (необязательно)'}
                  className="w-full rounded-2xl border-2 border-slate-200 p-3 text-sm focus:border-sky-400 outline-none"
                />
                {state === 'error' && (
                  <p className="text-xs text-rose-600">
                    {kz ? 'Жіберу мүмкін болмады. Интернетті тексеріп, қайталаңыз.' : 'Не удалось отправить. Проверьте интернет и попробуйте снова.'}
                  </p>
                )}
                <button
                  type="button"
                  onClick={send}
                  disabled={!reason || state === 'sending'}
                  className="press w-full min-h-[48px] rounded-2xl bg-rose-600 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {state === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {kz ? 'Жіберу' : 'Отправить'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
