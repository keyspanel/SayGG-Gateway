import { NextFunction, Request, Response } from 'express';

export const gatewayEndpoints = {
  create_order: '/api/gateway/create-order',
  check_order: '/api/gateway/check-order',
  dashboard: '/api/gateway/dashboard',
  transactions: '/api/gateway/transactions',
  settings: '/api/gateway/settings',
  auth_login: '/api/gateway/auth/login',
  auth_register: '/api/gateway/auth/register',
  api_token: '/api/gateway/auth/token',
  regenerate_token: '/api/gateway/auth/regenerate-token',
};

export function apiSuccess(res: Response, message: string, data: Record<string, unknown> = {}, status = 200) {
  return res.status(status).json({
    success: true,
    message,
    data,
  });
}

export function apiError(
  res: Response,
  status: number,
  message: string,
  code: string,
  details: Record<string, unknown> = {},
) {
  return res.status(status).json({
    success: false,
    message,
    code,
    details,
  });
}

export function methodNotAllowed(methods: string[]) {
  return (req: Request, res: Response) =>
    apiError(res, 405, 'Invalid endpoint or method', 'METHOD_NOT_ALLOWED', {
      method: req.method,
      allowed_methods: methods,
      available_endpoints: gatewayEndpoints,
    });
}

export function gatewayNotFound(req: Request, res: Response) {
  return apiError(res, 404, 'Invalid endpoint or method', 'GATEWAY_ROUTE_NOT_FOUND', {
    path: req.originalUrl,
    method: req.method,
    available_endpoints: gatewayEndpoints,
  });
}

export function apiNotFound(req: Request, res: Response) {
  return apiError(res, 404, 'API endpoint not found', 'API_ROUTE_NOT_FOUND', {
    path: req.originalUrl,
    method: req.method,
  });
}

export function apiErrorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    return next(err);
  }
  console.error('[gateway] unhandled API error', err);
  return apiError(res, 500, 'Internal server error', 'INTERNAL_SERVER_ERROR', {
    path: req.originalUrl,
    method: req.method,
  });
}