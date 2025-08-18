#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enhanced rate limiting for local execution
const RATE_LIMIT = {
  // Substack-specific settings - even more conservative for local
  substackDelayMin: 30 * 1000, // 30 seconds minimum
  substackDelayMax: 90 * 1000, // 90 seconds maximum
  substackBurstDelay: 5 * 60 * 1000, // 5 minutes after every 5 Substack feeds
  
  // Non-Substack settings
  nonSubstackDelay: 5000, // 5 seconds
  
  // General settings
  retryAttempts: 3,
  retryDelay: 30000,
  timeout: 60000,
  
  // User agent cycling interval
  userAgentCycleInterval: 10, // Change UA every 10 requests
};

// Browser-like user agents for better success rate
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

// Track metrics
const metrics = {
  total: 0,
  successful: 0,
  failed: 0,
  substackSuccessful: 0,
  substackFailed: 0,
  startTime: Date.now(),
  failedFeeds: []
};

// Helper functions
function isSubstackFeed(url) {
  return url.includes('substack.com');
}

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateArticleId(article, feedSlug) {
  const uniqueString = `${feedSlug}-${article.link || article.guid || article.title}`;
  return crypto.createHash('md5').update(uniqueString).digest('hex');
}

function cleanDescription(description) {
  if (!description) return '';
  
  // Remove HTML tags
  let cleaned = description.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  };
  
  for (const [entity, char] of Object.entries(entities)) {
    cleaned = cleaned.replace(new RegExp(entity, 'g'), char);
  }
  
  // Limit to 200 characters
  if (cleaned.length > 200) {
    cleaned = cleaned.substring(0, 197) + '...';
  }
  
  return cleaned.trim();
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(parser, url, feedInfo, userAgent, retryCount = 0) {
  try {
    console.log(`  Attempt ${retryCount + 1} for ${feedInfo.name}...`);
    
    const feed = await parser.parseURL(url);
    console.log(`  ✓ Successfully fetched ${feedInfo.name} (${feed.items.length} items)`);
    return feed;
  } catch (error) {
    if (retryCount < RATE_LIMIT.retryAttempts - 1) {
      const backoffDelay = RATE_LIMIT.retryDelay * Math.pow(2, retryCount);
      console.log(`  ✗ Failed attempt ${retryCount + 1} for ${feedInfo.name}: ${error.message}`);
      console.log(`  → Retrying in ${backoffDelay / 1000} seconds...`);
      await delay(backoffDelay);
      return fetchWithRetry(parser, url, feedInfo, userAgent, retryCount + 1);
    }
    throw error;
  }
}

async function fetchFeeds() {
  console.log('=== Local Feed Fetcher Started ===\n');
  console.log('Current working directory:', process.cwd());
  console.log('Script directory:', __dirname);
  
  // Load feeds configuration
  const feedsPath = path.join(__dirname, '../../data/feeds.json');
  const feedsData = await fs.readFile(feedsPath, 'utf-8');
  const feeds = JSON.parse(feedsData);
  
  // Load existing articles
  const articlesPath = path.join(__dirname, '../../data/articles.json');
  const archivePath = path.join(__dirname, '../../data/articles-archive.json');
  
  let existingArticles = [];
  let articleArchive = [];
  
  try {
    const articlesData = await fs.readFile(articlesPath, 'utf-8');
    existingArticles = JSON.parse(articlesData);
    if (!Array.isArray(existingArticles)) {
      existingArticles = [];
    }
  } catch (error) {
    console.log('No existing articles found, starting fresh');
    existingArticles = [];
  }
  
  try {
    const archiveData = await fs.readFile(archivePath, 'utf-8');
    articleArchive = JSON.parse(archiveData);
    if (!Array.isArray(articleArchive)) {
      articleArchive = [];
    }
  } catch (error) {
    console.log('No archive found, creating new');
    articleArchive = [];
  }
  
  // Separate Substack and non-Substack feeds
  const substackFeeds = feeds.filter(f => isSubstackFeed(f.url));
  const otherFeeds = feeds.filter(f => !isSubstackFeed(f.url));
  
  console.log(`Found ${substackFeeds.length} Substack feeds and ${otherFeeds.length} other feeds\n`);
  
  // Start with non-Substack feeds for better success rate
  const orderedFeeds = otherFeeds.slice(0, 5);
  const allArticles = [];
  const existingIds = new Set(existingArticles.map(a => a.id));
  
  let requestCount = 0;
  let substackCount = 0;
  let currentUserAgent = 0;
  
  for (let i = 0; i < orderedFeeds.length; i++) {
    const feed = orderedFeeds[i];
    const isSubstack = isSubstackFeed(feed.url);
    
    metrics.total++;
    requestCount++;
    
    // Cycle user agent
    if (requestCount % RATE_LIMIT.userAgentCycleInterval === 0) {
      currentUserAgent = (currentUserAgent + 1) % USER_AGENTS.length;
    }
    
    const parser = new Parser({
      timeout: RATE_LIMIT.timeout,
      headers: {
        'User-Agent': USER_AGENTS[currentUserAgent],
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
      },
      customFields: {
        item: ['content:encoded', 'description']
      }
    });
    
    console.log(`[${i + 1}/${orderedFeeds.length}] Fetching ${feed.name} (${feed.category})...`);
    
    try {
      const feedData = await fetchWithRetry(parser, feed.url, feed, USER_AGENTS[currentUserAgent]);
      
      if (isSubstack) {
        metrics.substackSuccessful++;
        substackCount++;
      } else {
        metrics.successful++;
      }
      
      // Process articles
      let newArticlesCount = 0;
      feedData.items.slice(0, 10).forEach(item => {
        const articleId = generateArticleId(item, feed.slug);
        
        if (!existingIds.has(articleId)) {
          const article = {
            id: articleId,
            title: item.title || 'Untitled',
            link: item.link || item.guid,
            pubDate: item.pubDate || new Date().toISOString(),
            source: feed.name,
            sourceSlug: feed.slug,
            category: feed.category,
            author: item.creator || item.author || feed.defaultAuthor || feed.name,
            description: cleanDescription(item.contentSnippet || item.content || item.description)
          };
          
          allArticles.push(article);
          existingIds.add(articleId);
          newArticlesCount++;
        }
      });
      
      console.log(`  → Added ${newArticlesCount} new articles\n`);
      
    } catch (error) {
      console.log(`  ✗ Failed to fetch ${feed.name}: ${error.message}\n`);
      
      if (isSubstack) {
        metrics.substackFailed++;
      } else {
        metrics.failed++;
      }
      
      metrics.failedFeeds.push({
        name: feed.name,
        url: feed.url,
        error: error.message
      });
    }
    
    // Apply delay based on feed type
    if (i < orderedFeeds.length - 1) {
      let delayMs;
      
      if (isSubstack) {
        // Random delay for Substack
        delayMs = getRandomDelay(RATE_LIMIT.substackDelayMin, RATE_LIMIT.substackDelayMax);
        
        // Extra delay after every 5 Substack feeds
        if (substackCount > 0 && substackCount % 5 === 0) {
          console.log(`  ⏸ Taking a ${RATE_LIMIT.substackBurstDelay / 60000} minute break after ${substackCount} Substack feeds...`);
          delayMs = RATE_LIMIT.substackBurstDelay;
        }
      } else {
        delayMs = RATE_LIMIT.nonSubstackDelay;
      }
      
      console.log(`  ⏱ Waiting ${Math.round(delayMs / 1000)} seconds...\n`);
      await delay(delayMs);
    }
  }
  
  // Merge with existing articles and sort by date
  const mergedArticles = [...allArticles, ...existingArticles];
  mergedArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  
  // Keep only recent articles (e.g., last 500)
  const recentArticles = mergedArticles.slice(0, 500);
  const archivedArticles = mergedArticles.slice(500);
  
  // Update archive
  const updatedArchive = [...archivedArticles, ...articleArchive];
  
  // Save to files
  await fs.writeFile(articlesPath, JSON.stringify(recentArticles, null, 2));
  await fs.writeFile(archivePath, JSON.stringify(updatedArchive, null, 2));
  
  // Print summary
  const duration = Math.round((Date.now() - metrics.startTime) / 1000 / 60);
  console.log('\n=== Fetch Complete ===');
  console.log(`Duration: ${duration} minutes`);
  console.log(`Total feeds processed: ${metrics.total}`);
  console.log(`Non-Substack: ${metrics.successful} successful, ${metrics.failed} failed`);
  console.log(`Substack: ${metrics.substackSuccessful} successful, ${metrics.substackFailed} failed`);
  console.log(`New articles added: ${allArticles.length}`);
  console.log(`Total articles: ${recentArticles.length}`);
  
  if (metrics.failedFeeds.length > 0) {
    console.log('\nFailed feeds:');
    metrics.failedFeeds.forEach(f => {
      console.log(`  - ${f.name}: ${f.error}`);
    });
  }
  
  return { recentArticles, metrics };
}

// Git push function
async function pushToGit(message = 'Update RSS feeds (local fetch)') {
  console.log('\n=== Pushing to Git ===');
  
  try {
    // Stage changes
    await execAsync('git add data/articles.json data/articles-archive.json', {
      cwd: path.join(__dirname, '../../')
    });
    
    // Check if there are changes to commit
    const { stdout: status } = await execAsync('git status --porcelain', {
      cwd: path.join(__dirname, '../../')
    });
    
    if (!status.trim()) {
      console.log('No changes to commit');
      return false;
    }
    
    // Commit
    await execAsync(`git commit -m "${message} - ${new Date().toISOString()}"`, {
      cwd: path.join(__dirname, '../../')
    });
    
    // Push
    await execAsync('git push', {
      cwd: path.join(__dirname, '../../')
    });
    
    console.log('✓ Successfully pushed to Git');
    return true;
  } catch (error) {
    console.error('✗ Git push failed:', error.message);
    return false;
  }
}

// Main execution
async function main() {
  try {
    const { recentArticles, metrics } = await fetchFeeds();
    
    // Only push if we have successful fetches
    if (metrics.successful > 0 || metrics.substackSuccessful > 0) {
      const success = await pushToGit();
      if (success) {
        console.log('\n✓ All done! Site will be updated on next deploy.');
      } else {
        console.log('\n⚠ Feed fetch complete but Git push failed. Please push manually.');
      }
    } else {
      console.log('\n⚠ No successful fetches, skipping Git push.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('fetch-feeds-local.js')) {
  main();
}