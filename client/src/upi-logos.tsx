import React from 'react';

/**
 * UPI / payment app brand marks rendered as inline SVG.
 * Each mark is a 40x40 rounded tile that mimics the look of the app's
 * launcher icon (brand color + recognizable glyph/shape).
 *
 * Rendered inline so there is zero risk of broken image links and no
 * external network dependency. To add an app, append to UPI_APPS below.
 */

const Tile: React.FC<{ bg: string; stroke?: string; children: React.ReactNode }> = ({ bg, stroke, children }) => (
  <svg viewBox="0 0 40 40" width="40" height="40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="0.5" y="0.5" width="39" height="39" rx="9" fill={bg} stroke={stroke || 'rgba(10,10,15,0.08)'} />
    {children}
  </svg>
);

const GooglePay = () => (
  <Tile bg="#ffffff">
    <text x="11" y="26" fontFamily="Arial, sans-serif" fontWeight={700} fontSize="14" fill="#5f6368">Pay</text>
    <circle cx="30" cy="13" r="2" fill="#4285F4" />
    <circle cx="33" cy="19" r="2" fill="#EA4335" />
    <circle cx="30" cy="25" r="2" fill="#FBBC04" />
    <circle cx="27" cy="19" r="2" fill="#34A853" />
  </Tile>
);

const PhonePe = () => (
  <Tile bg="#5F259F" stroke="rgba(0,0,0,0.15)">
    <path d="M11 11h12a4 4 0 0 1 4 4v6h2v3h-2v5h-4v-5h-4v5h-3V18h-5v-7z" fill="#ffffff" />
  </Tile>
);

const Paytm = () => (
  <Tile bg="#ffffff">
    <rect x="5" y="13" width="30" height="14" rx="3" fill="#00BAF2" />
    <rect x="5" y="20" width="30" height="7" rx="0" fill="#1A237E" />
    <text x="20" y="24" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={800} fontSize="9" fill="#ffffff">Paytm</text>
  </Tile>
);

const Bhim = () => (
  <Tile bg="#ffffff">
    <rect x="4" y="10" width="32" height="20" rx="3" fill="#EA5D2A" />
    <text x="20" y="24" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={800} fontSize="11" fill="#ffffff">BHIM</text>
  </Tile>
);

const AmazonPay = () => (
  <Tile bg="#0F1A2B">
    <text x="20" y="22" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={800} fontSize="11" fill="#ffffff">amazon</text>
    <path d="M9 26 Q20 33 31 26" stroke="#FF9900" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    <path d="M28 25 l3 1.6 -1.4 2.8" stroke="#FF9900" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Tile>
);

const Cred = () => (
  <Tile bg="#0A0A0A" stroke="rgba(255,255,255,0.08)">
    <text x="20" y="25" textAnchor="middle" fontFamily="Georgia, serif" fontStyle="italic" fontWeight={700} fontSize="14" fill="#ffffff">CRED</text>
  </Tile>
);

const WhatsApp = () => (
  <Tile bg="#25D366">
    <path
      d="M20 9c-6 0-11 5-11 11 0 1.9.5 3.7 1.4 5.3L9 31l5.9-1.5A11 11 0 1 0 20 9zm6 14.6c-.3.7-1.5 1.4-2.1 1.5-.6.1-1.3.1-2.1-.1-.5-.1-1.1-.3-1.9-.7-3.4-1.5-5.6-4.9-5.7-5.1-.2-.2-1.4-1.9-1.4-3.6 0-1.7.9-2.5 1.2-2.9.3-.3.7-.4 1-.4h.7c.2 0 .5 0 .8.6.3.7.9 2.4 1 2.6.1.2.1.4 0 .6-.1.2-.2.3-.4.5l-.5.6c-.2.2-.4.4-.2.7.2.4.9 1.4 1.9 2.3 1.3 1.1 2.4 1.5 2.7 1.7.4.2.6.1.8-.1.2-.2.9-1 1.1-1.4.2-.4.4-.3.7-.2.3.1 2 1 2.4 1.1.4.2.6.3.7.4.1.2.1 1-.2 1.7z"
      fill="#ffffff"
    />
  </Tile>
);

const Mobikwik = () => (
  <Tile bg="#ffffff">
    <circle cx="20" cy="20" r="13" fill="#1B3FB6" />
    <text x="20" y="25" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={800} fontSize="14" fill="#ffffff">M</text>
  </Tile>
);

const Freecharge = () => (
  <Tile bg="#ffffff">
    <rect x="6" y="6" width="28" height="28" rx="6" fill="#EE3E80" />
    <text x="20" y="26" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={800} fontSize="16" fill="#ffffff">F</text>
  </Tile>
);

const Fampay = () => (
  <Tile bg="#FFC700" stroke="rgba(0,0,0,0.18)">
    <text x="20" y="28" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={900} fontSize="22" fill="#0A0A0A">f</text>
  </Tile>
);

const Navi = () => (
  <Tile bg="#0066FF">
    <text x="20" y="26" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={900} fontSize="16" fill="#ffffff">N</text>
    <circle cx="29" cy="12" r="2.2" fill="#FFD400" />
  </Tile>
);

const Slice = () => (
  <Tile bg="#7B61FF">
    <path d="M12 20 L20 12 L28 20 L20 28 Z" fill="#ffffff" opacity="0.15" />
    <text x="20" y="26" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight={800} fontSize="14" fill="#ffffff">slice</text>
  </Tile>
);

export interface UpiApp {
  name: string;
  Logo: React.FC;
}

export const UPI_APPS: UpiApp[] = [
  { name: 'Google Pay',  Logo: GooglePay },
  { name: 'PhonePe',     Logo: PhonePe },
  { name: 'Paytm',       Logo: Paytm },
  { name: 'BHIM',        Logo: Bhim },
  { name: 'Amazon Pay',  Logo: AmazonPay },
  { name: 'CRED',        Logo: Cred },
  { name: 'WhatsApp',    Logo: WhatsApp },
  { name: 'MobiKwik',    Logo: Mobikwik },
  { name: 'Freecharge',  Logo: Freecharge },
  { name: 'Fampay',      Logo: Fampay },
  { name: 'Navi',        Logo: Navi },
  { name: 'Slice',       Logo: Slice },
];
