/**
 * Single source of truth for the supported UPI / payment app set shown on the
 * hosted payment page.
 *
 * Each asset under /payment-apps/*.svg is a real brand mark sourced from
 * Iconify (logos / simple-icons / arcticons sets). Full-color brand SVGs are
 * used where available (Google Pay, WhatsApp); the rest are clean vector
 * marks painted in the brand's primary color and rendered on a white tile in
 * the carousel so they read as proper app icons.
 *
 * To add an app: drop its SVG in `client/public/payment-apps/`, append an
 * entry below. To remove: delete the entry. No code changes required.
 */
export interface UpiApp {
  id: string;
  name: string;
  logo: string;
  alt: string;
  /** Optional accent color used for the fallback tile if the SVG fails. */
  accent: string;
}

export const UPI_APPS: UpiApp[] = [
  { id: 'gpay',       name: 'Google Pay', logo: '/payment-apps/google-pay.svg', alt: 'Google Pay logo', accent: '#4285F4' },
  { id: 'phonepe',    name: 'PhonePe',    logo: '/payment-apps/phonepe.svg',    alt: 'PhonePe logo',    accent: '#5F259F' },
  { id: 'paytm',      name: 'Paytm',      logo: '/payment-apps/paytm.svg',      alt: 'Paytm logo',      accent: '#00BAF2' },
  { id: 'bhim',       name: 'BHIM',       logo: '/payment-apps/bhim.svg',       alt: 'BHIM UPI logo',   accent: '#EA5D2A' },
  { id: 'amazonpay',  name: 'Amazon Pay', logo: '/payment-apps/amazon-pay.svg', alt: 'Amazon Pay logo', accent: '#FF9900' },
  { id: 'cred',       name: 'CRED',       logo: '/payment-apps/cred.svg',       alt: 'CRED logo',       accent: '#0A0A0A' },
  { id: 'whatsapp',   name: 'WhatsApp',   logo: '/payment-apps/whatsapp.svg',   alt: 'WhatsApp Pay logo', accent: '#25D366' },
  { id: 'mobikwik',   name: 'MobiKwik',   logo: '/payment-apps/mobikwik.svg',   alt: 'MobiKwik logo',   accent: '#1B3FB6' },
  { id: 'freecharge', name: 'Freecharge', logo: '/payment-apps/freecharge.svg', alt: 'Freecharge logo', accent: '#EE3E80' },
  { id: 'fampay',     name: 'FamApp',     logo: '/payment-apps/fampay.svg',     alt: 'FamApp by Trio logo', accent: '#FFC700' },
  { id: 'navi',       name: 'Navi',       logo: '/payment-apps/navi.svg',       alt: 'Navi logo',       accent: '#0066FF' },
  { id: 'slice',      name: 'slice',      logo: '/payment-apps/slice.svg',      alt: 'slice logo',      accent: '#7B61FF' },
];
