import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { URL } from 'url';

export type PaytmEnv = 'production' | 'staging';

export interface PaytmCreds {
  merchant_id: string;
  merchant_key: string;
  env?: PaytmEnv;
}

export interface PaytmVerifyResult {
  ok: boolean;
  paid: boolean;
  status: string;
  reason?: string;
  detail?: string;
  paid_amount: number;
  expected_amount: number;
  txn_id?: string | null;
  bank_txn_id?: string | null;
  raw?: any;
  failure_type?: string;
}

export function buildUniqueTxnRef(suffix: number | string = ''): string {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `GW${ts}${suffix || ''}${rand}`;
}

export function buildUpiPayload(opts: {
  upi_id: string;
  payee_name: string;
  amount: number;
  txn_ref: string;
  note?: string;
}): string {
  const amount = opts.amount.toFixed(2);
  const params = new URLSearchParams();
  params.set('pa', opts.upi_id);
  params.set('pn', opts.payee_name);
  params.set('am', amount);
  params.set('cu', 'INR');
  params.set('tr', opts.txn_ref);
  params.set('tn', opts.note || `Order ${opts.txn_ref}`);
  return `upi://pay?${params.toString()}`;
}

function fetchUrl(url: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(u, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('request timeout')));
    } catch (e) {
      reject(e);
    }
  });
}

export async function verifyPaytmPayment(
  creds: PaytmCreds,
  txn_ref: string,
  expected_amount: number,
): Promise<PaytmVerifyResult> {
  const merchant_id = (creds.merchant_id || '').trim();
  const merchant_key = (creds.merchant_key || '').trim();
  const env = creds.env === 'staging' ? 'staging' : 'production';

  if (!txn_ref) {
    return {
      ok: false, paid: false, status: 'MISSING_TXN_REF',
      failure_type: 'gateway_error', reason: 'missing_txn_ref',
      detail: 'Order reference is missing.',
      paid_amount: 0, expected_amount,
    };
  }
  if (!merchant_id || !merchant_key) {
    return {
      ok: false, paid: false, status: 'CONFIG_ERROR',
      failure_type: 'gateway_error', reason: 'merchant_credentials_missing',
      detail: 'Payment gateway credentials are not configured.',
      paid_amount: 0, expected_amount,
    };
  }

  const payload = { MID: merchant_id, ORDERID: txn_ref };
  const jsonData = JSON.stringify(payload);
  const checksum = crypto.createHmac('sha256', merchant_key).update(jsonData).digest('hex');
  const base = env === 'staging' ? 'https://securegw-stage.paytm.in' : 'https://securegw.paytm.in';
  const url = `${base}/merchant-status/getTxnStatus?JsonData=${encodeURIComponent(jsonData)}&CHECKSUMHASH=${checksum}`;

  let raw: string;
  try {
    raw = await fetchUrl(url);
  } catch (e) {
    return {
      ok: false, paid: false, status: 'REQUEST_FAILED',
      failure_type: 'gateway_error', reason: 'api_request_failed',
      detail: `Could not reach payment gateway: ${(e as Error).message}`,
      paid_amount: 0, expected_amount,
    };
  }

  let response: any;
  try {
    response = JSON.parse(raw);
  } catch {
    return {
      ok: false, paid: false, status: 'INVALID_RESPONSE',
      failure_type: 'gateway_error', reason: 'invalid_json_response',
      detail: 'Payment gateway returned an invalid response.',
      paid_amount: 0, expected_amount, raw,
    };
  }

  const status = String(response.STATUS || '');
  const respCode = String(response.RESPCODE || '');
  const respMsg = String(response.RESPMSG || 'Unknown status');
  const respOrderId = String(response.ORDERID || '');
  const respMid = String(response.MID || '');
  const paidAmount = parseFloat(String(response.TXNAMOUNT ?? '0')) || 0;
  const txnId = response.TXNID || null;
  const bankTxnId = response.BANKTXNID || null;

  const orderIdMatches = respOrderId === txn_ref;
  const midMatches = respMid === merchant_id;
  const amountMatches = Math.abs(paidAmount - expected_amount) < 0.01;
  const verified = status === 'TXN_SUCCESS' && respCode === '01' && orderIdMatches && midMatches && amountMatches;

  if (verified) {
    return {
      ok: true, paid: true, status, reason: 'verified', detail: respMsg,
      paid_amount: paidAmount, expected_amount, txn_id: txnId, bank_txn_id: bankTxnId, raw: response,
    };
  }

  let failure_type = 'verification_issue';
  if (!orderIdMatches || !midMatches) failure_type = 'payment_not_found';
  else if (status === 'PENDING') failure_type = 'payment_pending';
  else if (status === 'TXN_FAILURE') failure_type = 'payment_failed';
  else if (status === 'TXN_SUCCESS' && !amountMatches) failure_type = 'amount_mismatch';
  else if (status === 'NO_RECORD_FOUND' || status === '' || respCode === '501') failure_type = 'payment_not_found';

  return {
    ok: true, paid: false, status, failure_type, reason: respMsg, detail: respMsg,
    paid_amount: paidAmount, expected_amount, txn_id: txnId, bank_txn_id: bankTxnId, raw: response,
  };
}

export function mapFailureToOrderStatus(failure_type?: string): 'pending' | 'failed' | 'expired' {
  if (failure_type === 'payment_pending' || failure_type === 'payment_not_found') return 'pending';
  if (failure_type === 'payment_failed' || failure_type === 'amount_mismatch') return 'failed';
  return 'pending';
}

/**
 * Conservative classifier used by hosted-page polling and check-order.
 *
 * Razorpay-style rule: never flip an active pending order to "failed" just
 * because verification can't yet see the payment. Only two outcomes from a
 * poll are allowed:
 *   - 'paid'    : Paytm has confirmed the txn AND amount matches
 *   - 'pending' : everything else — no record, gateway pending, network
 *                 error, transient TXN_FAILURE (user might retry), etc.
 *
 * The only true terminal "failed" we accept from a poll is an
 * `amount_mismatch` AFTER a successful TXN_SUCCESS — i.e. money landed but
 * for the wrong amount. That can never recover, so it's safe to terminalize.
 *
 * Anything else stays `pending` until expiry takes over (-> 'expired').
 */
export function classifyVerificationForPoll(
  verify: PaytmVerifyResult,
): 'paid' | 'pending' | 'failed' {
  if (verify.paid) return 'paid';
  if (verify.failure_type === 'amount_mismatch') return 'failed';
  return 'pending';
}
