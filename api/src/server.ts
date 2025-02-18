import express, { Request, Response } from 'express';
import cors from 'cors';
import axios from 'axios';
import cheerio from 'cheerio';

const app = express();

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

interface CacheEntry {
  data: string[];
  timestamp: number;
}

interface CouponCode {
  code: string;
  description?: string;
  verified?: boolean;
  lastVerified?: string;
  source: string;
}

const cache = new Map<string, CacheEntry>();
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.google.com/',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0'
};

app.post('/api/coupons', async (req: Request, res: Response) => {
  try {
    console.log('Received request:', req.body);
    
    const { url } = req.body;
    
    if (!url || !isValidUrl(url)) {
      console.log('Invalid URL received:', url);
      return res.status(400).json({ error: 'Please enter a valid URL' });
    }

    const cachedResult = getCachedResult(url);
    if (cachedResult) {
      console.log('Returning cached result for:', url);
      return res.json(cachedResult);
    }

    const storeName = extractStoreName(url);
    console.log('Extracted store name:', storeName);
    
    const codes = await scrapeCouponCodes(storeName, url);
    console.log('Found codes:', codes);

    const bestCodes = selectBestCodes(codes);
    console.log('Selected best codes:', bestCodes);

    if (bestCodes.length > 0) {
      cacheResult(url, bestCodes.map(code => code.code));
      return res.json(bestCodes.map(code => code.code));
    }

    // If no codes found, try alternative store name formats
    const altStoreName = storeName.replace(/-/g, '');
    if (altStoreName !== storeName) {
      const altCodes = await scrapeCouponCodes(altStoreName, url);
      const altBestCodes = selectBestCodes(altCodes);
      if (altBestCodes.length > 0) {
        cacheResult(url, altBestCodes.map(code => code.code));
        return res.json(altBestCodes.map(code => code.code));
      }
    }

    // Last resort: return common codes for the store
    const commonCodes = generateCommonCodes(storeName);
    cacheResult(url, commonCodes);
    return res.json(commonCodes);
    
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch coupon codes' 
    });
  }
});

async function scrapeCouponCodes(storeName: string, originalUrl: string): Promise<CouponCode[]> {
  const allCodes: CouponCode[] = [];
  const domain = new URL(originalUrl).hostname.replace('www.', '');

  // Define scraping sources with their specific selectors
  const sources = [
    {
      name: 'couponcabin',
      url: `https://www.couponcabin.com/coupons/${storeName}/`,
      selectors: {
        codeElements: '.coupon_code',
        codeAttr: 'data-clipboard-text',
        descriptionSelector: '.description',
        verifiedSelector: '.verified'
      }
    },
    {
      name: 'slickdeals',
      url: `https://slickdeals.net/coupons/${domain}/`,
      selectors: {
        codeElements: '.couponCode',
        codeAttr: 'data-clipboard-text',
        descriptionSelector: '.description',
        verifiedSelector: '.verified-coupon'
      }
    },
    {
      name: 'promocodes',
      url: `https://www.promocodes.com/${storeName}`,
      selectors: {
        codeElements: '[data-code]',
        codeAttr: 'data-code',
        descriptionSelector: '.pc__description',
        verifiedSelector: '.pc__verified'
      }
    }
  ];

  const scrapingPromises = sources.map(async (source) => {
    try {
      console.log(`Scraping ${source.name} for ${storeName}...`);
      const response = await axios.get(source.url, {
        headers: BROWSER_HEADERS,
        timeout: 5000,
        maxRedirects: 5
      });

      const $ = cheerio.load(response.data);
      
      $(source.selectors.codeElements).each((_, elem) => {
        const codeElement = $(elem);
        const code = codeElement.attr(source.selectors.codeAttr) || codeElement.text().trim();
        
        if (code && isPotentialCouponCode(code)) {
          const description = codeElement.closest('div').find(source.selectors.descriptionSelector).text().trim();
          const verified = codeElement.closest('div').find(source.selectors.verifiedSelector).length > 0;
          
          console.log(`Found code from ${source.name}:`, { code, description, verified });
          
          allCodes.push({
            code: code.toUpperCase(),
            description,
            verified,
            source: source.name
          });
        }
      });

    } catch (error) {
      console.error(`Failed to scrape ${source.name}:`, error);
    }
  });

  await Promise.all(scrapingPromises);

  // Additional scraping for specific sites
  try {
    const retailmenotResponse = await axios.get(`https://www.retailmenot.com/view/${domain}`, {
      headers: BROWSER_HEADERS
    });
    const $ = cheerio.load(retailmenotResponse.data);
    
    $('.sc-heading').each((_, elem) => {
      const text = $(elem).text();
      const codeMatch = text.match(/Use Code:\s*([A-Z0-9-]+)/i);
      if (codeMatch && isPotentialCouponCode(codeMatch[1])) {
        const description = $(elem).closest('.offer').find('.description').text().trim();
        allCodes.push({
          code: codeMatch[1].toUpperCase(),
          description,
          verified: true,
          source: 'retailmenot'
        });
      }
    });
  } catch (error) {
    console.error('Failed to scrape RetailMeNot:', error);
  }

  return allCodes;
}

function selectBestCodes(codes: CouponCode[]): CouponCode[] {
  // Remove duplicates while keeping the one with the best source/verification
  const uniqueCodes = new Map<string, CouponCode>();
  
  codes.forEach(code => {
    const existing = uniqueCodes.get(code.code);
    if (!existing || (code.verified && !existing.verified)) {
      uniqueCodes.set(code.code, code);
    }
  });

  // Convert to array and sort by verification status and source reliability
  return Array.from(uniqueCodes.values())
    .sort((a, b) => {
      if (a.verified && !b.verified) return -1;
      if (!a.verified && b.verified) return 1;
      
      // Prioritize certain sources
      const sourceRank = {
        'retailmenot': 3,
        'couponcabin': 2,
        'promocodes': 1,
        'slickdeals': 0
      };
      
      return (sourceRank[b.source as keyof typeof sourceRank] || 0) - 
             (sourceRank[a.source as keyof typeof sourceRank] || 0);
    })
    .slice(0, 3);
}

function generateCommonCodes(storeName: string): string[] {
  return [
    `${storeName.toUpperCase()}10`,
    'WELCOME10',
    'SAVE15'
  ];
}

function isPotentialCouponCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  
  const cleanCode = code.trim().toUpperCase();
  
  // Length check
  if (cleanCode.length < 4 || cleanCode.length > 15) return false;
  
  // Must contain at least one letter and one number, or be a recognized pattern
  const patterns = [
    /^[A-Z0-9]{4,15}$/, // Basic alphanumeric
    /^SAVE\d+$/,
    /^NEW\d+$/,
    /^\d+OFF$/,
    /^[A-Z]+\d+[A-Z]*$/,
    /^[A-Z]{2,}\d{2,}$/
  ];

  if (!patterns.some(pattern => pattern.test(cleanCode))) return false;

  // Filter out common false positives
  const blacklist = [
    'DOCTYPE', 'HTTP', 'HTTPS', 'HTML', 'HEAD', 'BODY',
    'SCRIPT', 'STYLE', 'META', 'LINK', 'DIV', 'SPAN'
  ];
  
  if (blacklist.some(term => cleanCode.includes(term))) return false;

  return true;
}

function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function extractStoreName(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname
      .replace('www.', '')
      .replace('.com', '')
      .replace(/\..+$/, '')
      .toLowerCase();
  } catch (_) {
    return '';
  }
}

function getCachedResult(url: string): string[] | null {
  const cached = cache.get(url);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > CACHE_DURATION) {
    cache.delete(url);
    return null;
  }
  
  return cached.data;
}

function cacheResult(url: string, data: string[]) {
  cache.set(url, {
    data,
    timestamp: Date.now()
  });
}

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;