import React, { useState, useEffect } from 'react';
import {
  Appointment,
  AppointmentStatus,
  getNextWorkStatus,
  Language,
  ProviderOffer,
  ServiceRequest,
  WorkStatus,
} from '../types';
import { translations } from '../i18n/translations';
import { repository, getCurrentUserId, getFriendlyErrorMessage } from '../services';
import { auth } from '../services/firebase';
import {
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  X,
  Send,
  CalendarCheck,
  CalendarX,
  Car,
  MapPin,
  Wrench,
  CheckCircle2,
} from 'lucide-react';

interface AppointmentSectionProps {
  request: ServiceRequest;
  selectedOffer?: ProviderOffer;
  currentRole: 'customer' | 'provider';
  language: Language;
  currentUserId?: string;
  onAppointmentChanged?: (appointment: Appointment | null) => void;
}

export const AppointmentSection: React.FC<AppointmentSectionProps> = ({
  request,
  selectedOffer,
  currentRole,
  language,
  currentUserId,
  onAppointmentChanged,
}) => {
  const t = translations[language];
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form fields
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('14:00');
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [noteStr, setNoteStr] = useState('');

  // Cancel dialog
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const effectiveUserId = currentUserId || auth?.currentUser?.uid || getCurrentUserId();

  // Default date: today on the phone's own calendar (toISOString would give the UTC date, which
  // is yesterday in Kazakhstan between midnight and 05:00)
  const localToday = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  useEffect(() => {
    setDateStr(localToday);
  }, []);

  // Subscribe to appointment changes
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const unsubscribe = repository.subscribeToAppointment(
      request.id,
      (appt) => {
        if (!isMounted) return;
        setAppointment(appt);
        setLoading(false);
        if (onAppointmentChanged) {
          onAppointmentChanged(appt);
        }
      },
      (err) => {
        console.warn('[AppointmentSection] subscription note:', err);
        if (isMounted) setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [request.id]);

  const providerId = selectedOffer?.providerId || request.selectedOfferId || '';
  const providerUserId = selectedOffer?.providerUserId || providerId;

  // Handle Create Appointment
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dateStr || !timeStr) {
      setErrorMsg(language === 'kz' ? 'Күні мен уақытын көрсетіңіз' : 'Укажите дату и время');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const scheduledAt = `${dateStr} ${timeStr}`;
      await repository.createAppointment({
        requestId: request.id,
        customerId: request.customerId,
        providerId: providerId,
        providerUserId: providerUserId,
        proposedBy: currentRole,
        scheduledAt,
        durationMinutes: durationMinutes > 0 ? durationMinutes : 60,
        status: 'PROPOSED',
        note: noteStr.trim() || undefined,
      });

      setIsFormOpen(false);
      setNoteStr('');
    } catch (err: any) {
      console.error('[AppointmentSection] Create appointment error:', err);
      setErrorMsg(getFriendlyErrorMessage(err, language));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Confirm
  const handleConfirm = async () => {
    if (!appointment) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await repository.confirmAppointment(appointment.id, currentRole);
    } catch (err: any) {
      console.error('[AppointmentSection] Confirm error:', err);
      setErrorMsg(getFriendlyErrorMessage(err, language));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Reschedule
  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointment || !dateStr || !timeStr) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const scheduledAt = `${dateStr} ${timeStr}`;
      await repository.rescheduleAppointment(
        appointment.id,
        scheduledAt,
        currentRole,
        noteStr.trim() || undefined
      );
      setIsRescheduleOpen(false);
      setNoteStr('');
    } catch (err: any) {
      console.error('[AppointmentSection] Reschedule error:', err);
      setErrorMsg(getFriendlyErrorMessage(err, language));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Cancel
  const handleCancel = async () => {
    if (!appointment) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await repository.cancelAppointment(
        appointment.id,
        currentRole,
        cancelReason.trim() || undefined
      );
      setIsCancelDialogOpen(false);
      setCancelReason('');
    } catch (err: any) {
      console.error('[AppointmentSection] Cancel error:', err);
      setErrorMsg(getFriendlyErrorMessage(err, language));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Complete
  const handleComplete = async () => {
    if (!appointment) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await repository.completeAppointment(appointment.id);
    } catch (err: any) {
      console.error('[AppointmentSection] Complete error:', err);
      setErrorMsg(getFriendlyErrorMessage(err, language));
    } finally {
      setSubmitting(false);
    }
  };

  // Customer confirms job completion atomically
  const handleConfirmCompletion = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (repository.confirmCustomerCompletion) {
        await repository.confirmCustomerCompletion(request.id, appointment?.id);
      } else if (appointment) {
        await repository.completeAppointment(appointment.id);
      } else {
        await repository.updateRequest(request.id, {
          status: 'COMPLETED',
        });
      }
    } catch (err: any) {
      console.error('[AppointmentSection] Confirm completion error:', err);
      setErrorMsg(getFriendlyErrorMessage(err, language));
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Provider Work Status Update
  const handleUpdateWorkStatus = async (targetStatus: WorkStatus) => {
    if (!appointment) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await repository.updateWorkStatus(appointment.id, targetStatus, effectiveUserId);
    } catch (err: any) {
      console.error('[AppointmentSection] Work status error:', err);
      setErrorMsg(getFriendlyErrorMessage(err, language));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case 'PROPOSED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600" />
            <span>{t.appointmentStatus_PROPOSED}</span>
          </span>
        );
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle className="w-3 h-3 text-emerald-600" />
            <span>{t.appointmentStatus_CONFIRMED}</span>
          </span>
        );
      case 'RESCHEDULED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-200">
            <RotateCcw className="w-3 h-3 text-sky-600" />
            <span>{t.appointmentStatus_RESCHEDULED}</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
            <CalendarX className="w-3 h-3 text-rose-600" />
            <span>{t.appointmentStatus_CANCELLED}</span>
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">
            <CalendarCheck className="w-3 h-3 text-slate-600" />
            <span>{t.appointmentStatus_COMPLETED}</span>
          </span>
        );
      default:
        return null;
    }
  };

  const isProposedByMe = appointment?.proposedBy === currentRole;
  const isRequestCompleted = request.status === 'COMPLETED';
  const isAwaitingMyConfirmation =
    appointment &&
    !isRequestCompleted &&
    !isProposedByMe &&
    (appointment.status === 'PROPOSED' || appointment.status === 'RESCHEDULED');

  const isAssignedProvider =
    currentRole === 'provider' &&
    appointment &&
    (effectiveUserId === appointment.providerUserId ||
      effectiveUserId === appointment.providerId ||
      effectiveUserId === providerUserId);

  const currentWorkStatus: WorkStatus = appointment?.workStatus || 'NOT_STARTED';
  const nextWorkStatus = getNextWorkStatus(currentWorkStatus);

  const getStageIndex = (status: WorkStatus): number => {
    switch (status) {
      case 'PROVIDER_ON_THE_WAY':
        return 1;
      case 'PROVIDER_ARRIVED':
        return 2;
      case 'WORK_STARTED':
        return 3;
      case 'WORK_COMPLETED':
        return 4;
      default:
        return 0; // NOT_STARTED
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-2xs space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 leading-tight">
              {t.appointmentTitle}
            </h4>
            <p className="text-[10px] text-slate-500">
              {language === 'kz'
                ? 'Тараптардың келісілген уақыты'
                : 'Согласованное время встречи'}
            </p>
          </div>
        </div>

        {appointment && getStatusBadge(appointment.status)}
      </div>

      {/* Order Status Badges */}
      {request.status === 'COMPLETED' && (
        <div className="p-2.5 bg-teal-50 border border-teal-300 rounded-xl flex items-center gap-2 text-xs font-bold text-teal-900">
          <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
          <span>
            {language === 'kz'
              ? 'Жұмыс сәтті аяқталды'
              : 'Работа успешно завершена'}
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="py-4 text-center text-xs text-slate-400">
          <span className="inline-block w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !appointment || appointment.status === 'CANCELLED' ? (
        /* No appointment or previous was cancelled */
        <div className="space-y-3">
          {appointment?.status === 'CANCELLED' && (
            <div className="p-2.5 bg-rose-50/60 rounded-xl text-xs text-rose-700 border border-rose-100 flex items-center justify-between">
              <span>{t.appointmentCancelledNotice}</span>
              {appointment.note && <span className="text-[11px] italic">({appointment.note})</span>}
            </div>
          )}

          {!isRequestCompleted && (
            !isFormOpen ? (
              <button
                type="button"
                onClick={() => setIsFormOpen(true)}
                className="w-full min-h-[40px] px-3 rounded-xl bg-sky-50 hover:bg-sky-100 active:scale-[0.99] text-sky-800 font-bold text-xs flex items-center justify-center gap-2 transition-all border border-sky-200 cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>{t.appointmentCreateBtn}</span>
              </button>
            ) : (
              /* Creation Form */
              <form onSubmit={handleCreate} className="space-y-3 pt-2 border-t border-slate-100">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      {t.appointmentDateLabel}
                    </label>
                    <input
                      type="date"
                      required
                      min={localToday}
                      value={dateStr}
                      onChange={(e) => setDateStr(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      {t.appointmentTimeLabel}
                    </label>
                    <input
                      type="time"
                      required
                      value={timeStr}
                      onChange={(e) => setTimeStr(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      {t.appointmentDurationLabel}
                    </label>
                    <select
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
                    >
                      <option value={30}>30 мин</option>
                      <option value={60}>1 час (60 мин)</option>
                      <option value={90}>1.5 часа (90 мин)</option>
                      <option value={120}>2 часа (120 мин)</option>
                      <option value={180}>3 часа (180 мин)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      {t.appointmentNoteLabel}
                    </label>
                    <input
                      type="text"
                      maxLength={1000}
                      placeholder={t.appointmentNotePlaceholder}
                      value={noteStr}
                      onChange={(e) => setNoteStr(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 min-h-[38px] rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{submitting ? '...' : t.appointmentSubmitBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="min-h-[38px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs"
                  >
                    {language === 'kz'
                      ? 'Жабу'
                      : 'Отмена'}
                  </button>
                </div>
              </form>
            )
          )}
        </div>
      ) : (
        /* Active Appointment Display */
        <div className="space-y-3">
          <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200/70">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">{t.appointmentDateLabel}:</span>
              <span className="font-bold text-slate-900 font-mono flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-sky-600" />
                {appointment.scheduledAt}
              </span>
            </div>

            {appointment.durationMinutes && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{t.appointmentDurationLabel}:</span>
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {appointment.durationMinutes} мин
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/50">
              <span className="text-slate-500">
                {language === 'kz'
                  ? 'Ұсынған'
                  : 'Предложено'}:
              </span>
              <span className="font-medium text-slate-700">
                {appointment.proposedBy === 'customer'
                  ? t.appointmentProposedByCustomer
                  : t.appointmentProposedByProvider}
              </span>
            </div>

            {appointment.note && (
              <div className="pt-1 border-t border-slate-200/50 text-xs">
                <span className="text-slate-400 text-[10px] block">{t.appointmentNoteLabel}:</span>
                <p className="text-slate-700 italic">«{appointment.note}»</p>
              </div>
            )}
          </div>

          {/* Status notices */}
          {appointment.status === 'CONFIRMED' && (
            <div className="p-2.5 bg-emerald-50 rounded-xl text-xs text-emerald-800 font-medium flex items-center gap-1.5 border border-emerald-200">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t.appointmentConfirmedNotice}</span>
            </div>
          )}

          {/* Work Status (Hizmet Durumu) Tracker & Controls */}
          {(appointment.status === 'CONFIRMED' || appointment.status === 'COMPLETED') && (
            <div className="p-3 bg-slate-50/90 rounded-xl border border-slate-200/90 space-y-2.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5 text-sky-600" />
                  {t.workStatusTitle}
                </span>

                {appointment.workStatusUpdatedAt && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(appointment.workStatusUpdatedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>

              {/* Progress Milestones (5 steps: Confirmed -> On the way -> Arrived -> Started -> Completed) */}
              {appointment.workStatus === 'CANCELLED' ? (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{t.workStatus_CANCELLED}</span>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-1 pt-1 pb-1">
                  {[
                    { key: 'CONFIRMED', icon: Clock, label: t.workStatusStepConfirmed, step: 0 },
                    { key: 'PROVIDER_ON_THE_WAY', icon: Car, label: t.workStatusStepOnTheWay, step: 1 },
                    { key: 'PROVIDER_ARRIVED', icon: MapPin, label: t.workStatusStepArrived, step: 2 },
                    { key: 'WORK_STARTED', icon: Wrench, label: t.workStatusStepStarted, step: 3 },
                    { key: 'WORK_COMPLETED', icon: CheckCircle2, label: t.workStatusStepCompleted, step: 4 },
                  ].map((m) => {
                    const stageIdx = getStageIndex(appointment.workStatus || 'NOT_STARTED');
                    const isDone = stageIdx >= m.step;
                    const isCurrent = stageIdx === m.step;
                    const Icon = m.icon;

                    return (
                      <div key={m.key} className="flex flex-col items-center text-center">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                            isDone
                              ? isCurrent
                                ? 'bg-sky-600 text-white ring-2 ring-sky-300 ring-offset-1 shadow-xs scale-105'
                                : 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-400'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span
                          className={`text-[9px] mt-1 leading-tight line-clamp-2 ${
                            isCurrent
                              ? 'font-bold text-sky-900'
                              : isDone
                              ? 'font-semibold text-emerald-800'
                              : 'text-slate-400 font-normal'
                          }`}
                        >
                          {m.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Provider Action Buttons: Only assigned provider can execute valid next transition */}
              {isAssignedProvider &&
                !isRequestCompleted &&
                appointment.workStatus !== 'CANCELLED' &&
                appointment.workStatus !== 'WORK_COMPLETED' && (
                  <div className="pt-2 border-t border-slate-200/70 flex flex-wrap gap-2">
                    {nextWorkStatus && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleUpdateWorkStatus(nextWorkStatus)}
                        className="flex-1 min-h-[38px] px-3 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {nextWorkStatus === 'PROVIDER_ON_THE_WAY' && <Car className="w-3.5 h-3.5" />}
                        {nextWorkStatus === 'PROVIDER_ARRIVED' && <MapPin className="w-3.5 h-3.5" />}
                        {nextWorkStatus === 'WORK_STARTED' && <Wrench className="w-3.5 h-3.5" />}
                        {nextWorkStatus === 'WORK_COMPLETED' && <CheckCircle className="w-3.5 h-3.5" />}
                        <span>
                          {nextWorkStatus === 'PROVIDER_ON_THE_WAY' &&
                            t.workStatusNextAction_PROVIDER_ON_THE_WAY}
                          {nextWorkStatus === 'PROVIDER_ARRIVED' &&
                            t.workStatusNextAction_PROVIDER_ARRIVED}
                          {nextWorkStatus === 'WORK_STARTED' &&
                            t.workStatusNextAction_WORK_STARTED}
                          {nextWorkStatus === 'WORK_COMPLETED' &&
                            t.workStatusNextAction_WORK_COMPLETED}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleUpdateWorkStatus('CANCELLED')}
                      className="min-h-[38px] px-2.5 rounded-xl bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-600 font-medium text-xs border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer"
                    >
                      <span>{t.workStatusNextAction_CANCELLED}</span>
                    </button>
                  </div>
                )}
            </div>
          )}

          {/* If request completed while appointment remained in PROPOSED or RESCHEDULED state */}
          {isRequestCompleted &&
            (appointment.status === 'PROPOSED' || appointment.status === 'RESCHEDULED') && (
              <div className="p-3 bg-slate-100 rounded-xl text-xs text-slate-700 font-medium flex items-start gap-2 border border-slate-200">
                <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-slate-800">
                    {language === 'kz'
                      ? 'Кездесу күту күйінде қалды'
                      : 'Встреча осталась в ожидании'}
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                    {language === 'kz'
                      ? 'Тапсырыс аяқталғандықтан, бұл кездесу ұсынысы бекітілмей күту күйінде қалды және оған әрекет жасау талап етілмейді.'
                      : 'Так как заказ уже завершен, это предложение о встрече осталось без подтверждения и более не требует действий.'}
                  </p>
                </div>
              </div>
            )}

          {!isRequestCompleted &&
            (appointment.status === 'PROPOSED' || appointment.status === 'RESCHEDULED') &&
            isProposedByMe && (
              <div className="p-2.5 bg-amber-50 rounded-xl text-xs text-amber-800 font-medium flex items-center gap-1.5 border border-amber-200">
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{t.appointmentAwaitingConfirmation}</span>
              </div>
            )}

          {/* Reschedule inline form */}
          {isRescheduleOpen && !isRequestCompleted && (
            <form onSubmit={handleReschedule} className="p-3 bg-sky-50 rounded-xl border border-sky-200 space-y-2.5 animate-fadeIn">
              <h5 className="text-xs font-bold text-sky-950 flex items-center gap-1">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t.appointmentRescheduleBtn}</span>
              </h5>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-sky-900 uppercase mb-1">
                    {t.appointmentDateLabel}
                  </label>
                  <input
                    type="date"
                    required
                    min={localToday}
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-sky-200 text-xs bg-white text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-sky-900 uppercase mb-1">
                    {t.appointmentTimeLabel}
                  </label>
                  <input
                    type="time"
                    required
                    value={timeStr}
                    onChange={(e) => setTimeStr(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-sky-200 text-xs bg-white text-slate-800"
                  />
                </div>
              </div>

              <div>
                <input
                  type="text"
                  maxLength={1000}
                  placeholder={t.appointmentNotePlaceholder}
                  value={noteStr}
                  onChange={(e) => setNoteStr(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-sky-200 text-xs bg-white text-slate-800"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 min-h-[34px] rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs"
                >
                  {submitting ? '...' : t.appointmentSubmitBtn}
                </button>
                <button
                  type="button"
                  onClick={() => setIsRescheduleOpen(false)}
                  className="min-h-[34px] px-3 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs"
                >
                  {language === 'kz'
                    ? 'Жабу'
                    : 'Отмена'}
                </button>
              </div>
            </form>
          )}

          {/* Action buttons */}
          {!isRescheduleOpen && !isRequestCompleted && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
              {/* If awaiting MY confirmation */}
              {isAwaitingMyConfirmation && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleConfirm}
                  className="flex-1 min-h-[38px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>{t.appointmentConfirmBtn}</span>
                </button>
              )}

              {/* Reschedule Button */}
              {(appointment.status === 'PROPOSED' ||
                appointment.status === 'CONFIRMED' ||
                appointment.status === 'RESCHEDULED') && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setIsRescheduleOpen(true)}
                  className="min-h-[38px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                  <span>{t.appointmentRescheduleBtn}</span>
                </button>
              )}

              {/* Customer confirms work completion */}
              {currentRole === 'customer' &&
                (request.status === 'PROVIDER_SELECTED' ||
                  request.status === 'ACCEPTED' ||
                  request.status === 'IN_PROGRESS') && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleConfirmCompletion}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-100" />
                  <span>
                    {language === 'kz'
                      ? 'Жұмыстың аяқталғанын растау'
                      : 'Подтвердить завершение работы'}
                  </span>
                </button>
              )}

              {/* Complete appointment button for provider */}
              {currentRole === 'provider' && appointment.status === 'CONFIRMED' && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleComplete}
                  className="min-h-[38px] px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center gap-1.5 border border-emerald-200 cursor-pointer"
                >
                  <CalendarCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{t.appointmentCompleteBtn}</span>
                </button>
              )}

              {/* Cancel Button */}
              {(appointment.status === 'PROPOSED' ||
                appointment.status === 'CONFIRMED' ||
                appointment.status === 'RESCHEDULED') && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setIsCancelDialogOpen(true)}
                  className="min-h-[38px] px-3 rounded-xl bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-600 font-medium text-xs border border-slate-200 hover:border-rose-200 transition-colors cursor-pointer"
                >
                  <span>{t.appointmentCancelBtn}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Cancel reason dialog */}
      {isCancelDialogOpen && !isRequestCompleted && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white rounded-2xl p-4 max-w-sm w-full shadow-2xl space-y-3 border border-slate-200">
            <div className="flex items-start justify-between">
              <h4 className="text-sm font-bold text-slate-900">
                {t.appointmentCancelBtn}
              </h4>
              <button
                type="button"
                onClick={() => setIsCancelDialogOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              {language === 'kz'
                ? 'Кездесуді шынымен тоқтатқыңыз келе ме?'
                : 'Вы действительно хотите отменить назначенную встречу?'}
            </p>

            <div>
              <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                {language === 'kz'
                  ? 'Себебі (қалауыңыз бойынша)'
                  : 'Причина (необязательно)'}
              </label>
              <input
                type="text"
                placeholder={
                  language === 'kz'
                    ? 'Мысалы: Басқа уақыт ыңғайлырақ'
                    : 'Например: Изменились планы'
                }
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={submitting}
                onClick={handleCancel}
                className="flex-1 min-h-[38px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
              >
                {submitting ? '...' : t.appointmentCancelBtn}
              </button>
              <button
                type="button"
                onClick={() => setIsCancelDialogOpen(false)}
                className="min-h-[38px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs"
              >
                {language === 'kz'
                  ? 'Жоқ'
                  : 'Назад'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
