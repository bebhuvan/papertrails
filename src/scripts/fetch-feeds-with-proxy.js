#!/usr/bin/env node
// Enhanced feed fetcher that uses Cloudflare Worker proxy for Substack feeds
// Falls back to direct fetch for non-Substack feeds

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const WORKER_URL = process.env.WORKER_URL || 'https://papertrails.rabbitholes.garden';
const USE_PROXY_FOR_SUBSTACK = process.env.USE_PROXY !== 'false';
const SUBSTACK_DELAY = 30000; // 30 seconds between Substack feeds
const NORMAL_DELAY = 5000; // 5 seconds between normal feeds
const MAX_RETRIES = 2;

// Track last request time per domain
const domainLastRequest = new Map();
const MIN_DOMAIN_DELAY = 60000; // 1 minute minimum between requests to same domain

async function fetchFeed(feedUrl, useProxy = false) {
  if (useProxy && WORKER_URL) {
    // Use Cloudflare Worker proxy
    const proxyUrl = `${WORKER_URL}/api/fetch-rss?url=${encodeURIComponent(feedUrl)}`;
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      throw new Error(`Proxy returned ${response.status}`);
    }
    
    return await response.text();
  } else {
    // Direct fetch
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader/1.0; +https://github.com)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 30000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.text();
  }
}

async function processFeed(feed, parser, index, total) {
  const isSubstack = feed.url.includes('substack.com');
  const domain = new URL(feed.url).hostname;
  
  console.log(`[${index}/${total}] Processing: ${feed.name} (${feed.category})`);
  
  // Check domain rate limiting
  const lastRequest = domainLastRequest.get(domain);
  if (lastRequest) {
    const timeSinceLastRequest = Date.now() - lastRequest;
    if (timeSinceLastRequest < MIN_DOMAIN_DELAY) {
      const waitTime = MIN_DOMAIN_DELAY - timeSinceLastRequest;
      console.log(`   ⏸️  Waiting ${Math.round(waitTime/1000)}s for domain cooldown...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  const articles = [];
  let attempts = 0;
  let lastError;
  
  while (attempts < MAX_RETRIES) {
    attempts++;
    
    try {
      // Fetch RSS content (use proxy for Substack only if enabled)
      const useProxy = isSubstack && USE_PROXY_FOR_SUBSTACK;
      console.log(`   ${useProxy ? '🔄 Using proxy' : '🔗 Direct fetch'} - attempt ${attempts}`);
      
      const rssContent = await fetchFeed(feed.url, useProxy);
      
      // Parse RSS
      const result = await parser.parseString(rssContent);
      
      // Process articles (take up to 50 most recent from each feed)
      for (const item of result.items.slice(0, 50)) {
        const content = item.contentSnippet || item.content || item.description || '';
        const id = crypto.createHash('md5')
          .update(item.link || item.guid || item.title)
          .digest('hex')
          .substring(0, 8);
        
        articles.push({
          title: item.title || 'Untitled',
          link: item.link || item.guid,
          author: item.creator || item.author || feed.defaultAuthor || feed.name,
          publishedAt: item.pubDate || item.isoDate || item.date || new Date(item.published || Date.now()).toISOString(),
          content: content.substring(0, 300),
          excerpt: content.substring(0, 200),
          id,
          wordCount: content.split(/\s+/).length,
          readTime: Math.max(1, Math.ceil(content.split(/\s+/).length / 200)),
          isPaid: false,
          publication: {
            name: feed.name,
            slug: feed.slug,
            category: feed.category
          }
        });
      }
      
      console.log(`   ✅ Success: ${articles.length} articles`);
      domainLastRequest.set(domain, Date.now());
      return { success: true, articles, feed };
      
    } catch (error) {
      lastError = error;
      console.log(`   ❌ Attempt ${attempts} failed: ${error.message}`);
      
      if (attempts < MAX_RETRIES) {
        const retryDelay = attempts * 10000; // Exponential backoff
        console.log(`   ⏸️  Retrying in ${retryDelay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  console.log(`   ❌ Failed after ${attempts} attempts`);
  return { success: false, error: lastError?.message, feed };
}

async function main() {
  console.log('=== Enhanced RSS Feed Fetcher ===');
  console.log(`Worker URL: ${WORKER_URL || 'Not configured'}`);
  console.log(`Proxy for Substack: ${USE_PROXY_FOR_SUBSTACK ? 'Enabled' : 'Disabled'}`);
  console.log('');
  
  // Load feeds
  const feedsFile = process.env.FEEDS_FILE || 'data/feeds.json';
  const feedsPath = path.join(__dirname, '../../', feedsFile);
  const feeds = JSON.parse(await fs.readFile(feedsPath, 'utf-8'));
  
  // Load existing articles
  const articlesPath = path.join(__dirname, '../../data/articles.json');
  let existingArticles = [];
  try {
    const data = JSON.parse(await fs.readFile(articlesPath, 'utf-8'));
    // Handle both formats: array or object with articles property
    existingArticles = Array.isArray(data) ? data : (data.articles || []);
  } catch (e) {
    console.log('No existing articles found, starting fresh');
  }
  
  const existingIds = new Set(existingArticles.map(a => a.id));
  
  // Statistics
  const substackCount = feeds.filter(f => f.url.includes('substack.com')).length;
  console.log(`Total feeds: ${feeds.length} (${substackCount} Substack, ${feeds.length - substackCount} others)`);
  console.log('');
  
  const parser = new Parser({ timeout: 30000 });
  const results = [];
  const newArticles = [];
  
  // Process feeds sequentially with appropriate delays
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const isSubstack = feed.url.includes('substack.com');
    
    const result = await processFeed(feed, parser, i + 1, feeds.length);
    results.push(result);
    
    if (result.success) {
      // Filter out existing articles
      const uniqueArticles = result.articles.filter(a => !existingIds.has(a.id));
      newArticles.push(...uniqueArticles);
      uniqueArticles.forEach(a => existingIds.add(a.id));
    }
    
    // Delay before next feed
    if (i < feeds.length - 1) {
      const delay = isSubstack ? SUBSTACK_DELAY : NORMAL_DELAY;
      console.log(`   ⏸️  Waiting ${delay/1000}s before next feed...\n`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Merge with existing articles
  const allArticles = [...existingArticles, ...newArticles];
  
  // Sort by date (newest first)
  allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  
  // Keep only last 1000 articles
  const finalArticles = allArticles.slice(0, 1000);
  
  // Save results
  await fs.writeFile(articlesPath, JSON.stringify(finalArticles, null, 2));
  
  // Generate summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary:');
  console.log(`✅ Successful feeds: ${successful}/${feeds.length}`);
  console.log(`❌ Failed feeds: ${failed}`);
  console.log(`📰 New articles: ${newArticles.length}`);
  console.log(`💾 Total articles saved: ${finalArticles.length}`);
  
  if (failed > 0) {
    console.log('\n❌ Failed feeds:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.feed.name}: ${r.error}`);
    });
  }
  
  // Exit with error if too many failures
  if (failed > feeds.length * 0.3) {
    console.error('\n⚠️  More than 30% of feeds failed!');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}