import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase';

export type ReportTargetType = 'provider' | 'offer' | 'request' | 'conversation';
export type ReportReason = 'fraud' | 'spam' | 'rude' | 'fake' | 'no_show' | 'other';

export interface ReportInput {
  targetType: ReportTargetType;
  targetId: string;
  requestId?: string;
  reason: ReportReason;
  details?: string;
}

/**
 * Files a report for the operator (reports collection, read only by accounts with the admin
 * claim). One report per account and target: the id is fixed, so a second tap just returns.
 */
export async function submitReport(input: ReportInput): Promise<'sent' | 'already'> {
  const user = auth?.currentUser;
  if (!isFirebaseConfigured() || !db || !user) throw new Error('reports need the cloud');
  const id = `REPORT-${user.uid}-${input.targetType}-${input.targetId}`;
  const ref = doc(db, 'reports', id);
  if ((await getDoc(ref)).exists()) return 'already';
  const details = (input.details || '').trim().slice(0, 1000);
  await setDoc(ref, {
    id,
    reporterId: user.uid,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    reason: input.reason,
    ...(details ? { details } : {}),
    createdAt: new Date().toISOString(),
  });
  return 'sent';
}

/** Reasons shown in the "Report" sheet and in the operator's panel */
export const REPORT_REASONS: { id: ReportReason; kz: string; ru: string }[] = [
  { id: 'fraud', kz: 'Алаяқтық, ақша сұрады', ru: 'Мошенничество, просят деньги' },
  { id: 'fake', kz: 'Жалған профиль немесе ұсыныс', ru: 'Фейковый профиль или предложение' },
  { id: 'rude', kz: 'Дөрекі сөйлеу, қорлау', ru: 'Грубость, оскорбления' },
  { id: 'no_show', kz: 'Келмеді, жұмысты істемеді', ru: 'Не пришёл, не сделал работу' },
  { id: 'spam', kz: 'Спам, жарнама', ru: 'Спам, реклама' },
  { id: 'other', kz: 'Басқа', ru: 'Другое' },
];
