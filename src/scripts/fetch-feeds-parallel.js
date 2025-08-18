#!/usr/bin/env node
// Parallel RSS feed fetcher for GitHub Actions workflows
// Handles merge conflicts and coordination between multiple runners

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function parallelFetch() {
  console.log('=== Parallel Feed Fetcher ===\n');
  
  // Get configuration from environment
  const workflowFeeds = JSON.parse(process.env.WORKFLOW_FEEDS || '[]');
  const baseDelay = parseInt(process.env.BASE_DELAY || '10') * 1000;
  const workflowName = process.env.WORKFLOW_NAME || 'unknown';
  
  console.log(`Workflow: ${workflowName}`);
  console.log(`Feeds to process: ${workflowFeeds.length}`);
  console.log(`Base delay: ${baseDelay/1000}s`);
  console.log('');
  
  if (workflowFeeds.length === 0) {
    console.log('No feeds to process');
    return { articles: [], success: 0, failed: 0 };
  }
  
  // Use existing fetch logic but with custom feed list
  const originalFetch = await import('./fetch-feeds-local.js');
  
  // Override the feed loading to use our subset
  const fetchResults = await runWithCustomFeeds(workflowFeeds, baseDelay, workflowName);
  
  return fetchResults;
}

async function runWithCustomFeeds(feeds, baseDelay, workflowName) {
  console.log(`Processing ${feeds.length} feeds for ${workflowName}...`);
  
  // Import RSS parser
  const Parser = (await import('rss-parser')).default;
  
  const results = {
    articles: [],
    successful: 0,
    failed: 0,
    failedFeeds: []
  };
  
  // Load existing articles with proper merge handling
  const { existingArticles, articlesChanged } = await loadExistingArticles();
  const existingIds = new Set(existingArticles.map(a => a.id));
  
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const isSubstack = feed.url.includes('substack.com');
    const delay = isSubstack ? baseDelay * 2 : baseDelay; // Extra delay for Substack
    
    console.log(`[${i + 1}/${feeds.length}] Fetching ${feed.name}...`);
    
    try {
      const parser = new Parser({
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader; +https://github.com)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          // No Accept-Encoding to avoid compression issues
        }
      });
      
      const result = await parser.parseURL(feed.url);
      console.log(`  ✅ Success: ${result.items.length} items`);
      results.successful++;
      
      // Process articles
      let newCount = 0;
      for (const item of result.items.slice(0, 10)) {
        const id = await generateArticleId(item, feed);
        
        if (!existingIds.has(id)) {
          const content = item.contentSnippet || item.content || item.description || '';
          
          results.articles.push({
            title: item.title || 'Untitled',
            link: item.link || item.guid,
            author: item.creator || item.author || feed.defaultAuthor || feed.name,
            publishedAt: item.pubDate || new Date().toISOString(),
            content: content.substring(0, 300),
            excerpt: content.substring(0, 200),
            id: id.substring(0, 8),
            wordCount: content.split(/\s+/).length,
            readTime: Math.max(1, Math.ceil(content.split(/\s+/).length / 200)),
            isPaid: false,
            publication: {
              name: feed.name,
              slug: feed.slug,
              category: feed.category
            },
            slug: generateSlug(item.title || 'untitled')
          });
          
          existingIds.add(id);
          newCount++;
        }
      }
      
      console.log(`  → Added ${newCount} new articles`);
      
    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}`);
      results.failed++;
      results.failedFeeds.push({
        name: feed.name,
        url: feed.url,
        error: error.message
      });
    }
    
    // Delay between requests
    if (i < feeds.length - 1) {
      const waitTime = delay + Math.random() * 2000; // Add randomness
      console.log(`  ⏱ Waiting ${Math.round(waitTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  // Merge with existing articles if we have new ones
  if (results.articles.length > 0) {
    await mergeArticles(existingArticles, results.articles, workflowName);
  }
  
  console.log(`\n=== ${workflowName} Complete ===`);
  console.log(`Successful: ${results.successful}/${feeds.length}`);
  console.log(`New articles: ${results.articles.length}`);
  
  return results;
}

async function loadExistingArticles() {
  const articlesPath = path.join(__dirname, '../../data/articles.json');
  
  try {
    // Pull latest changes to avoid conflicts
    try {
      await execAsync('git pull --rebase origin main', {
        cwd: path.join(__dirname, '../../')
      });
      console.log('✓ Pulled latest changes');
    } catch (pullError) {
      console.log('⚠ Could not pull (probably no conflicts)');
    }
    
    const articlesData = await fs.readFile(articlesPath, 'utf-8');
    const articleData = JSON.parse(articlesData);
    const existingArticles = articleData.articles || [];
    
    return { existingArticles, articlesChanged: false };
  } catch (error) {
    console.log('No existing articles found, starting fresh');
    return { existingArticles: [], articlesChanged: false };
  }
}

async function mergeArticles(existingArticles, newArticles, workflowName) {
  const articlesPath = path.join(__dirname, '../../data/articles.json');
  
  // Merge and sort by date
  const mergedArticles = [...newArticles, ...existingArticles]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 500); // Keep only recent articles
  
  const articlesData = { articles: mergedArticles };
  
  await fs.writeFile(articlesPath, JSON.stringify(articlesData, null, 2));
  console.log(`✓ Merged ${newArticles.length} new articles (${workflowName})`);
}

async function generateArticleId(item, feed) {
  const crypto = await import('crypto');
  const uniqueString = `${feed.slug}-${item.link || item.guid || item.title}`;
  return crypto.createHash('md5').update(uniqueString).digest('hex');
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

// Run the parallel fetcher
parallelFetch()
  .then(results => {
    console.log(`\n🎉 Parallel fetch complete: ${results.successful} successful, ${results.failed} failed`);
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });