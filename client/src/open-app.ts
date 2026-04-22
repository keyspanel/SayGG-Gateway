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
  // iPadOS 13+ reports as MacIntel with touch; treat as iOS.
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1) return 'ios';
  return 'other';
}

/**
 * Build a safe Android Intent URL that opens the app's launcher (home) screen.
 * Notes:
 *  - We DO NOT include S.browser_fallback_url, so if the app is not installed
 *    Android will silently fail instead of redirecting to the Play Store.
 *  - We DO NOT include any UPI payment params. This is a launch-only intent.
 */
function androidLauncherIntent(pkg: string): string {
  return (
    'intent://#Intent' +
    ';scheme=android-app' +
    ';package=' + pkg +
    ';action=android.intent.action.MAIN' +
    ';category=android.intent.category.LAUNCHER' +
    ';end'
  );
}

export interface OpenAppResult {
  attempted: boolean;
  /** True if no native launch was issued and the caller should show the manual-open hint instead. */
  fallback: boolean;
  /** Short helper text suitable for a non-blocking toast. */
  hint: string;
}

/**
 * Try to open the given app's home screen on the user's device. Never opens
 * a payment sheet, never sends amount/VPA/note. If no safe target exists for
 * the current platform, returns a fallback hint for the UI to display.
 */
export function openAppHome(app: UpiApp): OpenAppResult {
  const platform = detectPlatform();
  const manual = `Open ${app.name} on your phone and scan the downloaded QR.`;

  if (platform === 'android' && app.androidPackage) {
    try {
      window.location.href = androidLauncherIntent(app.androidPackage);
      return {
        attempted: true,
        fallback: false,
        hint: `Opening ${app.name}… scan the downloaded QR after it opens.`,
      };
    } catch {
      return { attempted: false, fallback: true, hint: manual };
    }
  }

  if (platform === 'ios' && app.iosScheme) {
    try {
      // Plain scheme with no params → opens app home where supported. If the
      // scheme isn't registered, iOS shows its own quiet "Cannot open" dialog
      // and we still surface the manual hint as a soft toast.
      window.location.href = app.iosScheme;
      return {
        attempted: true,
        fallback: false,
        hint: `Opening ${app.name}… scan the downloaded QR after it opens.`,
      };
    } catch {
      return { attempted: false, fallback: true, hint: manual };
    }
  }

  return { attempted: false, fallback: true, hint: manual };
}
