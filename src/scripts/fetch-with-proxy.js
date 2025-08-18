#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Proxy configuration - mix of free and reliable sources
const PROXY_SOURCES = {
  // Free proxy APIs (rotate these)
  freeProxyList: async () => {
    try {
      const response = await fetch('https://www.proxy-list.download/api/v1/get?type=https');
      const text = await response.text();
      return text.split('\n').filter(p => p.trim()).map(p => `http://${p}`);
    } catch (e) {
      return [];
    }
  },
  
  // ProxyScrape free tier
  proxyScrape: async () => {
    try {
      const response = await fetch('https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all&simplified=true');
      const text = await response.text();
      return text.split('\n').filter(p => p.trim()).map(p => `http://${p}`);
    } catch (e) {
      return [];
    }
  },
  
  // Local Tor proxy if installed (most reliable)
  tor: async () => {
    try {
      // Check if Tor is running locally
      await execAsync('pgrep tor');
      return ['socks5://127.0.0.1:9050'];
    } catch (e) {
      return [];
    }
  }
};

// Smart proxy rotation manager
class ProxyManager {
  constructor() {
    this.proxies = [];
    this.blacklist = new Set();
    this.successfulProxies = new Map(); // Track successful proxies per domain
    this.currentIndex = 0;
  }
  
  async initialize() {
    console.log('Fetching proxy list...');
    
    // Gather proxies from all sources
    const allProxies = [];
    for (const [source, fetcher] of Object.entries(PROXY_SOURCES)) {
      const proxies = await fetcher();
      console.log(`  ${source}: ${proxies.length} proxies`);
      allProxies.push(...proxies);
    }
    
    this.proxies = [...new Set(allProxies)]; // Remove duplicates
    console.log(`Total unique proxies: ${this.proxies.length}\n`);
    
    if (this.proxies.length === 0) {
      console.log('⚠ No proxies available, will use direct connection');
    }
  }
  
  getNextProxy(domain) {
    // First check if we have a known working proxy for this domain
    if (this.successfulProxies.has(domain)) {
      const workingProxy = this.successfulProxies.get(domain);
      if (!this.blacklist.has(workingProxy)) {
        return workingProxy;
      }
    }
    
    // Find next non-blacklisted proxy
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      
      if (!this.blacklist.has(proxy)) {
        return proxy;
      }
      attempts++;
    }
    
    // All proxies blacklisted, reset and try again
    this.blacklist.clear();
    return this.proxies[0] || null;
  }
  
  markSuccess(proxy, domain) {
    this.successfulProxies.set(domain, proxy);
  }
  
  markFailure(proxy) {
    this.blacklist.add(proxy);
  }
}

// Enhanced feed fetcher with proxy support
class FeedFetcher {
  constructor(proxyManager) {
    this.proxyManager = proxyManager;
    this.userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Feedly/1.0 (+https://feedly.com/fetcher)',
    ];
    this.currentUA = 0;
  }
  
  async fetchWithProxy(url, feedInfo, useProxy = false) {
    const domain = new URL(url).hostname;
    const userAgent = this.userAgents[this.currentUA % this.userAgents.length];
    this.currentUA++;
    
    let proxy = null;
    let agent = null;
    
    if (useProxy && this.proxyManager.proxies.length > 0) {
      proxy = this.proxyManager.getNextProxy(domain);
      if (proxy) {
        agent = new HttpsProxyAgent(proxy);
      }
    }
    
    const parser = new Parser({
      timeout: 30000,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        // Let Node.js handle compression automatically
        'Cache-Control': 'no-cache',
      },
      requestOptions: agent ? { agent } : {}
    });
    
    try {
      const feed = await parser.parseURL(url);
      
      if (proxy) {
        this.proxyManager.markSuccess(proxy, domain);
        console.log(`  ✓ Success with proxy for ${domain}`);
      }
      
      return feed;
    } catch (error) {
      if (proxy) {
        this.proxyManager.markFailure(proxy);
      }
      throw error;
    }
  }
  
  async fetchWithRetry(url, feedInfo, useProxy = false, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.fetchWithProxy(url, feedInfo, useProxy);
      } catch (error) {
        console.log(`  Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
        
        if (attempt < maxRetries - 1) {
          // Try with proxy on second attempt for Substack
          if (attempt === 0 && url.includes('substack.com')) {
            useProxy = true;
            console.log('  → Switching to proxy for next attempt');
          }
          
          await this.delay(5000 * (attempt + 1)); // Exponential backoff
        } else {
          throw error;
        }
      }
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main fetching logic
async function fetchAllFeeds() {
  console.log('=== Smart Feed Fetcher with Proxy Support ===\n');
  
  const proxyManager = new ProxyManager();
  await proxyManager.initialize();
  
  const fetcher = new FeedFetcher(proxyManager);
  
  // Load feeds
  const feedsPath = path.join(__dirname, '../../data/feeds.json');
  const feedsData = await fs.readFile(feedsPath, 'utf-8');
  const feeds = JSON.parse(feedsData);
  
  // Load existing articles
  const articlesPath = path.join(__dirname, '../../data/articles.json');
  let existingArticles = [];
  try {
    const articlesData = await fs.readFile(articlesPath, 'utf-8');
    existingArticles = JSON.parse(articlesData);
  } catch (e) {
    console.log('Starting with empty articles list');
  }
  
  const allArticles = [];
  const existingIds = new Set(existingArticles.map(a => a.id));
  const metrics = {
    total: feeds.length,
    successful: 0,
    failed: 0,
    proxied: 0
  };
  
  // Process feeds
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const isSubstack = feed.url.includes('substack.com');
    
    console.log(`[${i + 1}/${feeds.length}] Fetching ${feed.name}...`);
    
    try {
      // Use proxy for Substack feeds if available
      const useProxy = isSubstack && proxyManager.proxies.length > 0;
      const feedData = await fetcher.fetchWithRetry(feed.url, feed, useProxy);
      
      metrics.successful++;
      if (useProxy) metrics.proxied++;
      
      // Process articles
      let newCount = 0;
      feedData.items.slice(0, 10).forEach(item => {
        const id = crypto.createHash('md5')
          .update(`${feed.slug}-${item.link || item.guid}`)
          .digest('hex');
        
        if (!existingIds.has(id)) {
          allArticles.push({
            id,
            title: item.title || 'Untitled',
            link: item.link || item.guid,
            pubDate: item.pubDate || new Date().toISOString(),
            source: feed.name,
            sourceSlug: feed.slug,
            category: feed.category,
            author: item.creator || item.author || feed.defaultAuthor || feed.name,
            description: (item.contentSnippet || '').substring(0, 200)
          });
          existingIds.add(id);
          newCount++;
        }
      });
      
      console.log(`  → ${newCount} new articles`);
      
    } catch (error) {
      console.log(`  ✗ Failed: ${error.message}`);
      metrics.failed++;
    }
    
    // Rate limiting
    const delay = isSubstack ? 
      Math.random() * 30000 + 15000 : // 15-45 seconds for Substack
      5000; // 5 seconds for others
    
    if (i < feeds.length - 1) {
      await fetcher.delay(delay);
    }
  }
  
  // Merge and save
  const merged = [...allArticles, ...existingArticles]
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, 500);
  
  await fs.writeFile(articlesPath, JSON.stringify(merged, null, 2));
  
  console.log('\n=== Summary ===');
  console.log(`Successful: ${metrics.successful}/${metrics.total}`);
  console.log(`Failed: ${metrics.failed}`);
  console.log(`Used proxy: ${metrics.proxied}`);
  console.log(`New articles: ${allArticles.length}`);
  
  return merged;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchAllFeeds()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}