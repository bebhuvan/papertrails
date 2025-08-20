import fs from 'fs';
import path from 'path';

let cachedArticles = null;

export function getArticles() {
  if (cachedArticles) {
    return cachedArticles;
  }

  try {
    const dataPath = path.join(process.cwd(), 'data', 'articles.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    // Handle both array format and object format
    cachedArticles = Array.isArray(data) ? data : (data.articles || []);
    return cachedArticles;
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