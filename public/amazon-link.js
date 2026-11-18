/* Amazon.in link parsing, Creators API item shaping, and product-page reading.
   Loaded as a plain script in the browser, and exported for Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AmazonLink = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
  const NAME_LIMIT = 60;

  function isAmazonHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'amazon.in' || host.endsWith('.amazon.in');
  }

  function asinFromPath(pathname) {
    const match = String(pathname || '').match(
      /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([a-z0-9]{10})(?:[/?]|$)/i,
    );
    return match ? match[1].toUpperCase() : '';
  }

  // Accept the common amazon.in product URL shapes and return the ASIN, or
  // null when the link is not an amazon.in product page.
  function parseAmazonLink(value) {
    let url;
    try {
      url = new URL(String(value || '').trim());
    } catch {
      return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!isAmazonHost(url.hostname)) return null;

    const fromPath = asinFromPath(url.pathname);
    const fromQuery = (url.searchParams.get('asin') || '').toUpperCase();
    const asin = ASIN_PATTERN.test(fromPath)
      ? fromPath
      : ASIN_PATTERN.test(fromQuery)
        ? fromQuery
        : '';
    if (!asin) return null;

    return { asin, url: url.toString() };
  }

  // Fit an Amazon title into the Shop name limit, cutting on a word boundary.
  function shortItemName(title, maxLength = NAME_LIMIT) {
    const limit = Math.max(1, Math.floor(Number(maxLength) || NAME_LIMIT));
    const clean = String(title || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;

    const clipped = clean.slice(0, limit - 1);
    const boundary = clipped.lastIndexOf(' ');
    const body = boundary > Math.floor(limit / 2) ? clipped.slice(0, boundary) : clipped;
    return `${body.trimEnd()}…`;
  }

  // Prices arrive as numbers or display strings such as "₹1,299.00".
  function priceToCost(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw =
      typeof value === 'number' ? String(value) : String(value).replace(/[^0-9.,-]/g, '');
    const amount = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const cost = Math.round(amount);
    return cost >= 1 ? cost : null;
  }

  function httpUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
  }

  function primaryImage(images) {
    const primary = images && images.primary;
    if (!primary) return '';
    for (const size of ['large', 'medium', 'small']) {
      const url = httpUrl(primary[size] && primary[size].url);
      if (url) return url;
    }
    return '';
  }

  function listingPrice(listing) {
    return listing && listing.price && listing.price.money ? listing.price.money : null;
  }

  // Prefer the Buy Box listing, then the first listing that has a price.
  function bestListing(listings) {
    if (!Array.isArray(listings) || listings.length === 0) return null;
    return (
      listings.find((listing) => listing && listing.isBuyBoxWinner === true && listingPrice(listing)) ||
      listings.find((listing) => listing && listingPrice(listing)) ||
      listings[0] ||
      null
    );
  }

  // Turn a Creators API GetItems response into the small shape the Shop form
  // needs. Returns null when Amazon did not include a usable item.
  function shapeAmazonItem(payload) {
    const items = payload && payload.itemsResult && payload.itemsResult.items;
    const item = Array.isArray(items) ? items[0] : null;
    if (!item) return null;

    const title = item.itemInfo && item.itemInfo.title && item.itemInfo.title.displayValue;
    const name = shortItemName(title);
    if (!name) return null;

    const money = listingPrice(bestListing(item.offersV2 && item.offersV2.listings));
    const amount = money ? (money.amount !== undefined ? money.amount : money.displayAmount) : null;
    const numericAmount = Number(amount);

    return {
      asin: typeof item.asin === 'string' ? item.asin.toUpperCase() : '',
      name,
      cost: priceToCost(amount),
      image: primaryImage(item.images),
      price: money
        ? {
            amount: Number.isFinite(numericAmount) ? numericAmount : null,
            currency: typeof money.currency === 'string' ? money.currency : '',
            display: typeof money.displayAmount === 'string' ? money.displayAmount : '',
          }
        : null,
      detailPageURL: httpUrl(item.detailPageURL),
    };
  }

  /* ---------- product page reading ---------- */

  // Amazon.in product pages carry no Open Graph tags, so the fallback lookup
  // reads the same markup a browser would render. Everything here is
  // best-effort: a missing field is left for the user to fill in.
  function decodeEntities(value) {
    return String(value || '')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function plainText(value) {
    return decodeEntities(String(value || '').replace(/<[^>]*>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Amazon answers automated requests with a bot check instead of the page.
  function isAmazonBlockPage(html) {
    const text = String(html || '');
    return (
      /Enter the characters you see below/i.test(text) ||
      /api-services-support@amazon\.com/i.test(text) ||
      /<title>\s*Robot Check/i.test(text)
    );
  }

  function pageImage(html) {
    const text = String(html || '');
    const tag = text.match(/<img[^>]*\bid="landingImage"[^>]*>/i);
    if (tag) {
      const hires = tag[0].match(/data-old-hires="([^"]+)"/i);
      if (hires) return httpUrl(decodeEntities(hires[1]));
      const src = tag[0].match(/\bsrc="([^"]+)"/i);
      if (src) return httpUrl(decodeEntities(src[1]));
    }

    const dynamic = text.match(/data-a-dynamic-image="([^"]+)"/i);
    if (dynamic) {
      const first = decodeEntities(dynamic[1]).match(/"(https?:\/\/[^"]+)"/);
      if (first) return httpUrl(first[1]);
    }

    const hires = text.match(/data-old-hires="([^"]+)"/i);
    return hires ? httpUrl(decodeEntities(hires[1])) : '';
  }

  function pagePrice(html) {
    const text = String(html || '');
    const offscreen = text.match(/class="a-offscreen">\s*(₹\s?[\d.,]+)\s*</);
    if (offscreen) return offscreen[1].replace(/\s+/g, ' ').trim();

    const whole = text.match(/class="a-price-whole">\s*([\d,]+)/);
    if (!whole) return '';
    const fraction = text.match(/class="a-price-fraction">\s*(\d{1,2})/);
    return fraction ? `${whole[1]}.${fraction[1]}` : whole[1];
  }

  function amountOf(display) {
    const amount = Number(String(display || '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  // Turn an amazon.in product page into the shape the Shop form fills from.
  // Returns null when the markup has no product title, so the caller can tell
  // a product page apart from a bot check or an unrelated page.
  function parseAmazonPage(html) {
    const text = String(html || '');
    const titleTag = text.match(/id="productTitle"[^>]*>([\s\S]*?)<\/span>/i);
    const name = shortItemName(plainText(titleTag ? titleTag[1] : ''));
    if (!name) return null;

    const display = pagePrice(text);
    return {
      asin: '',
      name,
      cost: priceToCost(display),
      image: pageImage(text),
      price: display ? { amount: amountOf(display), currency: 'INR', display } : null,
      detailPageURL: '',
    };
  }

  return {
    parseAmazonLink,
    shortItemName,
    priceToCost,
    shapeAmazonItem,
    parseAmazonPage,
    isAmazonBlockPage,
  };
});
