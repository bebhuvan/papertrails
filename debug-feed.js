#!/usr/bin/env node
import fs from 'fs/promises';
import fetch from 'node-fetch';

async function debugFeed(url) {
  console.log(`\n=== Debugging ${url} ===`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    console.log('Status:', response.status);
    console.log('Headers:', Object.fromEntries(response.headers));
    
    const text = await response.text();
    console.log('Content length:', text.length);
    console.log('First 200 chars:', text.substring(0, 200));
    console.log('Content type:', response.headers.get('content-type'));
    
  } catch (error) {
    console.log('Error:', error.message);
  }
}

// Load feeds and test a few
async function main() {
  const feedsData = await fs.readFile('data/feeds.json', 'utf-8');
  const feeds = JSON.parse(feedsData);
  
  const testFeeds = [
    feeds.find(f => f.name === 'Aeon'),
    feeds.find(f => f.name === 'Adam Tooze'),
    feeds.find(f => f.name === 'AI Log Blog')
  ].filter(Boolean);
  
  for (const feed of testFeeds) {
    await debugFeed(feed.url);
  }
}

main().catch(console.error);