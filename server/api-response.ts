import { NextFunction, Request, Response } from 'express';

const HINTS: Record<string, string> = {
  GATEWAY_ROUTE_NOT_FOUND:
    'Use the documented gateway API endpoints with the correct HTTP method. See API Docs after login.',
  METHOD_NOT_ALLOWED: 'Use the correct HTTP method for this endpoint. See API Docs.',
  API_ROUTE_NOT_FOUND: 'Use a valid API endpoint. See API Docs.',
  AUTH_REQUIRED: 'Log in to access this resource.',
  INVALID_SESSION: 'Log in again to continue.',
  ACCOUNT_INACTIVE: 'Contact support to reactivate your account.',
  API_TOKEN_REQUIRED: 'Provide a valid API token to access this resource.',
  INVALID_API_TOKEN: 'Provide a valid API token to access this resource.',
  SETTINGS_MISSING: 'Save your gateway settings before generating or checking orders.',
  VALIDATION_ERROR: 'Send the required fields in the request body.',
  ORDER_NOT_FOUND: 'Check the order_id, txn_ref or client_order_id.',
  ORDER_ALREADY_EXISTS: 'Use a unique client_order_id for each new order.',
  IDEMPOTENCY_CONFLICT: 'Reuse Idempotency-Key only with the exact same request body.',
  INVALID_CREDENTIALS: 'Check your username and password.',
  USERNAME_EXISTS: 'Choose a different username.',
  EMAIL_EXISTS: 'Use a different email or log in.',
  CREATE_ORDER_FAILED: 'Try again later.',
  CHECK_ORDER_FAILED: 'Try again later.',
  REGISTRATION_FAILED: 'Try again later.',
  LOGIN_FAILED: 'Try again later.',
  INTERNAL_SERVER_ERROR: 'Try again later.',
  INTERNAL_ERROR: 'Try again later.',
  RATE_LIMITED: 'Slow down. Try again after the suggested wait.',
  RATE_LIMITED_LOGIN: 'Too many attempts. Try again after the cooldown.',
  RATE_LIMITED_REGISTER: 'Too many attempts. Try again later.',
  RATE_LIMITED_CREATE_ORDER: 'Reduce create-order frequency.',
  RATE_LIMITED_CHECK_ORDER: 'Reduce check-order frequency.',
  RATE_LIMITED_TOKEN_GEN: 'Reduce token regeneration frequency.',
  RATE_LIMITED_PAY: 'Reduce request frequency to the hosted page.',
  RATE_LIMITED_PAY_REFRESH: 'Reduce refresh frequency on the hosted page.',
  RATE_LIMITED_PAY_STREAM: 'Reduce live-stream connection frequency.',
  RATE_LIMITED_PAY_QR: 'Reduce QR fetch frequency.',
  PAYMENT_LINK_NOT_FOUND: 'Confirm the payment link is correct or request a new one.',
  QR_NOT_AVAILABLE: 'QR is only available for active payment links.',
  SSE_TOO_MANY: 'Too many open live connections. Close unused tabs.',
  INVALID_TRANSITION: 'Order is already finalized and cannot be changed.',
  CALLBACK_BLOCKED: 'Callback URL was rejected by safety policy.',
  OWNER_ONLY: 'Owner access required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  PLAN_REQUIRED: 'Choose a plan to start using the gateway.',
  PLAN_EXPIRED: 'Your plan has expired. Renew to continue.',
  PLAN_FEATURE_LOCKED: 'Your current plan does not include this feature.',
  PLAN_NOT_FOUND: 'Pick a valid plan from the billing page.',
  PLAN_INACTIVE: 'This plan is not currently available.',
  PLATFORM_PAYMENT_NOT_CONFIGURED: 'Owner has not configured platform UPI yet. Try again later.',
  PAYMENT_NOT_FOUND: 'Check the payment link or open a new one.',
  ORDER_MODE_REQUIRED: 'Provide mode="server" or mode="hosted" in the request body.',
  HOSTED_PAGE_NOT_AVAILABLE: 'Hosted page is not available for this order.',
};

export function apiSuccess(
  res: Response,
  message: string,
  data: Record<string, unknown> = {},
  status = 200,
) {
  return res.status(status).json({ success: true, message, data });
}

export function apiError(
  res: Response,
  status: number,
  message: string,
  code: string,
  details: Record<string, unknown> = {},
) {
  const req = res.req as Request | undefined;
  const { hint: callerHint, ...rest } = details as { hint?: string } & Record<string, unknown>;
  const hint = callerHint || HINTS[code] || 'See API Docs for the correct request format.';

  return res.status(status).json({
    success: false,
    message,
    code,
    details: {
      path: req?.originalUrl,
      method: req?.method,
      hint,
      ...rest,
    },
  });
}

export function methodNotAllowed(methods: string[]) {
  return (req: Request, res: Response) => {
    res.setHeader('Allow', methods.join(', '));
    return apiError(res, 405, 'Invalid endpoint or method', 'METHOD_NOT_ALLOWED');
  };
}

export function gatewayNotFound(_req: Request, res: Response) {
  return apiError(res, 404, 'Invalid endpoint or method', 'GATEWAY_ROUTE_NOT_FOUND');
}

export function apiNotFound(_req: Request, res: Response) {
  return apiError(res, 404, 'API endpoint not found', 'API_ROUTE_NOT_FOUND');
}

export function apiErrorHandler(err: Error, _req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  console.error('[gateway] unhandled API error', err);
  return apiError(res, 500, 'Internal server error', 'INTERNAL_SERVER_ERROR');
}
