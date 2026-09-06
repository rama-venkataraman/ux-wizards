require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Stripe = require('stripe');

const {
  PRINTFUL_API_KEY,
  PRINTFUL_STORE_ID, // optional, only needed if your Printful token has access to multiple stores
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  DOMAIN, // e.g. http://localhost:3000 or your deployed https URL
  PORT
} = process.env;

if (!PRINTFUL_API_KEY) console.warn('⚠️  PRINTFUL_API_KEY is not set in .env');
if (!STRIPE_SECRET_KEY) console.warn('⚠️  STRIPE_SECRET_KEY is not set in .env');

const stripe = Stripe(STRIPE_SECRET_KEY || 'sk_test_placeholder');
const app = express();
const port = PORT || 3000;
const domain = DOMAIN || `http://localhost:${port}`;

app.use(cors());

// Stripe webhook needs the RAW body, so this route is defined
// BEFORE the global express.json() body parser below.
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event = req.body;

  if (STRIPE_WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('⚠️  Webhook signature verification failed.', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Only safe for local testing without a signing secret configured.
    try { event = JSON.parse(req.body); } catch (e) { /* already an object */ }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      await fulfillOrderWithPrintful(session.id);
    } catch (err) {
      console.error('Printful order creation failed:', err.response?.data || err.message);
      // Don't fail the webhook response to Stripe — payment already succeeded.
      // Log this somewhere you monitor and handle manually if needed.
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static('public'));

const printful = axios.create({
  baseURL: 'https://api.printful.com',
  headers: {
    Authorization: `Bearer ${PRINTFUL_API_KEY}`,
    ...(PRINTFUL_STORE_ID ? { 'X-PF-Store-Id': PRINTFUL_STORE_ID } : {})
  }
});

// ---- Products: list + variant detail from Printful ----
app.get('/api/products', async (req, res) => {
  try {
    const listRes = await printful.get('/store/products');
    const items = listRes.data.result || [];

    const detailed = await Promise.all(
      items.map(async (item) => {
        const detailRes = await printful.get(`/store/products/${item.id}`);
        const { sync_product, sync_variants } = detailRes.data.result;
        return {
          id: sync_product.id,
          name: sync_product.name,
          thumbnail: sync_product.thumbnail_url,
          variants: (sync_variants || []).map(v => ({
            id: v.id, // sync_variant_id, needed for Printful order + Stripe metadata
            name: v.name,
            retail_price: v.retail_price,
            currency: v.currency,
            image: (v.files || []).find(f => f.type === 'preview')?.preview_url || sync_product.thumbnail_url,
            in_stock: v.availability_status === 'active' || v.availability_status === undefined
          }))
        };
      })
    );

    res.json({ products: detailed });
  } catch (err) {
    console.error('Error fetching Printful products:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to load products from Printful' });
  }
});

// ---- Checkout: create a one-page Stripe Checkout Session for a single variant ----
app.post('/api/create-checkout-session', async (req, res) => {
  const { variantId, name, price, currency, image } = req.body;

  if (!variantId || !price || !name) {
    return res.status(400).json({ error: 'variantId, name and price are required' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: (currency || 'usd').toLowerCase(),
            product_data: {
              name,
              images: image ? [image] : []
            },
            unit_amount: Math.round(parseFloat(price) * 100)
          },
          quantity: 1
        }
      ],
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE']
      },
      // customer email is collected automatically by Checkout
      metadata: {
        sync_variant_id: String(variantId)
      },
      success_url: `${domain}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/store.html`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe session error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ---- Look up a completed session (used by success.html) ----
app.get('/api/session/:id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);
    res.json({
      status: session.payment_status,
      email: session.customer_details?.email,
      amount_total: session.amount_total,
      currency: session.currency
    });
  } catch (err) {
    res.status(404).json({ error: 'Session not found' });
  }
});

// ---- Places the real fulfillment order with Printful once Stripe payment succeeds ----
async function fulfillOrderWithPrintful(stripeSessionId) {
  const session = await stripe.checkout.sessions.retrieve(stripeSessionId, {
    expand: ['customer_details']
  });

  const syncVariantId = session.metadata?.sync_variant_id;
  if (!syncVariantId) throw new Error('No sync_variant_id on session metadata');

  const shipping = session.shipping_details || session.customer_details;
  const address = shipping?.address;
  if (!address) throw new Error('No shipping address on session');

  const orderPayload = {
    recipient: {
      name: shipping.name,
      address1: address.line1,
      address2: address.line2 || '',
      city: address.city,
      state_code: address.state,
      country_code: address.country,
      zip: address.postal_code,
      email: session.customer_details?.email
    },
    items: [
      { sync_variant_id: Number(syncVariantId), quantity: 1 }
    ],
    confirm: true // auto-submit for fulfillment; set to false to review orders manually in Printful first
  };

  const result = await printful.post('/orders', orderPayload);
  console.log('✅ Printful order created:', result.data.result.id);
  return result.data.result;
}

app.listen(port, () => {
  console.log(`Quickstore running at ${domain}`);
});
