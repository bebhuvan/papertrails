import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DIGEST_SIZE = 10; // Number of articles per digest
const MAX_AGE_DAYS = 30; // Only consider articles from last 30 days

// Get current timestamp
const now = new Date();
const cutoffDate = new Date(now.getTime() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000));

// Function to shuffle array (Fisher-Yates algorithm)
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Function to get diverse articles (ensures reasonable representation across categories)
function getDiverseSelection(articles, count) {
  // Group articles by category
  const byCategory = {};
  articles.forEach(article => {
    const category = article.publication?.category || 'Uncategorized';
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(article);
  });

  const selected = [];
  const categories = Object.keys(byCategory).sort(); // Sort for consistency
  
  // Calculate target articles per category for balanced representation
  const categoriesWithContent = categories.filter(cat => byCategory[cat].length > 0);
  const basePerCategory = Math.floor(count / categoriesWithContent.length);
  const remainder = count % categoriesWithContent.length;
  
  // First pass: ensure each category gets at least one article (if we have enough slots)
  let remainingSlots = count;
  const categoryAllocations = {};
  
  categoriesWithContent.forEach((category, index) => {
    // Give each category at least 1, then distribute remainder to first few categories
    let allocation = Math.min(basePerCategory, byCategory[category].length);
    if (index < remainder) {
      allocation = Math.min(allocation + 1, byCategory[category].length);
    }
    // Ensure we don't allocate more than available articles in category
    allocation = Math.min(allocation, remainingSlots);
    
    categoryAllocations[category] = allocation;
    remainingSlots -= allocation;
  });
  
  // Second pass: if we have remaining slots, distribute them proportionally
  while (remainingSlots > 0 && categoriesWithContent.length > 0) {
    let distributed = false;
    for (const category of categoriesWithContent) {
      if (remainingSlots > 0 && 
          categoryAllocations[category] < byCategory[category].length) {
        categoryAllocations[category]++;
        remainingSlots--;
        distributed = true;
      }
    }
    if (!distributed) break; // No more articles available to distribute
  }
  
  // Select articles based on allocations
  categoriesWithContent.forEach(category => {
    const allocation = categoryAllocations[category];
    const availableArticles = shuffleArray([...byCategory[category]]);
    
    for (let i = 0; i < allocation && i < availableArticles.length; i++) {
      selected.push(availableArticles[i]);
    }
  });

  console.log(`📊 Category distribution: ${Object.entries(categoryAllocations)
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(', ')}`);

  return shuffleArray(selected); // Final shuffle for variety
}

// Generate digest
function generateDigest() {
  try {
    // Read articles
    const articlesPath = path.join(__dirname, '../../data/articles.json');
    const articlesData = JSON.parse(fs.readFileSync(articlesPath, 'utf-8'));
    let articles = Array.isArray(articlesData) ? articlesData : (articlesData.articles || []);

    // Filter for recent articles only
    const recentArticles = articles.filter(article => {
      const articleDate = new Date(article.publishedAt);
      return articleDate >= cutoffDate;
    });

    console.log(`Found ${recentArticles.length} articles from the last ${MAX_AGE_DAYS} days`);

    if (recentArticles.length < DIGEST_SIZE) {
      console.warn(`Not enough recent articles. Using all available articles.`);
    }

    // Select diverse articles
    const selectedArticles = getDiverseSelection(
      recentArticles.length >= DIGEST_SIZE ? recentArticles : articles,
      DIGEST_SIZE
    );

    // Create digest object
    const digest = {
      id: `digest-${now.toISOString().split('T')[0]}-${Date.now()}`,
      title: `Random Digest: ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      subtitle: `${DIGEST_SIZE} hand-picked articles from our collection`,
      description: `This digest was algorithmically curated to spark serendipity and encourage intellectual wandering. Each article was chosen at random from our recent collection, creating unexpected connections and delightful discoveries across diverse topics and perspectives.`,
      createdAt: now.toISOString(),
      articles: selectedArticles.map(article => ({
        id: article.id,
        title: article.title,
        excerpt: article.excerpt,
        author: article.author,
        publication: article.publication,
        publishedAt: article.publishedAt,
        readTime: article.readTime,
        wordCount: article.wordCount,
        url: article.link
      }))
    };

    // Read existing digests
    const digestsPath = path.join(__dirname, '../../data/digests.json');
    let digests = [];
    
    if (fs.existsSync(digestsPath)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(digestsPath, 'utf-8'));
        digests = Array.isArray(existingData) ? existingData : (existingData.digests || []);
      } catch (e) {
        console.log('Creating new digests file');
      }
    }

    // Add new digest to beginning
    digests.unshift(digest);

    // Keep only last 50 digests
    if (digests.length > 50) {
      digests = digests.slice(0, 50);
    }

    // Save digests
    fs.writeFileSync(digestsPath, JSON.stringify(digests, null, 2));
    
    console.log(`✅ Generated digest with ${selectedArticles.length} articles`);
    console.log(`📁 Saved to: ${digestsPath}`);
    
    // Log categories included
    const categories = [...new Set(selectedArticles.map(a => a.publication?.category || 'Uncategorized'))];
    console.log(`📚 Categories included: ${categories.join(', ')}`);

    return digest;

  } catch (error) {
    console.error('Error generating digest:', error);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  generateDigest();
}

export { generateDigest };