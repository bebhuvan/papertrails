#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Parser from 'rss-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== Simple Fetch Test ===');
console.log('Working dir:', process.cwd());
console.log('Script dir:', __dirname);

async function test() {
  try {
    // Load feeds
    const feedsPath = path.join(__dirname, 'data/feeds.json');
    console.log('Reading feeds from:', feedsPath);
    
    const feedsData = await fs.readFile(feedsPath, 'utf-8');
    const feeds = JSON.parse(feedsData);
    
    console.log(`Loaded ${feeds.length} feeds`);
    
    // Test first 3 feeds
    const testFeeds = feeds.slice(0, 3);
    console.log('Testing feeds:', testFeeds.map(f => f.name));
    
    const parser = new Parser({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    for (const feed of testFeeds) {
      console.log(`\nFetching: ${feed.name}`);
      try {
        const result = await parser.parseURL(feed.url);
        console.log(`✅ Success: ${result.items.length} articles`);
      } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
      }
    }
    
    console.log('\n=== Test Complete ===');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

test();