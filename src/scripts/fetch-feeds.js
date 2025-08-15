#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiting configuration - ultra-conservative for Substack
const RATE_LIMIT = {
  // Domain-based rate limiting (key feature)
  minDelayBetweenDomainRequests: 15 * 60 * 1000, // 15 minutes between requests to same domain
  
  // General rate limiting
  batchSize: 1, // Process only 1 feed at a time (no batching)
  delayBetweenRequests: 45000, // 45 seconds between any requests
  retryAttempts: 2, // Keep at 2 to avoid timeout
  retryDelay: 30000, // 30 seconds base retry delay
  
  // Substack-specific delays (ultra-conservative)
  substackDelayMin: 8 * 60 * 1000, // Minimum 8 minutes between Substack requests
  substackDelayMax: 12 * 60 * 1000, // Maximum 12 minutes (randomized)
  substackMinDomainDelay: 20 * 60 * 1000, // 20 minutes minimum between same Substack domain
  
  // Global Substack rate limiting (new feature)
  lastSubstackRequest: 0, // Track last Substack request globally
  globalSubstackDelay: 10 * 60 * 1000, // 10 minutes between ANY Substack requests
  
  // Exponential backoff for rate limit errors
  rateLimitBackoffBase: 2 * 60 * 1000, // Start with 2 minutes
  rateLimitBackoffMultiplier: 2.0, // Multiply by 2 each time
  rateLimitMaxBackoff: 20 * 60 * 1000, // Max 20 minutes backoff
  
  // Non-Substack delays (shorter)
  nonSubstackDelay: 15000 // 15 seconds for non-Substack feeds
};

// Domain request tracking
const domainLastRequested = new Map();
const domainRateLimitBackoff = new Map(); // Track backoff delays per domain
const failedFeeds = new Map(); // Track recently failed feeds to skip temporarily

// User agent rotation - prioritize legitimate RSS readers to appear as regular feed app
const USER_AGENTS = [
  // RSS Readers (weighted higher by appearing multiple times)
  'Feedly/1.0 (+https://feedly.com/f/about)',
  'Feedly/1.0 (+https://feedly.com/f/about)',
  'Inoreader/2.0 (+https://www.inoreader.com; 12 subscribers)',
  'Inoreader/2.0 (+https://www.inoreader.com; 8 subscribers)', 
  'NewsBlur/1.0 (+https://newsblur.com; 3 subscribers)',
  'NewsBlur/1.0 (+https://newsblur.com; 15 subscribers)',
  'Feedbin/2.0 (+https://feedbin.com/)',
  'NetNewsWire/6.1.4 (+https://netnewswire.com/)',
  'NetNewsWire/6.1.3 (+https://netnewswire.com/)',
  'Reeder/5.0 (+https://reederapp.com/)',
  'The Old Reader/1.0 (+https://theoldreader.com/)',
  'FeedlyMobile/92.1.0 (like FeedlyMobile)',
  'RSSOwl/2.2.1 (Windows; U; en)',
  'Akregator/5.18.1; syndication',
  // Occasional browsers (much fewer)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Decode HTML entities
function decodeHTMLEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#8217;': "'",
    '&#8216;': "'",
    '&#8220;': '"',
    '&#8221;': '"',
    '&#8211;': '–',
    '&#8212;': '—',
    '&nbsp;': ' ',
    '&#160;': ' ',
    '&#8230;': '...',
    '&hellip;': '...'
  };
  
  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }
  
  // Handle numeric entities
  decoded = decoded.replace(/&#(\d+);/g, (match, num) => String.fromCharCode(num));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  return decoded;
}

// Detect actual publication from article URL for aggregated feeds
function detectPublicationFromUrl(url, feedSource) {
  if (!url) return null;
  
  // Publication URL patterns and their corresponding names
  const publicationMap = {
    'lrb.co.uk': { name: 'London Review of Books', slug: 'london-review-of-books', category: 'Culture' },
    'wsj.com': { name: 'Wall Street Journal', slug: 'wall-street-journal', category: 'Economics' },
    'ft.com': { name: 'Financial Times', slug: 'financial-times', category: 'Economics' },
    'economist.com': { name: 'The Economist', slug: 'economist', category: 'Economics' },
    'nytimes.com': { name: 'New York Times', slug: 'new-york-times', category: 'Politics' },
    'washingtonpost.com': { name: 'Washington Post', slug: 'washington-post', category: 'Politics' },
    'theatlantic.com': { name: 'The Atlantic', slug: 'atlantic', category: 'Culture' },
    'newyorker.com': { name: 'The New Yorker', slug: 'new-yorker', category: 'Culture' },
    'harpers.org': { name: 'Harper\'s Magazine', slug: 'harpers', category: 'Culture' },
    'newrepublic.com': { name: 'The New Republic', slug: 'new-republic', category: 'Politics' },
    'nationalreview.com': { name: 'National Review', slug: 'national-review', category: 'Politics' },
    'weeklystandard.com': { name: 'The Weekly Standard', slug: 'weekly-standard', category: 'Politics' },
    'spectator.org': { name: 'The American Spectator', slug: 'american-spectator', category: 'Politics' },
    'prospect.org': { name: 'The American Prospect', slug: 'american-prospect', category: 'Politics' },
    'foreignaffairs.com': { name: 'Foreign Affairs', slug: 'foreign-affairs', category: 'Politics' },
    'foreignpolicy.com': { name: 'Foreign Policy', slug: 'foreign-policy', category: 'Politics' },
    'theguardian.com': { name: 'The Guardian', slug: 'guardian', category: 'Politics' },
    'bbc.com': { name: 'BBC', slug: 'bbc', category: 'Politics' },
    'reuters.com': { name: 'Reuters', slug: 'reuters', category: 'Politics' },
    'ap.org': { name: 'Associated Press', slug: 'associated-press', category: 'Politics' },
    'bloomberg.com': { name: 'Bloomberg', slug: 'bloomberg', category: 'Economics' },
    'quantamagazine.org': { name: 'Quanta Magazine', slug: 'quanta-magazine', category: 'Science' },
    'scientificamerican.com': { name: 'Scientific American', slug: 'scientific-american', category: 'Science' },
    'nature.com': { name: 'Nature', slug: 'nature', category: 'Science' },
    'science.org': { name: 'Science', slug: 'science-magazine', category: 'Science' },
    'aeon.co': { name: 'Aeon', slug: 'aeon', category: 'Philosophy' },
  };

  // Only apply this detection for known aggregator feeds
  const aggregatorFeeds = ['Arts & Letters Daily'];
  if (!aggregatorFeeds.includes(feedSource.name)) {
    return null;
  }

  // Extract domain from URL
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.toLowerCase().replace(/^www\./, '');
    
    // Check if we have a mapping for this domain
    if (publicationMap[domain]) {
      return publicationMap[domain];
    }
  } catch (error) {
    console.warn(`Invalid URL for publication detection: ${url}`);
  }

  return null;
}

// Simple XML parser for RSS feeds
function parseXML(xmlString, feed) {
  const items = [];
  const itemMatches = xmlString.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
  
  itemMatches.forEach(itemXml => {
    const item = {};
    
    // Extract title
    const titleMatch = itemXml.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>|<title[^>]*>(.*?)<\/title>/i);
    const rawTitle = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
    item.title = decodeHTMLEntities(rawTitle);
    
    // Extract link
    const linkMatch = itemXml.match(/<link[^>]*>(.*?)<\/link>/i);
    item.link = linkMatch ? linkMatch[1].trim() : '';
    
    // Extract author
    const authorMatch = itemXml.match(/<author[^>]*>(.*?)<\/author>|<dc:creator[^>]*><!\[CDATA\[(.*?)\]\]><\/dc:creator>|<dc:creator[^>]*>(.*?)<\/dc:creator>/i);
    item.author = authorMatch ? (authorMatch[1] || authorMatch[2] || authorMatch[3] || '').trim() : '';
    
    // Extract published date
    const pubDateMatch = itemXml.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i);
    item.publishedAt = pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : new Date().toISOString();
    
    // Extract description/content
    const descMatch = itemXml.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>/i);
    const contentMatch = itemXml.match(/<content:encoded[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i);
    
    const description = descMatch ? (descMatch[1] || descMatch[2] || '') : '';
    const content = contentMatch ? contentMatch[1] : '';
    
    // Store raw content for processing
    const rawContent = (content || description).trim();
    
    // Clean HTML thoroughly - remove scripts, styles, and all tags
    let cleanText = rawContent
      // Remove script tags and their contents
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      // Remove style tags and their contents  
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      // Remove iframe and embed tags
      .replace(/<iframe[^>]*>.*?<\/iframe>/gis, '')
      .replace(/<embed[^>]*\/?>/gis, '')
      // Remove all HTML tags
      .replace(/<[^>]*>/g, '')
      // Remove JavaScript function calls and patterns
      .replace(/!function\(\)[^}]*}[^;]*;/g, '')
      .replace(/function\([^)]*\)[^}]*{[^}]*}/g, '')
      .replace(/window\.addEventListener[^;]*;/g, '')
      // Remove problematic URLs and embedded content references
      .replace(/https?:\/\/[^\s]*youtube-nocookie\.com[^\s]*/gi, '')
      .replace(/https?:\/\/[^\s]*datawrapper\.dwcdn\.net[^\s]*/gi, '')
      .replace(/https?:\/\/[^\s]*substackcdn\.com[^\s]*/gi, '')
      .replace(/https?:\/\/[^\s]*embed[^\s]*/gi, '')
      .replace(/https?:\/\/[^\s]*soundcloud\.com[^\s]*/gi, '')
      .replace(/https?:\/\/[^\s]*spotify\.com[^\s]*/gi, '')
      // Remove any remaining URL fragments that start with /"
      .replace(/\/"https?[^\s]*/gi, '')
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .trim();
    
    // Store cleaned content and create excerpt
    item.content = decodeHTMLEntities(cleanText);
    item.excerpt = item.content.substring(0, 300).trim();
    
    // Generate ID
    item.id = generateId(item.link + item.title);
    
    // Detect actual publication from URL for aggregated feeds
    const actualPublication = detectPublicationFromUrl(item.link, feed);
    if (actualPublication) {
      item.actualPublication = actualPublication;
    }
    
    // Add metadata
    item.wordCount = item.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
    item.readTime = Math.ceil(item.wordCount / 250); // Assume 250 WPM reading speed
    item.isPaid = item.content.toLowerCase().includes('subscribe') || item.link.includes('subscribe');
    
    if (item.title && item.link) {
      items.push(item);
    }
  });
  
  return items;
}

function generateId(text) {
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch (error) {
    console.warn(`Invalid URL: ${url}`);
    return url; // fallback to full URL as domain
  }
}

function getRandomSubstackDelay() {
  const min = RATE_LIMIT.substackDelayMin;
  const max = RATE_LIMIT.substackDelayMax;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitForDomainClearance(domain, isSubstack) {
  const now = Date.now();
  const lastRequested = domainLastRequested.get(domain) || 0;
  
  let requiredDelay;
  if (isSubstack) {
    // Global Substack rate limiting - wait for ANY previous Substack request
    const timeSinceLastSubstack = now - RATE_LIMIT.lastSubstackRequest;
    if (timeSinceLastSubstack < RATE_LIMIT.globalSubstackDelay) {
      const globalWaitTime = RATE_LIMIT.globalSubstackDelay - timeSinceLastSubstack;
      const globalWaitMinutes = Math.round(globalWaitTime / 60000 * 10) / 10;
      console.log(`   🌐 Global Substack cooldown: Waiting ${globalWaitMinutes} minutes since last Substack request...`);
      await delay(globalWaitTime);
    }
    
    // Domain-specific Substack delays
    const substackRandomDelay = getRandomSubstackDelay();
    const substackDomainMinimum = RATE_LIMIT.substackMinDomainDelay;
    requiredDelay = Math.max(substackRandomDelay, substackDomainMinimum);
  } else {
    // For non-Substack, use the configured delay
    requiredDelay = RATE_LIMIT.nonSubstackDelay;
  }
  
  const timeSinceLastRequest = now - lastRequested;
  
  if (timeSinceLastRequest < requiredDelay) {
    const waitTime = requiredDelay - timeSinceLastRequest;
    const waitMinutes = Math.round(waitTime / 60000 * 10) / 10; // round to 1 decimal
    
    const domainType = isSubstack ? 'Substack domain' : 'domain';
    console.log(`   ⏳ ${domainType} ${domain} was accessed recently. Waiting ${waitMinutes} minutes to avoid rate limiting...`);
    await delay(waitTime);
  }
  
  // Update the last requested time for this domain
  domainLastRequested.set(domain, Date.now());
  
  // Update global Substack timestamp
  if (isSubstack) {
    RATE_LIMIT.lastSubstackRequest = Date.now();
  }
}

function delay(ms) {
  // Add some randomization to make timing more human-like
  const randomDelay = ms + Math.random() * 1000; // Add up to 1 second of randomness
  return new Promise(resolve => setTimeout(resolve, randomDelay));
}

async function fetchFeedWithRetry(feed, attempt = 1) {
  try {
    const domain = getDomainFromUrl(feed.url);
    const isSubstack = domain.includes('substack.com');
    
    // Check if this feed failed recently and should be skipped
    const failedUntil = failedFeeds.get(feed.url) || 0;
    if (Date.now() < failedUntil) {
      const waitTime = failedUntil - Date.now();
      const waitMinutes = Math.round(waitTime / 60000);
      console.log(`⏭️  Skipping ${feed.name} - failed recently, retry in ${waitMinutes} minutes`);
      return [];
    }
    
    // Wait for domain clearance before making request
    if (attempt === 1) { // Only wait on first attempt, not retries
      await waitForDomainClearance(domain, isSubstack);
    }
    
    // Check for rate limit backoff
    const backoffUntil = domainRateLimitBackoff.get(domain) || 0;
    if (Date.now() < backoffUntil) {
      const waitTime = backoffUntil - Date.now();
      const waitMinutes = Math.round(waitTime / 60000 * 10) / 10;
      console.log(`   🚫 Domain ${domain} is in rate limit backoff. Waiting ${waitMinutes} more minutes...`);
      await delay(waitTime);
    }
    
    console.log(`Fetching ${feed.name} (${feed.url}) - attempt ${attempt}`);
    
    const userAgent = getRandomUserAgent();
    const headers = {
      'User-Agent': userAgent,
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    };
    
    // Only add browser-specific headers if using browser user agent (rare)
    if (userAgent.includes('Mozilla')) {
      headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
      headers['Upgrade-Insecure-Requests'] = '1';
    }
    
    const response = await fetch(feed.url, {
      headers,
      timeout: 45000 // Increased timeout to 45 seconds
    });
    
    if (!response.ok) {
      // Special handling for rate limiting errors
      if (response.status === 403 || response.status === 429) {
        const backoffDelay = calculateRateLimitBackoff(domain, attempt);
        domainRateLimitBackoff.set(domain, Date.now() + backoffDelay);
        const backoffMinutes = Math.round(backoffDelay / 60000 * 10) / 10;
        
        throw new Error(`HTTP ${response.status}: Rate limited - set ${backoffMinutes} min backoff`);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Success - clear any backoff for this domain
    domainRateLimitBackoff.delete(domain);
    
    const xmlData = await response.text();
    const articles = parseXML(xmlData, feed);
    
    // Add publication metadata to each article
    const enrichedArticles = articles.map(article => ({
      ...article,
      publication: article.actualPublication || {
        name: feed.name,
        slug: feed.slug,
        category: feed.category
      },
      author: article.author || feed.defaultAuthor,
      slug: generateSlug(article.title)
    }));
    
    console.log(`✅ ${feed.name}: ${enrichedArticles.length} articles`);
    return enrichedArticles;
    
  } catch (error) {
    console.error(`❌ Failed to fetch ${feed.name} (attempt ${attempt}): ${error.message}`);
    
    // Determine retry delay based on error type
    let retryDelay = RATE_LIMIT.retryDelay;
    const isRateLimit = error.message.includes('403') || error.message.includes('429');
    
    if (isRateLimit && attempt < RATE_LIMIT.retryAttempts) {
      // For rate limit errors, use exponential backoff
      retryDelay = calculateRateLimitBackoff(getDomainFromUrl(feed.url), attempt);
      const retryMinutes = Math.round(retryDelay / 60000 * 10) / 10;
      console.log(`   Retrying in ${retryMinutes} minutes (rate limit backoff)...`);
    } else if (attempt < RATE_LIMIT.retryAttempts) {
      console.log(`   Retrying in ${retryDelay / 1000} seconds...`);
    }
    
    if (attempt < RATE_LIMIT.retryAttempts) {
      await delay(retryDelay);
      return fetchFeedWithRetry(feed, attempt + 1);
    } else {
      console.error(`   Giving up on ${feed.name} after ${RATE_LIMIT.retryAttempts} attempts`);
      
      // Mark this feed as failed for 2 hours to avoid wasting time on subsequent runs
      if (isRateLimit) {
        failedFeeds.set(feed.url, Date.now() + (2 * 60 * 60 * 1000)); // 2 hours
        console.log(`   🚫 Marking ${feed.name} as temporarily failed (2 hours)`);
      }
      
      return [];
    }
  }
}

function calculateRateLimitBackoff(domain, attempt) {
  const baseDelay = RATE_LIMIT.rateLimitBackoffBase;
  const multiplier = Math.pow(RATE_LIMIT.rateLimitBackoffMultiplier, attempt - 1);
  const delay = baseDelay * multiplier;
  
  // Cap at maximum backoff
  return Math.min(delay, RATE_LIMIT.rateLimitMaxBackoff);
}

function generateSlug(title) {
  if (!title || title.trim() === '') {
    return 'untitled-' + Date.now();
  }
  
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '') // Remove leading/trailing dashes
    .substring(0, 60);
    
  // If slug is empty after processing, generate a fallback
  return slug || 'untitled-' + Date.now();
}

async function processFeeds(feeds) {
  const results = [];
  
  console.log(`📊 Processing ${feeds.length} feeds one by one with smart rate limiting...`);
  
  // Process feeds one at a time with intelligent delays
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const domain = getDomainFromUrl(feed.url);
    const isSubstack = domain.includes('substack.com');
    
    console.log(`\n[${i + 1}/${feeds.length}] Processing: ${feed.name} (${isSubstack ? 'Substack' : 'Other'})`);
    
    try {
      const result = await fetchFeedWithRetry(feed);
      results.push(...result);
      
      // Add base delay between all requests (except for the last one)
      if (i < feeds.length - 1) {
        const delaySeconds = Math.round(RATE_LIMIT.delayBetweenRequests / 1000);
        console.log(`   ⏸️  Base delay: ${delaySeconds} seconds before next feed...`);
        await delay(RATE_LIMIT.delayBetweenRequests);
      }
    } catch (error) {
      console.error(`❌ Failed to process ${feed.name}: ${error.message}`);
      // Continue with next feed even if one fails
    }
  }
  
  return results;
}

async function fetchAllFeeds() {
  try {
    // Parse command line arguments for batching
    const args = process.argv.slice(2);
    const batchArg = args.find(arg => arg.startsWith('--batch='));
    const totalBatchesArg = args.find(arg => arg.startsWith('--total-batches='));
    
    const currentBatch = batchArg ? parseInt(batchArg.split('=')[1]) : null;
    const totalBatches = totalBatchesArg ? parseInt(totalBatchesArg.split('=')[1]) : 1;
    
    console.log('🚀 Starting RSS feed fetch process...');
    if (currentBatch) {
      console.log(`📦 Running batch ${currentBatch} of ${totalBatches}`);
    }
    
    // Load feeds configuration
    const feedsPath = path.join(__dirname, '../../data/feeds.json');
    console.log(`📁 Loading feeds from: ${feedsPath}`);
    const feedsData = await fs.readFile(feedsPath, 'utf-8');
    console.log(`📋 Successfully loaded feeds data (${feedsData.length} chars)`);
    const allFeeds = JSON.parse(feedsData);
    console.log(`🔍 Parsed ${allFeeds.length} feeds from JSON`);
    
    // Filter feeds for this batch if batching is enabled
    let feeds = allFeeds;
    if (currentBatch && totalBatches > 1) {
      const batchSize = Math.ceil(allFeeds.length / totalBatches);
      const startIndex = (currentBatch - 1) * batchSize;
      const endIndex = Math.min(startIndex + batchSize, allFeeds.length);
      feeds = allFeeds.slice(startIndex, endIndex);
      console.log(`📦 Processing batch ${currentBatch}: feeds ${startIndex + 1}-${endIndex} (${feeds.length} feeds)`);
    }
    
    // Separate Substack from non-Substack feeds for different rate limiting
    const substackFeeds = feeds.filter(feed => feed.url.includes('substack.com'));
    const nonSubstackFeeds = feeds.filter(feed => !feed.url.includes('substack.com'));
    
    // Load existing archive if it exists
    const archivePath = path.join(__dirname, '../../data/articles-archive.json');
    let articlesArchive = {};
    try {
      const archiveData = await fs.readFile(archivePath, 'utf-8');
      const parsed = JSON.parse(archiveData);
      articlesArchive = parsed.articles || {};
      console.log(`📚 Loaded archive with ${Object.keys(articlesArchive).length} historical articles`);
    } catch (error) {
      console.log('📚 No existing archive found, will create new one');
    }
    
    console.log(`📋 Found ${feeds.length} feeds to process (${substackFeeds.length} Substack, ${nonSubstackFeeds.length} others)`);
    console.log(`⚙️  Smart rate limiting: 2-5 min delays for Substack, 15s for others`);
    console.log(`⏱️  Domain-based limiting: 10 min minimum between requests to same domain`);
    console.log(`🕐  Estimated time: ${Math.round((feeds.length * 3) / 60)} hours (very conservative)`);
    
    // Separate and interleave Substack and non-Substack feeds for better distribution
    const substackFeeds = feeds.filter(feed => feed.url.includes('substack.com'));
    const nonSubstackFeeds = feeds.filter(feed => !feed.url.includes('substack.com'));
    
    // Shuffle each group separately
    const shuffledSubstack = [...substackFeeds].sort(() => Math.random() - 0.5);
    const shuffledNonSubstack = [...nonSubstackFeeds].sort(() => Math.random() - 0.5);
    
    // Interleave feeds: 1 Substack, then 2-3 non-Substack, repeat
    const interleavedFeeds = [];
    let substackIndex = 0;
    let nonSubstackIndex = 0;
    
    while (substackIndex < shuffledSubstack.length || nonSubstackIndex < shuffledNonSubstack.length) {
      // Add 1 Substack feed
      if (substackIndex < shuffledSubstack.length) {
        interleavedFeeds.push(shuffledSubstack[substackIndex++]);
      }
      
      // Add 2-3 non-Substack feeds
      const nonSubstackCount = Math.floor(Math.random() * 2) + 2; // 2 or 3
      for (let i = 0; i < nonSubstackCount && nonSubstackIndex < shuffledNonSubstack.length; i++) {
        interleavedFeeds.push(shuffledNonSubstack[nonSubstackIndex++]);
      }
    }
    
    console.log(`\n🔄 Processing feeds with smart interleaving (${substackFeeds.length} Substack, ${nonSubstackFeeds.length} others)...`);
    const allArticles = await processFeeds(interleavedFeeds);
    
    // Add new articles to archive (using article ID as key to avoid duplicates)
    allArticles.forEach(article => {
      articlesArchive[article.id] = article;
    });
    
    // Convert archive to array and sort by date
    const allArchivedArticles = Object.values(articlesArchive)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    
    // Filter for recent articles (last 30 days) for display
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentArticles = allArchivedArticles
      .filter(article => new Date(article.publishedAt) > thirtyDaysAgo)
      .slice(0, 500); // Limit to 500 most recent articles for display
    
    // Save archive (all historical articles)
    const archiveOutputData = {
      articles: articlesArchive,
      lastUpdated: new Date().toISOString(),
      totalArticles: Object.keys(articlesArchive).length,
      oldestArticle: allArchivedArticles[allArchivedArticles.length - 1]?.publishedAt,
      newestArticle: allArchivedArticles[0]?.publishedAt
    };
    await fs.writeFile(archivePath, JSON.stringify(archiveOutputData, null, 2));
    
    // Save display file (recent articles only)
    const outputPath = path.join(__dirname, '../../data/articles.json');
    const outputData = {
      articles: recentArticles,
      lastUpdated: new Date().toISOString(),
      totalFeeds: feeds.length,
      totalArticles: recentArticles.length,
      fromArchive: Object.keys(articlesArchive).length
    };
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
    
    console.log(`\n✅ Feed fetch complete!`);
    console.log(`   New articles collected: ${allArticles.length}`);
    console.log(`   Total in archive: ${Object.keys(articlesArchive).length} articles`);
    console.log(`   Recent articles (30 days): ${recentArticles.length}`);
    console.log(`   Archive saved to: ${archivePath}`);
    console.log(`   Display data saved to: ${outputPath}`);
    console.log(`   Last updated: ${outputData.lastUpdated}`);
    
    // Summary by category
    const categoryStats = {};
    recentArticles.forEach(article => {
      const category = article.publication.category;
      categoryStats[category] = (categoryStats[category] || 0) + 1;
    });
    
    console.log('\n📊 Articles by category:');
    Object.entries(categoryStats)
      .sort(([,a], [,b]) => b - a)
      .forEach(([category, count]) => {
        console.log(`   ${category}: ${count} articles`);
      });
    
  } catch (error) {
    console.error('💥 Fatal error during feed fetch:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Feed fetch interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  Feed fetch terminated');
  process.exit(0);
});

// Run the fetcher
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('fetch-feeds.js')) {
  fetchAllFeeds();
}

export default fetchAllFeeds;