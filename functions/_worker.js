// Worker to serve static Astro site and proxy RSS feeds
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Handle RSS proxy endpoint
    if (url.pathname === '/api/fetch-rss') {
      return handleRssProxy(request);
    }
    
    // Handle static site serving
    return handleStaticSite(request, env);
  },
};

// RSS Proxy handler (inline to avoid import issues)
async function handleRssProxy(request) {
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
    return new Response(JSON.stringify({ error: 'Missing feed URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
  
  try {
    const feedResponse = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    
    if (!feedResponse.ok) {
      return new Response(JSON.stringify({ 
        error: `Failed to fetch: ${feedResponse.status}`,
        status: feedResponse.status,
      }), {
        status: feedResponse.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    
    const content = await feedResponse.text();
    return new Response(content, {
      headers: {
        'Content-Type': feedResponse.headers.get('Content-Type') || 'application/xml',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Fetch failed', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

// Static site handler
async function handleStaticSite(request, env) {
  try {
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      const indexRequest = new Request(new URL('/index.html', request.url), request);
      response = await env.ASSETS.fetch(indexRequest);
    }
    return response;
  } catch (e) {
    return new Response('Not found', { status: 404 });
  }
}