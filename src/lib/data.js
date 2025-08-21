import fs from 'fs';
import path from 'path';

// Decode HTML entities in text
function decodeHtmlEntities(text) {
  if (!text || typeof text !== 'string') return text;
  
  return text
    .replace(/&#8220;/g, '"') // Left curly quote
    .replace(/&#8221;/g, '"') // Right curly quote
    .replace(/&#8217;/g, "'") // Right curly apostrophe
    .replace(/&#8216;/g, "'") // Left curly apostrophe
    .replace(/&#8230;/g, '…') // Ellipsis
    .replace(/&#8211;/g, '–') // En dash
    .replace(/&#8212;/g, '—') // Em dash
    .replace(/&amp;/g, '&')    // Ampersand
    .replace(/&lt;/g, '<')     // Less than
    .replace(/&gt;/g, '>')     // Greater than
    .replace(/&quot;/g, '"')   // Quote
    .replace(/&#39;/g, "'");   // Apostrophe
}

// Clean article text fields
function cleanArticle(article) {
  return {
    ...article,
    title: decodeHtmlEntities(article.title),
    excerpt: decodeHtmlEntities(article.excerpt),
    content: decodeHtmlEntities(article.content)
  };
}

export function getArticles() {
  try {
    const dataPath = path.join(process.cwd(), 'data', 'articles.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    // Handle both array format and object format
    let articles = Array.isArray(data) ? data : (data.articles || []);
    
    // Clean HTML entities from article text
    articles = articles.map(cleanArticle);
    
    // Sort articles by date (newest first)
    articles.sort((a, b) => {
      const dateA = new Date(a.publishedAt);
      const dateB = new Date(b.publishedAt);
      return dateB - dateA; // Newest first
    });
    
    return articles;
  } catch (error) {
    console.warn('Could not load articles:', error);
    return [];
  }
}

export function getCategories() {
  const articles = getArticles();
  const categories = new Set();
  
  articles.forEach(article => {
    if (article.publication.category) {
      categories.add(article.publication.category);
    }
  });
  
  return Array.from(categories).sort();
}

export function getArticlesByCategory(category) {
  if (category === 'All') {
    return getArticles();
  }
  
  return getArticles().filter(article => 
    article.publication.category === category
  );
}