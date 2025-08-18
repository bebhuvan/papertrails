#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import FeedLogger from './enhanced-logger.js';

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

// Initialize logger for local system
const logger = new FeedLogger('local');

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
    const feed = await parser.parseURL(url);
    return feed;
  } catch (error) {
    if (retryCount < RATE_LIMIT.retryAttempts - 1) {
      const backoffDelay = RATE_LIMIT.retryDelay * Math.pow(2, retryCount);
      logger.log(`Retrying ${feedInfo.name} in ${backoffDelay / 1000}s (attempt ${retryCount + 2})`);
      await delay(backoffDelay);
      return fetchWithRetry(parser, url, feedInfo, userAgent, retryCount + 1);
    }
    throw error;
  }
}

async function fetchFeeds() {
  logger.log('=== Local Feed Fetcher Started ===');
  logger.log(`Current working directory: ${process.cwd()}`);
  logger.log(`Script directory: ${__dirname}`);
  
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
    const articleData = JSON.parse(articlesData);
    existingArticles = articleData.articles || [];
    if (!Array.isArray(existingArticles)) {
      existingArticles = [];
    }
  } catch (error) {
    logger.log('No existing articles found, starting fresh');
    existingArticles = [];
  }
  
  try {
    const archiveData = await fs.readFile(archivePath, 'utf-8');
    articleArchive = JSON.parse(archiveData);
    if (!Array.isArray(articleArchive)) {
      articleArchive = [];
    }
  } catch (error) {
    logger.log('No archive found, creating new');
    articleArchive = [];
  }
  
  // Separate Substack and non-Substack feeds
  const substackFeeds = feeds.filter(f => isSubstackFeed(f.url));
  const otherFeeds = feeds.filter(f => !isSubstackFeed(f.url));
  
  logger.log(`Found ${substackFeeds.length} Substack feeds and ${otherFeeds.length} other feeds`);
  
  // Process all feeds with smart ordering - non-Substack first
  const orderedFeeds = [...otherFeeds, ...substackFeeds];
  const allArticles = [];
  const existingIds = new Set(existingArticles.map(a => a.id));
  
  let requestCount = 0;
  let substackCount = 0;
  let currentUserAgent = 0;
  
  for (let i = 0; i < orderedFeeds.length; i++) {
    const feed = orderedFeeds[i];
    const isSubstack = isSubstackFeed(feed.url);
    
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
        // Removed Accept-Encoding - let Node.js handle compression automatically
        'Cache-Control': 'no-cache',
      },
      customFields: {
        item: ['content:encoded', 'description']
      }
    });
    
    logger.logFeedStart(feed.name, i + 1, orderedFeeds.length);
    
    try {
      const feedData = await fetchWithRetry(parser, feed.url, feed, USER_AGENTS[currentUserAgent]);
      
      if (isSubstack) {
        substackCount++;
      }
      
      // Process articles
      let newArticlesCount = 0;
      feedData.items.slice(0, 10).forEach(item => {
        const articleId = generateArticleId(item, feed.slug);
        
        if (!existingIds.has(articleId)) {
          const content = item.contentSnippet || item.content || item.description || '';
          const title = item.title || 'Untitled';
          
          const article = {
            title,
            link: item.link || item.guid,
            author: item.creator || item.author || feed.defaultAuthor || feed.name,
            publishedAt: item.pubDate || new Date().toISOString(),
            content: content.substring(0, 300),
            excerpt: content.substring(0, 200),
            id: articleId.substring(0, 8), // Match existing format
            wordCount: content.split(/\s+/).length,
            readTime: Math.max(1, Math.ceil(content.split(/\s+/).length / 200)),
            isPaid: false,
            publication: {
              name: feed.name,
              slug: feed.slug,
              category: feed.category
            },
            slug: title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').substring(0, 50)
          };
          
          allArticles.push(article);
          existingIds.add(articleId);
          newArticlesCount++;
        }
      });
      
      logger.logFeedSuccess(feed.name, feedData.items.length, newArticlesCount);
      
    } catch (error) {
      logger.logFeedFailure(feed.name, feed.url, error);
    }
    
    // Apply delay based on feed type
    if (i < orderedFeeds.length - 1) {
      let delayMs;
      
      if (isSubstack) {
        // Random delay for Substack
        delayMs = getRandomDelay(RATE_LIMIT.substackDelayMin, RATE_LIMIT.substackDelayMax);
        
        // Extra delay after every 5 Substack feeds
        if (substackCount > 0 && substackCount % 5 === 0) {
          logger.log(`⏸ Taking a ${RATE_LIMIT.substackBurstDelay / 60000} minute break after ${substackCount} Substack feeds...`);
          delayMs = RATE_LIMIT.substackBurstDelay;
        }
      } else {
        delayMs = RATE_LIMIT.nonSubstackDelay;
      }
      
      logger.log(`⏱ Waiting ${Math.round(delayMs / 1000)} seconds...`);
      await delay(delayMs);
    }
  }
  
  // Merge with existing articles and sort by date
  const mergedArticles = [...allArticles, ...existingArticles];
  mergedArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  
  // Keep only recent articles (e.g., last 500)
  const recentArticles = mergedArticles.slice(0, 500);
  const archivedArticles = mergedArticles.slice(500);
  
  // Update archive
  const updatedArchive = [...archivedArticles, ...articleArchive];
  
  // Save to files with correct structure
  const articlesData = { articles: recentArticles };
  await fs.writeFile(articlesPath, JSON.stringify(articlesData, null, 2));
  await fs.writeFile(archivePath, JSON.stringify(updatedArchive, null, 2));
  
  // Generate and save summary
  const summary = await logger.generateSummary();
  await logger.saveSummaryToFile(summary);
  
  return { recentArticles, metrics: logger.metrics };
}

// Git push function
async function pushToGit(message = 'Update RSS feeds (local fetch)') {
  logger.log('=== Pushing to Git ===');
  
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
      logger.logGitOperation('status check', true, 'No changes to commit');
      return false;
    }
    
    // Commit
    await execAsync(`git commit -m "${message} - ${new Date().toISOString()}"`, {
      cwd: path.join(__dirname, '../../')
    });
    logger.logGitOperation('commit', true, 'Changes committed');
    
    // Push
    await execAsync('git push', {
      cwd: path.join(__dirname, '../../')
    });
    logger.logGitOperation('push', true, 'Successfully pushed to remote');
    
    return true;
  } catch (error) {
    logger.logGitOperation('push', false, error.message);
    return false;
  }
}

// Main execution
async function main() {
  try {
    const { recentArticles, metrics } = await fetchFeeds();
    
    // Only push if we have successful fetches
    if (metrics.successful > 0) {
      const success = await pushToGit();
      if (success) {
        logger.log('✓ All done! Site will be updated on next deploy.');
      } else {
        logger.log('⚠ Feed fetch complete but Git push failed. Please push manually.');
      }
    } else {
      logger.log('⚠ No successful fetches, skipping Git push.');
    }
    
    process.exit(0);
  } catch (error) {
    logger.logError('Fatal error', error);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] && process.argv[1].endsWith('fetch-feeds-local.js')) {
  main();
}