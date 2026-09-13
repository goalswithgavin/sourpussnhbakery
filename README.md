# SourPuss NH Bakery — website setup guide

This is a plain HTML/CSS/JS site (`index.html`) plus one small serverless
function (`api/create-checkout.js`) that connects the order builder to
Square for real payment. It's built to deploy straight from GitHub to
Vercel — no database, no traditional server to manage.

## 1. Get the code on GitHub (Gavin)

1. Create a new repository on GitHub (public or private, either works).
2. Add every file in this folder to it, keeping the same structure:
   - `index.html` — must stay named exactly `index.html` and stay at the
     root of the repo, so it loads at your domain's homepage.
   - `images/` — all the photos.
   - `api/create-checkout.js` — the Square function.
   - `README.md` — this file.
3. Commit and push.

## 2. Deploy on Vercel (Gavin)

1. Create a free account at vercel.com and sign in with GitHub.
2. Click **Add New > Project**, pick this repository, and click **Deploy**.
   Vercel auto-detects the static `index.html` and the `api/` folder — no
   configuration needed.
3. Vercel gives you a working URL like `your-project.vercel.app`. Confirm
   the site loads and the images show up.
4. Buy the domain (Namecheap, Porkbun, GoDaddy, wherever), then in the
   Vercel project go to **Settings > Domains**, add it, and follow Vercel's
   instructions for the DNS records to add at the registrar.
5. From now on, every time you push a change to the GitHub repo, Vercel
   redeploys automatically.

## 3. Set up Square (Elizabeth, with Gavin if she wants help)

1. Create a Square account at squareup.com if she doesn't already have one
   — the same account can also run her in-person card reader later if she
   wants one.
2. Go to the Square Developer Dashboard: developer.squareup.com/apps, and
   create an application (any name, e.g. "SourPuss Website").
3. Inside that application, grab two things:
   - **Access Token** (start with the **Sandbox** token for testing — it
     processes fake payments so nothing gets charged for real while you
     test the site)
   - **Location ID** (under the app's "Locations" tab)
4. In Vercel: **Settings > Environment Variables**, add:
   - `SQUARE_ACCESS_TOKEN` — the token from step 3
   - `SQUARE_LOCATION_ID` — the location ID from step 3
   - `SQUARE_ENV` — `sandbox` for now
   - `SITE_URL` — the site's Vercel or custom domain URL
5. Redeploy (Vercel > Deployments > … > Redeploy, or just push any small
   change to GitHub).
6. Test an order on the live site using Square's sandbox test card number
   `4111 1111 1111 1111`, any future expiration date, any CVV. Confirm the
   test order shows up in the Square **sandbox** dashboard.
7. When it all works, go back to the Developer Dashboard, switch to
   **Production**, copy the production Access Token and Location ID, and
   swap them into Vercel's environment variables (`SQUARE_ACCESS_TOKEN`,
   `SQUARE_LOCATION_ID`), and change `SQUARE_ENV` to `production`.
   Redeploy. The site now takes real payments.

**Security note:** the Access Token is a secret — it should only ever live
in Vercel's environment variables, never pasted into `index.html` or
committed to the GitHub repo.

## 4. Newsletter (Constant Contact) — already connected

Every "Join Our Email List" button/link on the site (nav bar, the
newsletter section, the footer — search `lp.constantcontactpages.com` in
`index.html` to find all of them) points straight to Elizabeth's live
Constant Contact sign-up page:

`https://lp.constantcontactpages.com/sl/ZP7lzVM`

That page is already hers — it's set up under "SourPuss NH Bakery" with
her address, and anyone who signs up through it lands directly in her
Constant Contact contacts list. Nothing else needs to be configured; it
just works once the site is deployed.

**If she ever creates a new sign-up page** (a redesign, a different list,
etc.), just replace that URL everywhere it appears — search
`lp.constantcontactpages.com` in `index.html` and swap in the new link in
each spot.

## 5. Order tracking in iBakePro — already wired up, needs three things

Every order placed on the site — whether paid by card through Square or
marked "Pay Cash at Pickup/Delivery" — gets created as a real order in
Elizabeth's iBakePro account, matched against her product catalog when the
names line up. Here's what has to be true for that to actually work:

1. **Products exist in iBakePro** with names that match the site's flavor
   names (Plain, Everything, Rosemary Garlic, etc.) — see `index.html`,
   search `var FLAVORS`, for the exact list. A flavor whose name doesn't
   match anything in her catalog still creates the order fine, just without
   the product link (no cost/inventory tracking for that line) — so close
   name matches are worth double-checking if orders look "unlinked" later.
2. **Environment variables in Vercel** (Settings → Environment Variables):
   - `IBAKEPRO_SECRET_KEY` — her secret key (`ibp_sk_...`), needs
     `orders:write` and `products:read`
   - `IBAKEPRO_REGION` — `us`, `au`, or `eu`, matching her account
3. **A Square webhook subscription**, so the site finds out when a card
   payment actually completes (this is separate from the checkout link
   itself, which only creates the payment page — it has no way of knowing
   whether someone actually paid). In the Square Developer Dashboard, open
   your app → **Webhooks** → create a subscription:
   - Notification URL: `https://<your-site>/api/square-webhook`
   - Events: `payment.updated`

   Do this once for **Sandbox** and once for **Production** — they're
   separate subscriptions with separate signature keys. Square shows a
   **Signature Key** for each one; copy the one for whichever environment
   matches your current `SQUARE_ENV`, and add it to Vercel as
   `SQUARE_WEBHOOK_SIGNATURE_KEY`. If you switch `SQUARE_ENV` between
   sandbox and production, swap this key to match, the same way you already
   swap `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID`.

**How it actually flows:**

- **Cash orders** call `/api/create-cash-order` directly when the customer
  clicks the button — it creates the iBakePro order immediately, marked
  unpaid (`payment_method: cash`), no Square involved at all.
- **Card orders** go through `/api/create-checkout` as before to get a
  Square checkout link. Once the customer actually pays, Square calls
  `/api/square-webhook`, which verifies the request really came from Square,
  looks up the full order, and creates the matching iBakePro order marked
  as paid.
- If the cash-order call fails for any reason (iBakePro not configured yet,
  a network hiccup), the site falls back to opening an email to Elizabeth
  with the order details, same as before this was wired up — so an order
  is never silently lost.

**Testing it:** place a real cash order and a real sandbox card order on the
live site, then check Elizabeth's iBakePro dashboard for both. If a card
order doesn't show up, check Vercel's function logs for `square-webhook` —
a `401` there almost always means `SQUARE_WEBHOOK_SIGNATURE_KEY` doesn't
match the environment (sandbox vs. production) currently active.

**Prices now flow the other direction too.** The site calls
`/api/products` on every page load, which reads her current iBakePro
prices and overrides whatever's hardcoded in `index.html` for any flavor
whose name matches a product there. So once a flavor's product exists in
iBakePro, **she changes the price in her iBakePro dashboard, and the
website picks it up automatically** — no code edit, no redeploy. If she
changes a price and the site doesn't reflect it, the two most likely
reasons are (1) the product's name in iBakePro doesn't exactly match the
flavor's name on the site, or (2) the browser cached the old price for a
minute (the endpoint caches responses for 60 seconds to avoid hammering
iBakePro on every visitor). A flavor with no matching product in iBakePro
just keeps using the site's built-in price, same as before this was wired
up.

## 6. Keeping it updated

- **Prices / flavors:** open `index.html`, search for `var FLAVORS`, and
  edit the `price` values or add/remove flavors there. Everything else
  (the order form, the menu grid, the checkout total) updates automatically
  from that one list.
- **Weekly specials:** search for `special-tags` in `index.html` and edit
  the flavor names listed there.
- **Reviews:** search for `yelp-review` in `index.html` to add or edit
  reviews in the Yelp-style box.
- **Photos:** add new files to the `images/` folder and reference them by
  filename in the `FLAVORS` list (the `photo` field) or wherever else in
  the HTML. Push to GitHub and Vercel redeploys automatically.

## 7. Optional upgrade: scheduled pickup/delivery in Square

Right now the fulfillment day, ready date, and customer's contact info are
attached to the order as a note, so Elizabeth sees them in the Square
dashboard alongside the payment. Square also supports a structured
`fulfillments` field on orders (pickup/delivery with real scheduled times)
which would let the order show up on a proper fulfillment schedule in
Square instead of just a note. That's a reasonable next step once the
basic flow is live and working — happy to help wire that up later.
