import { doc, Firestore, runTransaction } from 'firebase/firestore';

/**
 * A provider sends an offer the way the app does: the offer and the request's offer count are
 * written together (the security rules require both).
 */
export async function sendOfferCounted(db: Firestore, offerId: string, offer: Record<string, unknown>): Promise<void> {
  const requestRef = doc(db, 'requests', String(offer.requestId));
  await runTransaction(db, async (tx) => {
    const req = await tx.get(requestRef);
    const count = (req.exists() && typeof req.data().offerCount === 'number' ? req.data().offerCount : 0) as number;
    tx.set(doc(db, 'offers', offerId), offer);
    tx.update(requestRef, { status: 'OFFERS_RECEIVED', lastOfferId: offerId, offerCount: count + 1, updatedAt: new Date().toISOString() });
  });
}
