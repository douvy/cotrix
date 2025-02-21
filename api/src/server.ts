import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as puppeteerCore from 'puppeteer-core';
import * as puppeteer from 'puppeteer';

// Type can be either browser type since they share the same interface
type Browser = puppeteer.Browser | puppeteerCore.Browser;

interface ExtractedCouponData {
  code: string;
  description: string;
  expiry?: string;
  source: 'coupons.com' | 'couponfollow.com';
  isVerified: boolean;
  discountPercent: number;
}

async function initializeBrowser(): Promise<puppeteer.Browser> {
  try {
    console.log('Connecting to browserless...');
    if (!process.env.BLESS_TOKEN) {
      throw new Error('BLESS_TOKEN environment variable is not set');
    }
    
    const browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BLESS_TOKEN}&timeout=30000`,
      defaultViewport: { width: 1366, height: 768 }
    });
    console.log('Connected to browserless successfully');
    return browser;
  } catch (error) {
    console.error('Failed to connect to browserless:', error);
    throw error;
  }
}

async function initializePage(browser: puppeteer.Browser): Promise<puppeteer.Page> {
  try {
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('Browser console:', msg.text()));
    page.on('error', err => console.error('Page error:', err));
    page.on('pageerror', err => console.error('Page error:', err));
    
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      try {
        if (['image', 'font', 'stylesheet'].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      } catch (error) {
        console.error('Error in request interception:', error);
        request.continue();
      }
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    return page;
  } catch (error) {
    console.error('Error initializing page:', error);
    throw error;
  }
}

async function extractCodeFromPopup(page: puppeteer.Page): Promise<string | null> {
  try {
    console.log('Waiting for code popup');
    await page.waitForSelector('[data-testid="voucherPopup-codeHolder-voucherType-code"] h4', {
      timeout: 5000,
      visible: true
    });
    const code = await page.$eval(
      '[data-testid="voucherPopup-codeHolder-voucherType-code"] h4.b8qpi79',
      (element: Element) => element.textContent
    );
    console.log('Code extracted:', code);
    return code?.trim() || null;
  } catch (error) {
    console.error('Error extracting code from popup:', error);
    return null;
  }
}

async function handleVoucherCard(page: puppeteer.Page, card: puppeteer.ElementHandle<Element>, browser: puppeteer.Browser): Promise<ExtractedCouponData | null> {
  try {
    const cardData = await card.evaluate((el: Element) => {
      const description = el.querySelector('h3')?.textContent || 'Unknown description';
      const insights = el.querySelector('[data-element="voucher-card-labels"] div')?.textContent || '';
      const isCouponCode = insights.includes('Code');
      
      return {
        description,
        isCouponCode,
        html: el.outerHTML
      };
    });

    if (!cardData.isCouponCode) {
      return null;
    }

    const seeButton = await card.$('div[title="See coupon"]');
    if (!seeButton) {
      return null;
    }

    const newPagePromise = new Promise<puppeteer.Page>(resolve => {
      browser.once('targetcreated', async (target) => {
        const newPage = await target.page();
        if (newPage) resolve(newPage);
      });
    });

    await seeButton.click();
    const popupPage = await newPagePromise;
    await popupPage.bringToFront();

    const code = await extractCodeFromPopup(popupPage);
    await popupPage.close();

    if (!code) {
      return null;
    }

    const discountMatch = cardData.description.match(/(\d+)%/);
    const discountPercent = discountMatch ? parseInt(discountMatch[1]) : 0;
    const isVerified = cardData.description.toLowerCase().includes('verified');

    return {
      code,
      description: cardData.description,
      source: 'coupons.com',
      isVerified,
      discountPercent
    };
  } catch (error) {
    console.error('Error processing voucher card:', error);
    return null;
  }
}

async function scrapeCouponsDotCom(storeUrl: string, browser: puppeteer.Browser): Promise<ExtractedCouponData | null> {
  const page = await initializePage(browser);
  try {
    const storeName = new URL(storeUrl).hostname
      .replace('www.', '')
      .split('.')[0]
      .toLowerCase()
      .replace(/(clothing|shop|store|online)/g, '');
    const couponsUrl = `https://www.coupons.com/coupon-codes/${storeName}`;
    
    await page.goto(couponsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    try {
      await page.waitForSelector('[data-testid="vouchers-ui-voucher-card"]', { timeout: 10000 });

      const cardElements = await page.$$('[data-testid="vouchers-ui-voucher-card"]');
      if (!cardElements || cardElements.length === 0) {
        console.log('No voucher cards found on Coupons.com');
        return null;
      }
      
      console.log(`Found ${cardElements.length} voucher cards on Coupons.com`);

      for (let i = 0; i < cardElements.length; i++) {
        const couponData = await handleVoucherCard(page, cardElements[i], browser);
        if (couponData) return couponData;
      }

      return null;
    } catch (error) {
      console.log('No valid voucher cards found on Coupons.com');
      return null;
    }

  } catch (error) {
    console.error('Error scraping Coupons.com:', error);
    return null;
  } finally {
    await page.close();
  }
}

async function scrapeCouponFollow(storeUrl: string, browser: puppeteer.Browser): Promise<ExtractedCouponData | null> {
  const page = await initializePage(browser);
  try {
    const storeName = new URL(storeUrl).hostname.replace('www.', '').split('.')[0];
    const url = `https://couponfollow.com/site/${storeName}.com`;
    
    console.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for offers to load
    await page.waitForSelector('.offer-card.regular-offer', { timeout: 10000 });
    
    const offers = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.offer-card.regular-offer'));
      return cards.map(card => {
        const codeElement = card.querySelector<HTMLElement>('.code');
        const code = codeElement?.dataset?.code || codeElement?.textContent?.trim();
        const description = card.querySelector('h3')?.textContent?.trim() || '';
        const verified = Boolean(card.querySelector('.insights')?.textContent?.includes('Verified'));
        const discountMatch = description.match(/(\d+)%/);
        const discount = discountMatch ? parseInt(discountMatch[1]) : 0;

        return {
          code,
          description,
          verified,
          discount
        };
      });
    });

    // Filter valid offers and sort by verification status and discount amount
    const validOffers = offers
      .filter(offer => offer.code && offer.discount > 0)
      .sort((a, b) => {
        if (a.verified !== b.verified) return b.verified ? 1 : -1;
        return b.discount - a.discount;
      });

    const bestOffer = validOffers[0];
    if (bestOffer?.code) {
      return {
        code: bestOffer.code,
        description: bestOffer.description,
        source: 'couponfollow.com',
        isVerified: bestOffer.verified,
        discountPercent: bestOffer.discount
      };
    }

    return null;
  } catch (error) {
    console.error('Error scraping CouponFollow:', error);
    return null;
  } finally {
    await page.close();
  }
}

async function scrapeCoupons(storeUrl: string): Promise<ExtractedCouponData[]> {
  let browser;
  try {
    console.log('Starting coupon scrape for URL:', storeUrl);
    browser = await initializeBrowser();
    
    // Try both sources and collect valid coupons
    const [couponsComCode, couponFollowCode] = await Promise.all([
      scrapeCouponsDotCom(storeUrl, browser),
      scrapeCouponFollow(storeUrl, browser)
    ]);

    const validCoupons = [couponsComCode, couponFollowCode]
      .filter((code): code is ExtractedCouponData => Boolean(code))
      .sort((a, b) => {
        if (a.isVerified !== b.isVerified) return b.isVerified ? 1 : -1;
        return b.discountPercent - a.discountPercent;
      });

    console.log(`Successfully collected ${validCoupons.length} coupons:`, validCoupons);
    return validCoupons;
  } catch (error) {
    console.error('Fatal scraping error:', error);
    return [];
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed successfully');
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }
  }
}

const app = express();
app.use(cors());
app.use(express.json());

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
  } catch (error: any) {
    console.error('Error processing request:', error);
    console.error('Error details:', {
      message: error?.message || 'Unknown error',
      stack: error?.stack || 'No stack trace',
      name: error?.name || 'Unknown error type'
    });
    res.status(500).json({ 
      error: 'Failed to scrape coupon codes', 
      details: error?.message || 'Unknown error' 
    });
  }
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;