/**
 * The WhatsApp assistant demo (working name Jauap): a business owner sees how the assistant answers
 * their customers. Everything lives in one demoSessions/{id} document per visitor; no real
 * customer data is involved (the visitor plays the customer).
 */

export type Lang = 'ru' | 'kz';

export interface Staff {
  id: string;
  name: string;
  role_ru: string;
  role_kz: string;
}

/** Something booked by time (a haircut, a tyre change) */
export interface Service {
  id: string;
  ru: string;
  kz: string;
  /** Tenge; with priceFrom, the lowest price */
  price: number;
  priceFrom?: boolean;
  minutes: number;
  /** Staff ids who do it */
  staff: string[];
  note?: string;
}

/** Something ordered (a cake) */
export interface Product {
  id: string;
  ru: string;
  kz: string;
  price: number;
  priceFrom?: boolean;
  /** 'кг', 'шт', 'набор'… (Russian) */
  unit: string;
  /** Ready today (in the showcase); otherwise it is made in leadDays */
  available: boolean;
  leadDays: number;
  note?: string;
}

export interface Business {
  name: string;
  kind: 'booking' | 'order';
  type_ru: string;
  type_kz: string;
  address: string;
  /**
   * Opening hours, Monday first: "09:00-20:00", or null when closed. (Strings, because Firestore
   * can't store a list of lists.)
   */
  hours: (string | null)[];
  staff: Staff[];
  services: Service[];
  products: Product[];
  /** Short facts in Russian (payment, parking, delivery…) */
  facts: string[];
  delivery: { price: number; freeFrom: number } | null;
  /** Which demo it came from, for the page's pictures */
  template: string;
}

export interface Booking {
  id: string;
  serviceId: string;
  staffId: string;
  date: string;
  start: string;
  minutes: number;
  customer: string;
  /** seed = invented to make the calendar look real; bot = made by the assistant in this demo */
  source: 'seed' | 'bot';
  status: 'active' | 'cancelled';
  createdAt: number;
  remindedAt?: number;
}

export interface OrderItem {
  productId: string;
  qty: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  total: number;
  date: string;
  time: string;
  mode: 'pickup' | 'delivery';
  address: string;
  note: string;
  customer: string;
  source: 'seed' | 'bot';
  status: 'new' | 'confirmed' | 'rejected' | 'cancelled';
  createdAt: number;
}

export interface ChatButton {
  id: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  from: 'customer' | 'bot' | 'owner';
  text: string;
  at: number;
  kind?: 'voice' | 'photo';
  /** Voice length in seconds */
  seconds?: number;
  /** What the assistant understood from a voice message or photo (shown to the owner) */
  note?: string;
  buttons?: ChatButton[];
  /** Bot answer time in milliseconds */
  tookMs?: number;
  /**
   * Fixed messages written by the system, not the AI. Consent messages (and the customer's tap on
   * them) are left out of what the AI sees, so after consent it answers the customer's question.
   */
  fixed?: 'consent' | 'reminder' | 'order_status' | 'error';
}

export interface Alert {
  id: string;
  at: number;
  kind: 'handoff' | 'no_consent' | 'paused' | 'error' | 'order';
  text_ru: string;
  text_kz: string;
  done: boolean;
  /** Order or booking it is about */
  refId?: string;
}

export interface Session {
  ownerUid: string;
  business: Business;
  bookings: Booking[];
  orders: Order[];
  messages: ChatMessage[];
  alerts: Alert[];
  /** Consent to process the customer's messages, asked with buttons before the AI answers */
  consent: 'none' | 'asked' | 'given';
  /** Language the customer writes in, for the fixed messages */
  chatLang: Lang;
  /** The owner answered in the chat; the assistant stays quiet until handed back */
  botPaused: boolean;
  seq: number;
  createdAt: number;
  expiresAt: number;
  busyUntil: number;
}
