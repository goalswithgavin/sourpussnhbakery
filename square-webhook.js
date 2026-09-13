// api/square-webhook.js
//
// Square calls this URL directly (not the customer's browser) when a payment's
// status changes. We use it to catch the moment a card payment actually
// completes, and only then create the matching order in iBakePro — marked as
// already paid. This is separate from create-checkout.js, which only asks
// Square for a checkout page; it has no way of knowing whether the customer
// actually paid, which is exactly what this webhook is for.
//
// SETUP (see README.md for the full walkthrough):
//   1. In the Square Developer Dashboard, open your app > Webhooks.
//   2. Create a subscription:
//        Notification URL: https://<your-site>/api/square-webhook
//        Events: payment.updated
//      Do this once for Sandbox and once for Production — they're separate.
//   3. Square shows a "Signature Key" for that subscription. Copy it into
//      Vercel as SQUARE_WEBHOOK_SIGNATURE_KEY.
//   4. Also required (already set for create-checkout.js):
//        SQUARE_ACCESS_TOKEN, SQUARE_ENV, IBAKEPRO_SECRET_KEY, IBAKEPRO_REGION

const crypto = require('crypto');
const ibakepro = require('./lib/ibakepro');

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function isValidSignature(rawBody, signatureHeader, signatureKey, notificationUrl) {
  if (!signatureHeader || !signatureKey) return false;
  const hmac = crypto.createHmac('sha256', signatureKey);
  hmac.update(notificationUrl + rawBody.toString('utf8'));
  const expected = hmac.digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const rawBody = await readRawBody(req);
  const SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
  const NOTIFICATION_URL = SITE_URL + '/api/square-webhook';
  const signatureHeader = req.headers['x-square-hmacsha256-signature'];

  if (!isValidSignature(rawBody, signatureHeader, SIGNATURE_KEY, NOTIFICATION_URL)) {
    console.error('Square webhook: invalid signature — rejecting.');
    res.status(401).send('Invalid signature');
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    res.status(400).send('Invalid JSON');
    return;
  }

  // Acknowledge quickly — Square retries if we take too long or don't
  // respond 2xx. We do our best-effort iBakePro sync below and log any
  // failure rather than making Square hammer this endpoint with retries
  // that won't fix a downstream data problem anyway.
  res.status(200).send('ok');

  try {
    if (event.type !== 'payment.updated') return;

    const payment = event.data && event.data.object && event.data.object.payment;
    if (!payment || payment.status !== 'COMPLETED') return;

    const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
    const ENV = process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox';
    const BASE_URL = ENV === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';

    const orderRes = await fetch(BASE_URL + '/v2/orders/' + payment.order_id, {
      headers: {
        'Authorization': 'Bearer ' + ACCESS_TOKEN,
        'Square-Version': '2026-07-15'
      }
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok || !orderData.order) {
      console.error('Square webhook: could not fetch order', payment.order_id, orderData);
      return;
    }

    const squareOrder = orderData.order;
    const meta = squareOrder.metadata || {};

    if (meta.source !== 'sourpuss-website') return; // not one of ours

    const items = (squareOrder.line_items || []).map((li) => ({
      name: li.name,
      quantity: Number(li.quantity),
      price: (li.base_price_money ? li.base_price_money.amount : 0) / 100
    }));

    const totalMoney = squareOrder.total_money ? squareOrder.total_money.amount / 100 : undefined;

    await ibakepro.createOrder({
      items: items,
      total: totalMoney,
      customer: {
        firstName: meta.customer_name || 'Website customer',
        email: meta.customer_email,
        phone: meta.customer_phone || ''
      },
      fulfillment: {
        type: meta.fulfillment_type === 'pickup' ? 'pickup' : 'delivery',
        title: meta.fulfillment_title || '',
        dateISO: meta.ready_date_iso || undefined,
        notes: meta.customer_note || ''
      },
      payment: {
        amount: totalMoney,
        method: 'card',
        status: 'completed',
        paidDate: new Date().toISOString()
      },
      externalId: payment.id,
      idempotencyKey: 'square-' + payment.id
    });
  } catch (err) {
    console.error('Square webhook processing error:', err);
  }
}

// Vercel auto-parses JSON bodies by default, which breaks signature
// verification (the signature is computed over the exact raw bytes Square
// sent). This turns that off so we can read the raw body ourselves.
handler.config = { api: { bodyParser: false } };

module.exports = handler;
