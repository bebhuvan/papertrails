import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load articles from JSON file - LIMIT FOR PRODUCTION BUILD
export function getArticles() {
  const articlesPath = path.join(process.cwd(), 'data', 'articles.json');
  const articlesData = JSON.parse(fs.readFileSync(articlesPath, 'utf-8'));
  
  // For Cloudflare Pages deployment, limit to most recent 100 articles
  // to avoid build timeout
  const ARTICLE_LIMIT = process.env.ARTICLE_LIMIT ? parseInt(process.env.ARTICLE_LIMIT) : 100;
  
  return articlesData
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, ARTICLE_LIMIT);
}

// Get unique categories from articles
export function getCategories() {
  const articles = getArticles();
  const categories = new Set();
  
  articles.forEach(article => {
    categories.add(article.publication.category);
  });
  
  return Array.from(categories).sort();
}

// Get unique publications
export function getPublications() {
  const articles = getArticles();
  const publicationsMap = new Map();
  
  articles.forEach(article => {
    const pubSlug = article.publication.slug;
    if (!publicationsMap.has(pubSlug)) {
      publicationsMap.set(pubSlug, article.publication);
    }
  });
  
  return Array.from(publicationsMap.values());
}