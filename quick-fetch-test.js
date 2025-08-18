#!/usr/bin/env node
import fs from 'fs/promises';
import Parser from 'rss-parser';
import crypto from 'crypto';

async function quickFetch() {
  // Load feeds
  const feedsData = await fs.readFile('data/feeds.json', 'utf-8');
  const feeds = JSON.parse(feedsData);
  
  // Get first 5 non-Substack feeds
  const nonSubstack = feeds.filter(f => !f.url.includes('substack.com'));
  const testFeeds = nonSubstack.slice(0, 5);
  
  console.log('Testing feeds:', testFeeds.map(f => f.name));
  
  const parser = new Parser({
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml',
      'Accept-Encoding': 'gzip, deflate, br'
    }
  });
  
  const articles = [];
  
  for (const feed of testFeeds) {
    console.log(`\nFetching ${feed.name}...`);
    try {
      const result = await parser.parseURL(feed.url);
      console.log(`✅ Success: ${result.items.length} items`);
      
      result.items.slice(0, 3).forEach(item => {
        const id = crypto.createHash('md5')
          .update(`${feed.slug}-${item.link || item.guid}`)
          .digest('hex');
        
        articles.push({
          id,
          title: item.title || 'Untitled',
          link: item.link || item.guid,
          pubDate: item.pubDate || new Date().toISOString(),
          source: feed.name,
          sourceSlug: feed.slug,
          category: feed.category,
          author: item.creator || item.author || feed.defaultAuthor || feed.name,
          description: (item.contentSnippet || item.content || '').substring(0, 200)
        });
      });
      
    } catch (error) {
      console.log(`❌ Failed: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\nTotal articles collected: ${articles.length}`);
  
  if (articles.length > 0) {
    // Save to file
    const existingPath = 'data/articles.json';
    let existing = [];
    try {
      const existingData = await fs.readFile(existingPath, 'utf-8');
      existing = JSON.parse(existingData);
      if (!Array.isArray(existing)) {
        existing = [];
      }
    } catch (e) {
      existing = [];
    }
    
    const merged = [...articles, ...existing]
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
      .slice(0, 500);
    
    await fs.writeFile(existingPath, JSON.stringify(merged, null, 2));
    console.log(`✅ Saved ${merged.length} articles to ${existingPath}`);
    
    return true;
  }
  
  return false;
}

quickFetch()
  .then(success => {
    if (success) {
      console.log('\n🎉 Ready to commit and push!');
    } else {
      console.log('\n😞 No articles fetched');
    }
  })
  .catch(console.error);