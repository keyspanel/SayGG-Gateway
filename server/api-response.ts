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
  INVALID_CREDENTIALS: 'Check your username and password.',
  USERNAME_EXISTS: 'Choose a different username.',
  EMAIL_EXISTS: 'Use a different email or log in.',
  CREATE_ORDER_FAILED: 'Try again later.',
  CHECK_ORDER_FAILED: 'Try again later.',
  REGISTRATION_FAILED: 'Try again later.',
  LOGIN_FAILED: 'Try again later.',
  INTERNAL_SERVER_ERROR: 'Try again later.',
  INTERNAL_ERROR: 'Try again later.',
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
