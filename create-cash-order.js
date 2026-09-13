// api/create-cash-order.js
//
// Handles "Pay Cash at Pickup/Delivery" orders. There's no online payment to
// process here, so unlike create-checkout.js this doesn't talk to Square at
// all — it creates the order directly in iBakePro, marked as unpaid, so
// Elizabeth sees it on her production/order list and collects cash when she
// hands it over.
//
// Requires the IBAKEPRO_SECRET_KEY and IBAKEPRO_REGION environment variables
// — see api/lib/ibakepro.js and README.md.

const ibakepro = require('./lib/ibakepro');

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
  if (!order.email) {
    res.status(400).send('An email address is required.');
    return;
  }

  const total = items.reduce((sum, it) => sum + (Number(it.price) * Number(it.quantity)), 0);

  try {
    const result = await ibakepro.createOrder({
      items: items.map((it) => ({ name: it.name, quantity: it.quantity, price: it.price })),
      total: total,
      customer: {
        firstName: order.name || 'Website customer',
        email: order.email,
        phone: order.phone || ''
      },
      fulfillment: {
        type: order.fulfillmentType === 'pickup' ? 'pickup' : 'delivery',
        title: order.fulfillment || '',
        dateISO: order.readyDateISO || undefined,
        notes: order.note || ''
      },
      payment: null, // no payment recorded — cash is collected in person
      externalId: 'cash-' + Date.now(),
      idempotencyKey: 'cash-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    });

    res.status(200).json({
      ok: true,
      orderNumber: result.friendly_order_number || result.order_number || null
    });
  } catch (err) {
    console.error('Cash order creation failed:', err);
    res.status(502).json({ ok: false, error: 'Could not create the order in iBakePro.' });
  }
};
