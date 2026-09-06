# Quickstore

A tiny two-tab site:

- **Home** — intentionally blank, ready for you to fill in
- **Store** — pulls your real products from **Printful**, and lets a customer buy in one click through a popup with a full one-page **Stripe Checkout**. When payment succeeds, the order is automatically sent to Printful for fulfillment.

Because Printful and Stripe both require secret API keys, this needs a very small backend (included) to keep those keys off the browser. It's plain Node/Express — no framework lock-in.

## 1. Install

```bash
cd quickstore
npm install
```

## 2. Configure your keys

```bash
cp .env.example .env
```

Then fill in `.env`:

| Variable | Where to get it |
|---|---|
| `PRINTFUL_API_KEY` | Printful dashboard → **Settings → Stores → API** (create a Private Token) |
| `PRINTFUL_STORE_ID` | Only needed if your token can see multiple stores — leave blank otherwise |
| `STRIPE_SECRET_KEY` | Stripe dashboard → **Developers → API keys** — start with the **test** secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | See step 4 below |
| `DOMAIN` | `http://localhost:3000` while testing locally |

You need at least one product already created in **Printful → Store → Products** for anything to show up.

## 3. Run it

```bash
npm start
```

Visit `http://localhost:3000`. Home is blank; click **Store** to see your Printful catalog. Clicking a product opens the quick popup — pick a variant and hit **Checkout** to land on Stripe's hosted one-page checkout (card + shipping address in one step).

## 4. Wire up the webhook (this is what actually places the Printful order)

Stripe needs to tell your server when a payment completes. Locally, use the [Stripe CLI](https://docs.stripe.com/stripe-cli):

```bash
stripe listen --forward-to localhost:3000/api/webhook
```

It will print a `whsec_...` value — put that in `.env` as `STRIPE_WEBHOOK_SECRET` and restart `npm start`.

In production, instead add a webhook endpoint in the Stripe dashboard (**Developers → Webhooks → Add endpoint**) pointing at:

```
https://yourdomain.com/api/webhook
```

listening for the `checkout.session.completed` event, then copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

## 5. Test a full order

Use Stripe's test card `4242 4242 4242 4242`, any future expiry, any CVC, and a real-looking shipping address. After payment:

- You'll land on a confirmation page
- Your server console will log `✅ Printful order created: <id>`
- The order will appear in Printful under **Store → Orders**

`confirm: true` is set in `server.js`'s `fulfillOrderWithPrintful` function, meaning orders auto-submit for production. Change it to `false` if you'd rather manually approve each order inside Printful before it prints.

## 6. Go live

- Swap in your **live** Stripe keys (`sk_live_...`) once you're ready to accept real payments
- Set `DOMAIN` to your real https URL
- Re-create the webhook endpoint in Stripe's **live mode** dashboard (test and live webhooks are separate)

## Project structure

```
quickstore/
  server.js            Express backend: Printful proxy, Stripe Checkout + webhook
  public/
    index.html          Home + Store tabs
    store.html           Redirects into the Store tab (used as Stripe's cancel URL)
    success.html          Order confirmation page (Stripe's success URL)
    style.css            All styling, including the popup checkout modal
    app.js                Tab switching, product rendering, popup + checkout logic
  .env.example
  package.json
```
