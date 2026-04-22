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
 * Per-app launch targets:
 *  - androidPackage: real Android package id used to build a safe Intent URL
 *    (`intent://#Intent;package=<pkg>;action=...MAIN;category=...LAUNCHER;end`).
 *    No Play Store fallback is appended → if the app is not installed the
 *    intent simply does nothing, never auto-redirecting to the store.
 *  - iosScheme: only set for apps whose plain URL scheme is well-known to
 *    open the app's home screen with no payment params. Apps without a
 *    confirmed safe scheme are left undefined → tap on iOS shows the manual
 *    fallback toast instead of risking a broken navigation.
 *
 * IMPORTANT: these are app-launch targets only. No `upi://pay` deep-link,
 * no amount, no VPA, no txn ref — tapping a logo opens the app's home
 * screen so the user can scan the downloaded QR manually.
 *
 * To add an app: drop its SVG in `client/public/payment-apps/`, append an
 * entry below.
 */
export interface UpiApp {
  id: string;
  name: string;
  logo: string;
  alt: string;
  /** Accent color used for the fallback letter tile if the SVG fails to load. */
  accent: string;
  /** Android package id for safe MAIN/LAUNCHER intent. */
  androidPackage?: string;
  /** iOS URL scheme that opens the app home screen with NO payment params. */
  iosScheme?: string;
}

export const UPI_APPS: UpiApp[] = [
  {
    id: 'gpay', name: 'Google Pay', logo: '/payment-apps/google-pay.svg',
    alt: 'Google Pay logo', accent: '#4285F4',
    androidPackage: 'com.google.android.apps.nbu.paisa.user',
    iosScheme: 'gpay://',
  },
  {
    id: 'phonepe', name: 'PhonePe', logo: '/payment-apps/phonepe.svg',
    alt: 'PhonePe logo', accent: '#5F259F',
    androidPackage: 'com.phonepe.app',
    iosScheme: 'phonepe://',
  },
  {
    id: 'paytm', name: 'Paytm', logo: '/payment-apps/paytm.svg',
    alt: 'Paytm logo', accent: '#00BAF2',
    androidPackage: 'net.one97.paytm',
    iosScheme: 'paytmmp://',
  },
  {
    id: 'bhim', name: 'BHIM', logo: '/payment-apps/bhim.svg',
    alt: 'BHIM UPI logo', accent: '#EA5D2A',
    androidPackage: 'in.org.npci.upiapp',
    // No widely-confirmed safe iOS scheme → graceful toast on iOS.
  },
  {
    id: 'amazonpay', name: 'Amazon Pay', logo: '/payment-apps/amazon-pay.svg',
    alt: 'Amazon Pay logo', accent: '#FF9900',
    androidPackage: 'in.amazon.mShop.android.shopping',
    iosScheme: 'com.amazon.mobile.shopping://',
  },
  {
    id: 'cred', name: 'CRED', logo: '/payment-apps/cred.svg',
    alt: 'CRED logo', accent: '#0A0A0A',
    androidPackage: 'com.dreamplug.androidapp',
    iosScheme: 'cred://',
  },
  {
    id: 'whatsapp', name: 'WhatsApp', logo: '/payment-apps/whatsapp.svg',
    alt: 'WhatsApp Pay logo', accent: '#25D366',
    androidPackage: 'com.whatsapp',
    iosScheme: 'whatsapp://',
  },
  {
    id: 'mobikwik', name: 'MobiKwik', logo: '/payment-apps/mobikwik.svg',
    alt: 'MobiKwik logo', accent: '#1B3FB6',
    androidPackage: 'com.mobikwik_new',
  },
  {
    id: 'freecharge', name: 'Freecharge', logo: '/payment-apps/freecharge.svg',
    alt: 'Freecharge logo', accent: '#EE3E80',
    androidPackage: 'com.freecharge.android',
  },
  {
    id: 'fampay', name: 'FamApp', logo: '/payment-apps/fampay.svg',
    alt: 'FamApp by Trio logo', accent: '#FFC700',
    androidPackage: 'com.fampay.in',
  },
  {
    id: 'navi', name: 'Navi', logo: '/payment-apps/navi.svg',
    alt: 'Navi logo', accent: '#0066FF',
    androidPackage: 'com.naviapp',
  },
  {
    id: 'slice', name: 'slice', logo: '/payment-apps/slice.svg',
    alt: 'slice logo', accent: '#7B61FF',
    androidPackage: 'in.slice.android',
  },
];
