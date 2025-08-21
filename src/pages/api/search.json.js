import { getArticles } from '../../lib/data';

// Static API endpoint - generates all articles in searchable format
export async function GET() {
  const allArticles = getArticles();
  
  // Return all articles in optimized format for client-side search
  const searchData = allArticles.map(article => ({
    id: article.id,
    title: article.title,
    excerpt: article.excerpt.substring(0, 200),
    author: article.author,
    publishedAt: article.publishedAt,
    readTime: article.readTime,
    wordCount: article.wordCount,
    publication: {
      name: article.publication.name,
      slug: article.publication.slug,
      category: article.publication.category
    },
    isPaid: article.isPaid
  }));

  return new Response(JSON.stringify({
    articles: searchData,
    total: searchData.length
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600' // 1 hour cache
    }
  });
}