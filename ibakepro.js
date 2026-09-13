// api/lib/ibakepro.js
//
// Shared helper for talking to iBakePro's v2 API. Used by both
// create-cash-order.js (cash orders, created immediately) and
// square-webhook.js (card orders, created once Square confirms payment).
//
// Requires these environment variables (set in Vercel):
//   IBAKEPRO_SECRET_KEY   - starts with ibp_sk_, needs orders:write + products:read
//   IBAKEPRO_REGION       - "us", "au", or "eu" — must match the account's region

function baseUrl() {
  var region = (process.env.IBAKEPRO_REGION || 'us').toLowerCase();
  return 'https://' + region + '.api.ibakepro.com';
}

function authHeaders() {
  var key = process.env.IBAKEPRO_SECRET_KEY;
  if (!key) throw new Error('IBAKEPRO_SECRET_KEY is not set');
  return {
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
  };
}

// Fetches her product catalog and returns a Map of
// lowercased product name -> product id, for matching order line items
// to real catalog products. Paginates in case she has more than 100 items.
async function getProductMap() {
  var map = {};
  var cursor = null;
  var guard = 0; // safety valve against a pagination loop

  do {
    var url = baseUrl() + '/api/v2/products?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    var res = await fetch(url, { headers: authHeaders() });
    var data = await res.json();
    if (!res.ok) {
      console.error('iBakePro products list error:', data);
      break;
    }
    (data.data || []).forEach(function (p) {
      if (p.name) map[p.name.trim().toLowerCase()] = p.id;
    });
    cursor = data.pagination && data.pagination.has_more ? data.pagination.next_cursor : null;
    guard++;
  } while (cursor && guard < 20);

  return map;
}

// items: [{ name, quantity, price }]
// customer: { firstName, email, phone }
// fulfillment: { type: 'pickup'|'delivery', title, dateISO, notes }
// payment: null (unpaid / cash) OR { amount, method, status, paidDate }
// options: { externalId, idempotencyKey, orderNote }
async function createOrder(params) {
  var items = params.items || [];
  var customer = params.customer || {};
  var fulfillment = params.fulfillment || {};
  var payment = params.payment || null;

  var productMap = await getProductMap();

  var lineItems = items.map(function (item) {
    var matchedId = productMap[String(item.name).trim().toLowerCase()];
    var line = {
      name: item.name,
      quantity: item.quantity,
      unit_price: item.price
    };
    if (matchedId) line.product_id = matchedId; // else: custom one-off line, still valid
    return line;
  });

  var subtotal = lineItems.reduce(function (sum, li) {
    return sum + (li.unit_price * li.quantity);
  }, 0);

  var body = {
    customer: {
      first_name: customer.firstName || 'Website customer',
      email: customer.email,
      phone: customer.phone || ''
    },
    items: lineItems,
    pricing: {
      subtotal: round2(subtotal),
      total: round2(params.total != null ? params.total : subtotal),
      currency: 'USD'
    },
    delivery: {
      method: fulfillment.type === 'pickup' ? 'pickup' : 'delivery',
      date: fulfillment.dateISO || undefined,
      notes: fulfillment.notes || undefined
    },
    notes: {
      public: fulfillment.title || ''
    },
    channel: 'headless_checkout',
    external_id: params.externalId
  };

  if (payment) {
    body.payment = {
      amount: round2(payment.amount),
      method: payment.method || 'other',
      status: payment.status || 'completed',
      paid_date: payment.paidDate
    };
  } else {
    body.payment_status = 'pending';
    body.payment_method = 'cash';
  }

  var res = await fetch(baseUrl() + '/api/v2/orders', {
    method: 'POST',
    headers: Object.assign({}, authHeaders(), {
      'Idempotency-Key': params.idempotencyKey || ('sp-' + Date.now())
    }),
    body: JSON.stringify(body)
  });

  var data = await res.json();
  if (!res.ok) {
    console.error('iBakePro create order error:', res.status, data);
    throw new Error('iBakePro order create failed: ' + res.status);
  }
  return data;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = { getProductMap: getProductMap, createOrder: createOrder };
