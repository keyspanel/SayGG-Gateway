import type { UpiApp } from './upi-logos';

/**
 * Detect platform purely from UA. We only need a coarse Android / iOS / other
 * split — anything else gets the manual-open helper.
 */
export type Platform = 'android' | 'ios' | 'other';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  // iPadOS 13+ reports as MacIntel with touch.
  if (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1) return 'ios';
  return 'other';
}

/**
 * Build a Chrome-compatible Android Intent URL that opens the app's launcher
 * (home) activity directly — same effect as tapping the app icon on the home
 * screen. NO UPI payment params. If the app isn't installed, Chrome follows
 * `S.browser_fallback_url` and sends the user to the Play Store listing for
 * that exact package.
 *
 * Reference: https://developer.chrome.com/docs/android/intents
 */
function androidLauncherIntent(pkg: string, fallbackUrl: string): string {
  return (
    'intent://launch/#Intent' +
    ';scheme=android-app' +
    ';package=' + pkg +
    ';action=android.intent.action.MAIN' +
    ';category=android.intent.category.LAUNCHER' +
    ';S.browser_fallback_url=' + encodeURIComponent(fallbackUrl) +
    ';end'
  );
}

export interface OpenAppResult {
  /** True if a native launch attempt was issued. */
  attempted: boolean;
  /** True when no launch was possible and the caller should show the manual-open hint. */
  fallback: boolean;
  /** Short helper text suitable for a non-blocking toast. */
  hint: string;
}

/**
 * iOS scheme launch with App Store fallback. Tries the scheme; if the page
 * is still visible after ~1.4s (i.e. the app didn't take over), navigates to
 * the App Store listing. Cancels the fallback if the page becomes hidden,
 * which happens when the target app actually opens.
 */
function tryIosLaunch(scheme: string, storeUrl?: string) {
  let switched = false;
  const onHide = () => { switched = true; };
  document.addEventListener('visibilitychange', onHide, { once: true });
  window.addEventListener('pagehide', onHide, { once: true });

  // Navigate to the scheme. If the app handles it, the page will be backgrounded.
  window.location.href = scheme;

  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    if (!switched && !document.hidden && storeUrl) {
      window.location.href = storeUrl;
    }
  }, 1400);
}

/**
 * Try to open the given app's home screen on the user's device.
 *
 * Behavior:
 *  - Android: builds a MAIN/LAUNCHER intent for the package; if the app is
 *    not installed Chrome follows `S.browser_fallback_url` to the Play Store
 *    page for that exact package.
 *  - iOS: opens the known URL scheme. If the app doesn't take over within
 *    ~1.4s, navigates to the App Store listing. If no scheme is known but a
 *    store URL exists, goes straight to the App Store.
 *  - Desktop / unknown: returns the manual-open hint for the UI to display.
 *
 * No `upi://pay`, no amount, no VPA, no txn ref — launch-only.
 */
export function openAppHome(app: UpiApp): OpenAppResult {
  const platform = detectPlatform();
  const manual = `Open ${app.name} on your phone and scan the downloaded QR.`;

  if (platform === 'android' && app.androidPackage) {
    const fallback = app.playStoreUrl || `https://play.google.com/store/apps/details?id=${app.androidPackage}`;
    try {
      window.location.href = androidLauncherIntent(app.androidPackage, fallback);
      return {
        attempted: true,
        fallback: false,
        hint: `Opening ${app.name}… scan the downloaded QR after it opens.`,
      };
    } catch {
      try { window.location.href = fallback; } catch { /* noop */ }
      return { attempted: false, fallback: true, hint: manual };
    }
  }

  if (platform === 'ios') {
    if (app.iosScheme) {
      try {
        tryIosLaunch(app.iosScheme, app.appStoreUrl);
        return {
          attempted: true,
          fallback: false,
          hint: `Opening ${app.name}… scan the downloaded QR after it opens.`,
        };
      } catch {
        if (app.appStoreUrl) {
          try { window.location.href = app.appStoreUrl; } catch { /* noop */ }
        }
        return { attempted: false, fallback: true, hint: manual };
      }
    }
    if (app.appStoreUrl) {
      try { window.location.href = app.appStoreUrl; } catch { /* noop */ }
      return {
        attempted: true,
        fallback: true,
        hint: `Install ${app.name} from the App Store, then scan the downloaded QR.`,
      };
    }
    return { attempted: false, fallback: true, hint: manual };
  }

  return { attempted: false, fallback: true, hint: manual };
}
