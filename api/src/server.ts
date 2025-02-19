import express from 'express';
import cors from 'cors';
import * as puppeteer from 'puppeteer';

const app = express();
app.use(cors());
app.use(express.json());

interface CouponData {
  code: string;
  description: string;
  expiry?: string;
}

async function initializeBrowser(): Promise<puppeteer.Browser> {
  return await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
}

async function initializePage(browser: puppeteer.Browser): Promise<puppeteer.Page> {
  const page = await browser.newPage();
  page.on('console', msg => console.log('Browser console:', msg.text()));
  await page.setViewport({ width: 1366, height: 768 });
  await page.setRequestInterception(true);
  page.on('request', (request: puppeteer.HTTPRequest) => {
    if (['image', 'font'].includes(request.resourceType())) {
      request.abort();
    } else {
      request.continue();
    }
  });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
  return page;
}

async function extractCodeFromPopup(page: puppeteer.Page): Promise<string | null> {
  try {
    await page.waitForSelector('[data-testid="voucherPopup-codeHolder-voucherType-code"] h4', {
      timeout: 5000,
      visible: true
    });
    const code = await page.$eval(
      '[data-testid="voucherPopup-codeHolder-voucherType-code"] h4.b8qpi79',
      (element: Element) => element.textContent
    );
    return code?.trim() || null;
  } catch (error) {
    console.error('Error extracting code from popup:', error);
    return null;
  }
}

async function handleVoucherCard(page: puppeteer.Page, card: puppeteer.ElementHandle, browser: puppeteer.Browser): Promise<CouponData | null> {
  try {
    const description = await card.$eval('h3', (element: Element) => element.textContent || '').catch(() => 'Unknown description');
    const cardHtml = await card.evaluate((el: Element) => el.outerHTML);
    console.log(`Card HTML: ${cardHtml.substring(0, 200)}...`);

    const isCouponCode = await card.$eval(
      '[data-element="voucher-card-labels"] div',
      (element: Element) => element.textContent?.includes('Code') || false
    ).catch(() => false);

    console.log(`Card "${description}" - isCouponCode: ${isCouponCode}`);
    if (!isCouponCode) {
      console.log(`Card "${description}" is not a coupon code, skipping`);
      return null;
    }

    const seeButton = await card.$('div[title="See coupon"]');
    if (!seeButton) {
      console.log(`No "See coupon" button found for "${description}", skipping`);
      return null;
    }

    const newPagePromise = new Promise<puppeteer.Page>(resolve => {
      browser.on('targetcreated', async (target: puppeteer.Target) => {
        if (target.type() === 'page') {
          const newPage = await target.page();
          if (newPage) resolve(newPage);
        }
      });
    });

    await seeButton.click();
    const popupPage = await newPagePromise;
    await popupPage.bringToFront();

    const code = await extractCodeFromPopup(popupPage);
    if (!code) {
      await popupPage.close();
      return null;
    }

    const expiry = await card.$eval('span:contains("Expires")', (element: Element) => element.textContent)
      .then((textContent: string | null) => textContent?.replace('Expires:', '').trim())
      .catch(() => undefined);

    await popupPage.close();
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log(`Successfully extracted code "${code}" for "${description}"`);
    return { code, description, expiry };
  } catch (error) {
    console.error('Error processing voucher card:', error);
    return null;
  }
}

async function scrapeCoupons(storeUrl: string): Promise<CouponData[]> {
  const browser = await initializeBrowser();
  try {
    const page = await initializePage(browser);
    const storeName = new URL(storeUrl).hostname.replace('www.', '').split('.')[0].toLowerCase().replace(/(clothing|shop|store|online)/g, '');
    const couponsUrl = `https://www.coupons.com/coupon-codes/${storeName}`;
    console.log(`Navigating to ${couponsUrl}`);
    
    await page.goto(couponsUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    try {
      await page.waitForSelector('[data-testid="vouchers-ui-voucher-card"]', { timeout: 20000 });
    } catch (error) {
      console.error('Voucher cards not found, attempting fallback scrape');
      const fallbackCodes = await page.$$eval('h3, span, div', elements =>
        elements
          .map(el => el.textContent?.trim())
          .filter(text => text && /^[A-Z0-9-]{4,15}$/.test(text))
          .map(text => ({ code: text as string, description: 'Fallback code', expiry: undefined }))
      );
      if (fallbackCodes.length > 0) return fallbackCodes.slice(0, 3);
      throw error;
    }

    const cards = await page.$$('[data-testid="vouchers-ui-voucher-card"]');
    console.log(`Found ${cards.length} voucher cards`);
    
    const coupons: CouponData[] = [];
    for (const card of cards.slice(0, 5)) {
      const couponData = await handleVoucherCard(page, card, browser);
      if (couponData && couponData.code) {
        coupons.push(couponData);
      }
      if (coupons.length >= 3) break;
    }

    console.log(`Collected ${coupons.length} coupons`);
    return coupons;
  } catch (error) {
    console.error('Scraping error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

app.get('/', (req: express.Request, res: express.Response) => {
  res.json({ message: 'Cotrix API is live! Use POST /api/coupons with { "url": "https://store.com" }' });
});

app.post('/api/coupons', async (req: express.Request, res: express.Response) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const coupons = await scrapeCoupons(url);
    if (coupons.length === 0) {
      console.log('No valid coupon codes found, returning empty array');
      return res.json([]);
    }
    const codes = coupons.map(coupon => coupon.code);
    console.log('Returning codes to client:', codes);
    res.json(codes);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Failed to scrape coupon codes' });
  }
});

export default app;

const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}