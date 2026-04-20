import express, { Response } from 'express';
import pool from './db';
import { gwSession, GwSessionRequest } from './auth-mw';

const router = express.Router();

function maskKey(key: string | null): string {
  if (!key) return '';
  if (key.length <= 6) return '••••••';
  return key.slice(0, 3) + '••••••' + key.slice(-3);
}

router.get('/', gwSession, async (req: GwSessionRequest, res: Response) => {
  const r = await pool.query(
    'SELECT user_id, paytm_upi_id, paytm_merchant_id, paytm_merchant_key, paytm_env, payee_name, is_active, updated_at FROM gw_settings WHERE user_id=$1',
    [req.gwUser!.id],
  );
  const row = r.rows[0];
  if (!row) {
    return res.json({
      paytm_upi_id: '', paytm_merchant_id: '', paytm_merchant_key_masked: '',
      paytm_env: 'production', payee_name: '', is_active: false, has_key: false,
    });
  }
  res.json({
    paytm_upi_id: row.paytm_upi_id || '',
    paytm_merchant_id: row.paytm_merchant_id || '',
    paytm_merchant_key_masked: maskKey(row.paytm_merchant_key),
    has_key: !!row.paytm_merchant_key,
    paytm_env: row.paytm_env || 'production',
    payee_name: row.payee_name || '',
    is_active: !!row.is_active,
    updated_at: row.updated_at,
  });
});

router.put('/', gwSession, async (req: GwSessionRequest, res: Response) => {
  const upi = String(req.body.paytm_upi_id || '').trim();
  const mid = String(req.body.paytm_merchant_id || '').trim();
  const mkey = String(req.body.paytm_merchant_key || '').trim();
  const env = String(req.body.paytm_env || 'production').trim();
  const payee = String(req.body.payee_name || '').trim();

  if (!upi || !/^[\w.\-]+@[\w.\-]+$/.test(upi)) return res.status(400).json({ error: 'Valid UPI ID required (e.g. name@bank)' });
  if (!mid) return res.status(400).json({ error: 'Merchant ID required' });
  if (!['production', 'staging'].includes(env)) return res.status(400).json({ error: 'Invalid env' });

  // Get existing key if not provided (allow editing other fields without re-entering key)
  let finalKey = mkey;
  if (!finalKey) {
    const ex = await pool.query('SELECT paytm_merchant_key FROM gw_settings WHERE user_id=$1', [req.gwUser!.id]);
    finalKey = ex.rows[0]?.paytm_merchant_key || '';
  }
  if (!finalKey) return res.status(400).json({ error: 'Merchant key required' });

  const isActive = !!(upi && mid && finalKey);

  await pool.query(
    `INSERT INTO gw_settings (user_id, paytm_upi_id, paytm_merchant_id, paytm_merchant_key, paytm_env, payee_name, is_active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       paytm_upi_id=EXCLUDED.paytm_upi_id,
       paytm_merchant_id=EXCLUDED.paytm_merchant_id,
       paytm_merchant_key=EXCLUDED.paytm_merchant_key,
       paytm_env=EXCLUDED.paytm_env,
       payee_name=EXCLUDED.payee_name,
       is_active=EXCLUDED.is_active,
       updated_at=NOW()`,
    [req.gwUser!.id, upi, mid, finalKey, env, payee || null, isActive],
  );
  res.json({ ok: true, is_active: isActive });
});

export default router;
