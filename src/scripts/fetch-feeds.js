#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiting configuration - more aggressive to avoid Substack blocking
const RATE_LIMIT = {
  requestsPerMinute: 15, // More conservative rate limiting
  batchSize: 3, // Process only 3 feeds at a time
  delayBetweenBatches: 4000, // 4 seconds between batches
  delayBetweenRequests: 1500, // 1.5 seconds between individual requests in a batch
  retryAttempts: 3,
  retryDelay: 8000 // 8 seconds between retries
};

// User agent rotation to appear as legitimate RSS readers and browsers
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Feedly/1.0 (+https://feedly.com/f/about)',
  'Inoreader/2.0 (+https://www.inoreader.com; 1 subscribers)',
  'NewsBlur/1.0 (+https://newsblur.com; 1 subscribers)',
  'Feedbin/2.0 (+https://feedbin.com/)',
  'NetNewsWire/6.1 (+https://netnewswire.com/)',
  'Reeder/5.0 (+https://reederapp.com/)'
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

function delay(ms) {
  // Add some randomization to make timing more human-like
  const randomDelay = ms + Math.random() * 1000; // Add up to 1 second of randomness
  return new Promise(resolve => setTimeout(resolve, randomDelay));
}

async function fetchFeedWithRetry(feed, attempt = 1) {
  try {
    console.log(`Fetching ${feed.name} (${feed.url}) - attempt ${attempt}`);
    
    const userAgent = getRandomUserAgent();
    const headers = {
      'User-Agent': userAgent,
      'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, text/html, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };
    
    // Add browser-specific headers for browser user agents
    if (userAgent.includes('Mozilla')) {
      headers['Sec-Fetch-Dest'] = 'document';
      headers['Sec-Fetch-Mode'] = 'navigate';
      headers['Sec-Fetch-Site'] = 'none';
      headers['Sec-Fetch-User'] = '?1';
    }
    
    const response = await fetch(feed.url, {
      headers,
      timeout: 30000 // 30 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
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
    
    if (attempt < RATE_LIMIT.retryAttempts) {
      console.log(`   Retrying in ${RATE_LIMIT.retryDelay / 1000} seconds...`);
      await delay(RATE_LIMIT.retryDelay);
      return fetchFeedWithRetry(feed, attempt + 1);
    } else {
      console.error(`   Giving up on ${feed.name} after ${RATE_LIMIT.retryAttempts} attempts`);
      return [];
    }
  }
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

async function processFeedBatch(feeds) {
  const results = [];
  
  // Process feeds sequentially with delays to avoid rate limiting
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const result = await fetchFeedWithRetry(feed);
    results.push(...result);
    
    // Add delay between requests in the same batch (except for the last one)
    if (i < feeds.length - 1) {
      await delay(RATE_LIMIT.delayBetweenRequests);
    }
  }
  
  return results;
}

async function fetchAllFeeds() {
  try {
    console.log('🚀 Starting RSS feed fetch process...');
    
    // Load feeds configuration
    const feedsPath = path.join(__dirname, '../../data/feeds.json');
    const feedsData = await fs.readFile(feedsPath, 'utf-8');
    const feeds = JSON.parse(feedsData);
    
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
    
    console.log(`📋 Found ${feeds.length} feeds to process`);
    console.log(`⚙️  Rate limiting: ${RATE_LIMIT.requestsPerMinute} requests/minute, batches of ${RATE_LIMIT.batchSize}`);
    console.log(`⏱️  Delays: ${RATE_LIMIT.delayBetweenRequests}ms between requests, ${RATE_LIMIT.delayBetweenBatches}ms between batches`);
    
    const allArticles = [];
    const totalBatches = Math.ceil(feeds.length / RATE_LIMIT.batchSize);
    
    for (let i = 0; i < feeds.length; i += RATE_LIMIT.batchSize) {
      const batch = feeds.slice(i, i + RATE_LIMIT.batchSize);
      const batchNumber = Math.floor(i / RATE_LIMIT.batchSize) + 1;
      
      console.log(`\\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} feeds)`);
      
      const batchArticles = await processFeedBatch(batch);
      allArticles.push(...batchArticles);
      
      console.log(`   Batch complete: ${batchArticles.length} articles collected`);
      
      // Rate limiting delay between batches (except for the last batch)
      if (i + RATE_LIMIT.batchSize < feeds.length) {
        console.log(`   ⏸️  Waiting ${RATE_LIMIT.delayBetweenBatches / 1000} seconds before next batch...`);
        await delay(RATE_LIMIT.delayBetweenBatches);
      }
    }
    
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
    
    console.log(`\\n✅ Feed fetch complete!`);
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
    
    console.log('\\n📊 Articles by category:');
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
  console.log('\\n⏹️  Feed fetch interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\\n⏹️  Feed fetch terminated');
  process.exit(0);
});

// Run the fetcher
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchAllFeeds();
}

export default fetchAllFeeds;