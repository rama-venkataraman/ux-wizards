// ---- Tab switching ----
const tabButtons = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.tab-panel');

function activateTab(name) {
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  panels.forEach(p => p.classList.toggle('active', p.id === name));
  history.replaceState(null, '', name === 'store' ? '#store' : '#home');
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

// Support landing directly on #store (used by store.html redirect and Stripe cancel_url)
if (window.location.hash === '#store') activateTab('store');

// ---- Store: load products from Printful (via our backend) ----
const grid = document.getElementById('product-grid');
let productCache = [];

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to load products');

    productCache = data.products || [];

    if (productCache.length === 0) {
      grid.innerHTML = '<p class="empty-text">No products found in your Printful store yet.</p>';
      return;
    }

    grid.innerHTML = '';
    productCache.forEach(product => {
      const firstVariant = product.variants[0];
      const card = document.createElement('div');
      card.className = 'product-card';
      card.innerHTML = `
        <img src="${firstVariant?.image || product.thumbnail}" alt="${product.name}" />
        <h3>${product.name}</h3>
        <div class="price">${firstVariant ? formatPrice(firstVariant.retail_price, firstVariant.currency) : ''}</div>
      `;
      card.addEventListener('click', () => openModal(product));
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<p class="empty-text">Couldn't load products: ${err.message}. Check your Printful API key in the server .env file.</p>`;
  }
}

function formatPrice(amount, currency) {
  const num = parseFloat(amount);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'USD').toUpperCase() }).format(num);
}

// ---- Quick popup / one-page checkout ----
const backdrop = document.getElementById('modal-backdrop');
const modalImage = document.getElementById('modal-image');
const modalName = document.getElementById('modal-name');
const variantSelect = document.getElementById('variant-select');
const modalPrice = document.getElementById('modal-price');
const checkoutBtn = document.getElementById('checkout-btn');
const modalError = document.getElementById('modal-error');
const modalClose = document.getElementById('modal-close');

let activeProduct = null;

function openModal(product) {
  activeProduct = product;
  modalError.textContent = '';
  modalName.textContent = product.name;

  variantSelect.innerHTML = '';
  product.variants.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.name} — ${formatPrice(v.retail_price, v.currency)}`;
    if (!v.in_stock) {
      opt.textContent += ' (out of stock)';
      opt.disabled = true;
    }
    variantSelect.appendChild(opt);
  });

  updateModalForSelection();
  backdrop.classList.remove('hidden');
}

function updateModalForSelection() {
  const variant = activeProduct.variants.find(v => String(v.id) === variantSelect.value) || activeProduct.variants[0];
  modalImage.src = variant.image || activeProduct.thumbnail;
  modalPrice.textContent = formatPrice(variant.retail_price, variant.currency);
}

variantSelect.addEventListener('change', updateModalForSelection);

function closeModal() {
  backdrop.classList.add('hidden');
  activeProduct = null;
}

modalClose.addEventListener('click', closeModal);
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

checkoutBtn.addEventListener('click', async () => {
  const variant = activeProduct.variants.find(v => String(v.id) === variantSelect.value);
  if (!variant) return;

  checkoutBtn.disabled = true;
  checkoutBtn.textContent = 'Redirecting to checkout…';
  modalError.textContent = '';

  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variantId: variant.id,
        name: `${activeProduct.name} — ${variant.name}`,
        price: variant.retail_price,
        currency: variant.currency,
        image: variant.image
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout failed');
    window.location.href = data.url; // Stripe-hosted one-page checkout
  } catch (err) {
    modalError.textContent = err.message;
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = 'Checkout';
  }
});

loadProducts();
