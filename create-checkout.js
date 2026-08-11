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
  const SITE_URL = process.env.SITE_URL || 'https://example.com';
  const BASE_URL = ENV === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  if (!ACCESS_TOKEN || !LOCATION_ID) {
    res.status(500).send('Square is not configured yet — missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID.');
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
  if (order.contact) noteParts.push('Contact: ' + order.contact);
  if (order.note) noteParts.push('Note: ' + order.note);

  const body = {
    idempotency_key: randomId(),
    order: {
      location_id: LOCATION_ID,
      line_items: lineItems,
      // Square keeps a running note on the order — this is how the fulfillment
      // day, ready date, and customer's contact info reach Elizabeth's Square
      // dashboard alongside the paid order.
      // (See README.md for a note on upgrading this to Square's structured
      // "fulfillments" field for pickup/delivery scheduling.)
      metadata: { source: 'sourpuss-website' }
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
      res.status(502).send('Square could not create the checkout page.');
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
