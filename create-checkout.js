// api/create-checkout.js
//
// This runs on Vercel's servers, not in the customer's browser — that's required,
// because it uses a secret Square Access Token that must never be exposed in
// client-side code. The website's order builder POSTs the customer's selections
// here; this function turns them into a real Square Order and asks Square for a
// hosted checkout page URL, then sends that URL back so the browser can redirect
// the customer to it to pay.
//
// SETUP — see README.md in the project root for the full walkthrough. In short:
//   1. In the Vercel project dashboard: Settings > Environment Variables, add:
//        SQUARE_ACCESS_TOKEN   - from the Square Developer Dashboard
//        SQUARE_LOCATION_ID    - from the same place
//        SQUARE_ENV            - "sandbox" while testing, "production" when live
//        SITE_URL              - e.g. https://sourpussnhbakery.com (used for the
//                                 receipt redirect link)
//   2. Redeploy. Vercel automatically turns any file in /api into an endpoint —
//      this one is available at /api/create-checkout with no extra config.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  let order = req.body;
  if (typeof order === 'string') {
    try { order = JSON.parse(order); } catch (err) {
      res.status(400).send('Invalid request body');
      return;
    }
  }

  const items = Array.isArray(order && order.items) ? order.items : [];
  if (items.length === 0) {
    res.status(400).send('No items in order');
    return;
  }

  const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
  const ENV = process.env.SQUARE_ENV === 'production' ? 'production' : 'sandbox';
  let SITE_URL = (process.env.SITE_URL || 'https://example.com').trim();
  if (!/^https?:\/\//i.test(SITE_URL)) SITE_URL = 'https://' + SITE_URL;
  const BASE_URL = ENV === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  if (!ACCESS_TOKEN || !LOCATION_ID) {
    res.status(500).json({ error: 'not_configured', detail: 'Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID in Vercel.' });
    return;
  }

  // Build Square order line items. Square wants prices in the smallest currency
  // unit (cents for USD), as integers.
  const lineItems = items.map((item) => ({
    name: String(item.name).slice(0, 500),
    quantity: String(item.quantity),
    base_price_money: {
      amount: Math.round(Number(item.price) * 100),
      currency: 'USD'
    }
  }));

  const noteParts = [];
  if (order.fulfillment) noteParts.push(order.fulfillment);
  if (order.readyDate) noteParts.push('Ready ' + order.readyDate);
  if (order.name) noteParts.push('Name: ' + order.name);
  if (order.email) noteParts.push('Email: ' + order.email);
  if (order.phone) noteParts.push('Phone: ' + order.phone);
  if (order.note) noteParts.push('Note: ' + order.note);

  // These land back in our hands via the Square webhook once payment
  // completes (see api/square-webhook.js) — that's what lets us create a
  // matching order in iBakePro without guessing anything from free text.
  const metadata = {
    source: 'sourpuss-website',
    fulfillment_type: order.fulfillmentType === 'pickup' ? 'pickup' : 'delivery',
    fulfillment_title: String(order.fulfillment || '').slice(0, 200),
    ready_date_iso: String(order.readyDateISO || '').slice(0, 40),
    customer_name: String(order.name || '').slice(0, 200),
    customer_email: String(order.email || '').slice(0, 200),
    customer_phone: String(order.phone || '').slice(0, 60),
    customer_note: String(order.note || '').slice(0, 255)
  };

  // Square rejects empty metadata values, so drop any blanks.
  Object.keys(metadata).forEach((k) => { if (!metadata[k]) delete metadata[k]; });

  const body = {
    idempotency_key: randomId(),
    order: {
      location_id: LOCATION_ID,
      line_items: lineItems,
      metadata: metadata
    },
    checkout_options: {
      redirect_url: SITE_URL.replace(/\/$/, '') + '/#order',
      ask_for_shipping_address: false
    },
    payment_note: noteParts.join(' · ').slice(0, 500)
  };

  try {
    const squareRes = await fetch(BASE_URL + '/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ACCESS_TOKEN,
        'Square-Version': '2026-07-15'
      },
      body: JSON.stringify(body)
    });

    const data = await squareRes.json();

    if (!squareRes.ok) {
      console.error('Square API error:', data);
      const first = data && data.errors && data.errors[0];
      res.status(502).json({
        error: 'square_rejected',
        env: ENV,
        code: first && first.code,
        detail: first && first.detail
      });
      return;
    }

    res.status(200).json({ url: data.payment_link.url });
  } catch (err) {
    console.error('Checkout function error:', err);
    res.status(500).send('Something went wrong creating checkout.');
  }
};

function randomId() {
  // Square requires a unique idempotency key per request.
  return 'sp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}
