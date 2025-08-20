import rss from '@astrojs/rss';
import { getArticles } from '../lib/data';

export async function GET(context) {
  const articles = getArticles();
  
  // Sort articles by date (newest first) and take first 50
  const recentArticles = articles
    .filter(article => article.publication && article.publication.name) // Filter out invalid articles
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 50);

  return rss({
    title: 'Paper Trails',
    description: 'The best writing from the smartest minds—from economics to philosophy, technology to culture',
    site: context.site || 'https://papertrails.com',
    items: recentArticles.map((article) => ({
      title: article.title,
      description: article.excerpt,
      pubDate: new Date(article.publishedAt),
      link: `/article/${article.id}`, // Use id instead of slug
      author: `${article.author} (${article.publication.name})`,
      categories: [article.publication.category],
    })),
    customData: `<language>en-us</language>`,
  });
}