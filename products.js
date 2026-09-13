// api/products.js
//
// Called by the website itself (index.html) on page load. Returns her
// current iBakePro prices so the order builder shows what she's actually
// charging right now, instead of whatever price was hardcoded into the
// site the last time someone edited it.
//
// This is read-only and safe to call from the browser — it never exposes
// the IBAKEPRO_SECRET_KEY itself, only the product names/prices that key
// is used to fetch server-side.

const ibakepro = require('./lib/ibakepro');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  try {
    const prices = await ibakepro.listProductPrices();
    // Light caching: if a lot of people load the site back-to-back, this
    // avoids hitting iBakePro on every single page load.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ prices });
  } catch (err) {
    console.error('Products fetch failed:', err);
    // Fail soft — the site falls back to its own built-in prices when this
    // is empty or errors out, so a hiccup here never breaks ordering.
    res.status(200).json({ prices: [] });
  }
};
