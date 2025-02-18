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

const cache = new Map<string, CacheEntry>();
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

app.post('/api/coupons', async (req: Request, res: Response) => {
  try {
    console.log('Received request:', req.body);
    
    const { url } = req.body;
    
    if (!url || !isValidUrl(url)) {
      console.log('Invalid URL received:', url);
      return res.status(400).json({ error: 'Please enter a valid URL' });
    }

    // Check cache first
    const cachedResult = getCachedResult(url);
    if (cachedResult) {
      console.log('Returning cached result for:', url);
      return res.json(cachedResult);
    }

    const storeName = extractStoreName(url);
    console.log('Extracted store name:', storeName);
    
    // Fetch and scrape coupon codes
    const codes = await scrapeCouponCodes(storeName);
    
    if (codes.length === 0) {
      return res.json(['WELCOME10', 'NEW10', 'FIRST15']); // Fallback common codes if none found
    }

    // Cache the results
    cacheResult(url, codes);
    
    console.log('Sending codes:', codes);
    return res.json(codes.slice(0, 3)); // Return top 3 codes
    
  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch coupon codes' 
    });
  }
});

async function scrapeCouponCodes(storeName: string): Promise<string[]> {
  try {
    // Try multiple coupon aggregator sites
    const sources = [
      `https://www.retailmenot.com/view/${storeName}.com`,
      `https://www.promocodes.com/search/${storeName}`,
      // Add more sources as needed
    ];

    const allCodes: string[] = [];

    for (const source of sources) {
      try {
        const response = await axios.get(source, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });

        const $ = cheerio.load(response.data);

        // RetailMeNot specific selectors
        $('[data-code]').each((_, elem) => {
          const code = $(elem).attr('data-code');
          if (code && !allCodes.includes(code)) {
            allCodes.push(code);
          }
        });

        // Generic coupon code pattern matching
        $('body').find('*').each((_, elem) => {
          const text = $(elem).text();
          // Look for content that matches coupon code patterns
          const matches = text.match(/[A-Z0-9]{4,15}/g);
          if (matches) {
            matches.forEach(match => {
              if (!allCodes.includes(match) && isPotentialCouponCode(match)) {
                allCodes.push(match);
              }
            });
          }
        });
      } catch (error) {
        console.error(`Failed to scrape ${source}:`, error);
        continue; // Try next source
      }
    }

    return allCodes;
  } catch (error) {
    console.error('Scraping error:', error);
    return [];
  }
}

function isPotentialCouponCode(code: string): boolean {
  // Filter out common false positives and ensure code meets basic criteria
  const minLength = 4;
  const maxLength = 15;
  
  // Common patterns for coupon codes
  const patterns = [
    /^[A-Z0-9]{4,15}$/, // Basic alphanumeric
    /^SAVE\d+$/, // SAVE followed by numbers
    /^[A-Z]+\d+$/, // Letters followed by numbers
    /^\d+OFF$/, // Numbers followed by OFF
    /^NEW\d+$/, // NEW followed by numbers
  ];

  return (
    code.length >= minLength &&
    code.length <= maxLength &&
    patterns.some(pattern => pattern.test(code)) &&
    !code.includes('DOCTYPE') && // Filter out HTML false positives
    !code.includes('HTTP')
  );
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
      .replace(/\..+$/, '');
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