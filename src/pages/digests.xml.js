import fs from 'fs';
import path from 'path';

export async function GET() {
  // Load digests
  let digests = [];
  try {
    const digestsPath = path.join(process.cwd(), 'data', 'digests.json');
    if (fs.existsSync(digestsPath)) {
      const data = JSON.parse(fs.readFileSync(digestsPath, 'utf-8'));
      digests = Array.isArray(data) ? data : (data.digests || []);
    }
  } catch (error) {
    console.warn('Could not load digests:', error);
  }

  // Take only the latest 20 digests for the feed
  const recentDigests = digests.slice(0, 20);

  // Generate RSS items
  const items = recentDigests.map(digest => {
    // Create HTML content for the digest
    const content = `
      <h2>${digest.subtitle}</h2>
      ${digest.description ? `<p><em>${digest.description}</em></p>` : ''}
      <p>Here are ${digest.articles.length} randomly selected articles for your reading pleasure:</p>
      <ol>
        ${digest.articles.map((article, index) => `
          <li>
            <strong><a href="${article.url}">${article.title}</a></strong><br/>
            <em>${article.publication.name} - ${article.publication.category}</em><br/>
            ${article.excerpt}<br/>
            <small>By ${article.author} • ${article.readTime} min read</small>
          </li>
        `).join('\n')}
      </ol>
    `;

    return `
      <item>
        <title>${digest.title}</title>
        <link>https://papertrails.com/digest/${digest.id}</link>
        <guid isPermaLink="false">${digest.id}</guid>
        <description><![CDATA[${digest.subtitle}]]></description>
        <content:encoded><![CDATA[${content}]]></content:encoded>
        <pubDate>${new Date(digest.createdAt).toUTCString()}</pubDate>
        <category>Random Digest</category>
      </item>
    `;
  }).join('\n');

  // Generate RSS feed
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Paper Trails - Random Digest</title>
    <link>https://papertrails.com/digests</link>
    <atom:link href="https://papertrails.com/digests.xml" rel="self" type="application/rss+xml"/>
    <description>Bi-weekly curated digests of random articles from Paper Trails. Discover hidden gems from our collection.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Paper Trails Digest Generator</generator>
    <ttl>360</ttl>
    <image>
      <url>https://papertrails.com/favicon-512x512.png</url>
      <title>Paper Trails - Random Digest</title>
      <link>https://papertrails.com/digests</link>
    </image>
    ${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}