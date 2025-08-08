// Worker to serve static Astro site
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Serve static assets from the built Astro site
    try {
      // Try to fetch the requested path
      let response = await env.ASSETS.fetch(request);
      
      // If 404, try serving index.html for client-side routing
      if (response.status === 404) {
        const indexRequest = new Request(new URL('/index.html', request.url), request);
        response = await env.ASSETS.fetch(indexRequest);
      }
      
      return response;
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  },
};