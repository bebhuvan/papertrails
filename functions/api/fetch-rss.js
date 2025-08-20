// Cloudflare Pages Function for RSS proxy
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  
  const feedUrl = url.searchParams.get('url');
  if (!feedUrl) {
    return new Response(JSON.stringify({ error: 'Missing feed URL parameter' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
    });
  }
  
  try {
    console.log(`Fetching RSS feed: ${feedUrl}`);
    
    const feedResponse = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });
    
    if (!feedResponse.ok) {
      console.error(`Feed fetch failed: ${feedResponse.status} ${feedResponse.statusText}`);
      return new Response(JSON.stringify({ 
        error: `Failed to fetch RSS feed`,
        status: feedResponse.status,
        statusText: feedResponse.statusText,
        url: feedUrl
      }), {
        status: feedResponse.status,
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*' 
        },
      });
    }
    
    const content = await feedResponse.text();
    console.log(`Successfully fetched ${content.length} bytes from ${feedUrl}`);
    
    return new Response(content, {
      headers: {
        'Content-Type': feedResponse.headers.get('Content-Type') || 'application/xml',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
    
  } catch (error) {
    console.error(`RSS proxy error for ${feedUrl}:`, error);
    return new Response(JSON.stringify({ 
      error: 'RSS fetch failed',
      details: error.message,
      url: feedUrl
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      },
    });
  }
}