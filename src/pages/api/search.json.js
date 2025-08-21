import { getArticles } from '../../lib/data';

// This endpoint needs to be server-rendered to access query parameters
export const prerender = false;

export async function GET({ url }) {
  const query = url.searchParams.get('q')?.toLowerCase().trim();
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  
  if (!query || query.length < 2) {
    return new Response(JSON.stringify({ 
      results: [], 
      query: query || '',
      total: 0 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  const allArticles = getArticles();
  
  // Search in title, excerpt, author, and publication name
  const results = allArticles
    .filter(article => {
      const searchFields = [
        article.title,
        article.excerpt,
        article.author,
        article.publication.name
      ].join(' ').toLowerCase();
      
      return searchFields.includes(query);
    })
    .slice(0, limit)
    .map(article => ({
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
    results,
    query,
    total: results.length
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300' // 5 minute cache
    }
  });
}