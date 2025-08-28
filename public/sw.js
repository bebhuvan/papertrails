const CACHE_NAME = 'paper-trails-v3';
const STATIC_CACHE = 'paper-trails-static-v3';
const DYNAMIC_CACHE = 'paper-trails-dynamic-v3';

// Cache duration in milliseconds (30 minutes for dynamic content)
const DYNAMIC_CACHE_DURATION = 30 * 60 * 1000;

// Static resources to cache (only essential assets)
const staticResources = [
  '/manifest.json',
  '/favicon.svg',
  '/favicon-192x192.png',
  '/favicon-512x512.png'
];

// Dynamic content patterns (articles, categories, etc.)
const dynamicPatterns = [
  /^\/$/,
  /^\/article\//,
  /^\/publication\//,
  /^\/digest\//,
  /^\/[a-z]+$/,  // category pages
  /^\/api\//
];

// Check if URL matches dynamic content patterns
function isDynamicContent(url) {
  return dynamicPatterns.some(pattern => pattern.test(url.pathname));
}

// Check if cached response is still fresh
function isCacheFresh(response) {
  if (!response) return false;
  
  const cachedDate = response.headers.get('sw-cached-date');
  if (!cachedDate) return false;
  
  const cacheTime = new Date(cachedDate).getTime();
  const now = Date.now();
  
  return (now - cacheTime) < DYNAMIC_CACHE_DURATION;
}

// Add timestamp header to response
function addCacheTimestamp(response) {
  const responseClone = response.clone();
  const headers = new Headers(responseClone.headers);
  headers.set('sw-cached-date', new Date().toISOString());
  
  return new Response(responseClone.body, {
    status: responseClone.status,
    statusText: responseClone.statusText,
    headers: headers
  });
}

// Install event - cache only static resources
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Caching static resources');
        return cache.addAll(staticResources);
      })
      .then(() => {
        console.log('Static resources cached');
        return self.skipWaiting();
      })
  );
});

// Fetch event - improved caching strategy
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Handle static resources with cache-first strategy
  if (staticResources.includes(url.pathname)) {
    event.respondWith(
      caches.match(request, { cacheName: STATIC_CACHE })
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(request).then((response) => {
            if (response.ok) {
              caches.open(STATIC_CACHE).then((cache) => {
                cache.put(request, response.clone());
              });
            }
            return response;
          });
        })
    );
    return;
  }
  
  // Handle dynamic content with network-first + smart caching
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html') || isDynamicContent(url)) {
    event.respondWith(
      fetch(request, { 
        cache: 'no-cache',  // Force fresh network request
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      })
        .then((response) => {
          if (response.ok) {
            // Cache the fresh response with timestamp
            const responseToCache = addCacheTimestamp(response.clone());
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Network failed, try cache but only if it's relatively fresh
          return caches.match(request, { cacheName: DYNAMIC_CACHE })
            .then((cachedResponse) => {
              if (cachedResponse && isCacheFresh(cachedResponse)) {
                console.log('Serving fresh cached content for:', url.pathname);
                return cachedResponse;
              }
              
              // If no fresh cache, try to serve any cached version with a warning
              if (cachedResponse) {
                console.log('Serving stale cached content for:', url.pathname);
                return cachedResponse;
              }
              
              // Last resort: serve offline page or home page
              return caches.match('/', { cacheName: DYNAMIC_CACHE }) || 
                     new Response('Offline - Please check your connection', {
                       status: 503,
                       headers: { 'Content-Type': 'text/plain' }
                     });
            });
        })
    );
    return;
  }
  
  // Handle other assets (images, etc.) with cache-first but allow updates
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // Return cached version immediately
        if (cachedResponse) {
          // But also try to update in background
          fetch(request).then((response) => {
            if (response.ok) {
              caches.open(DYNAMIC_CACHE).then((cache) => {
                cache.put(request, response.clone());
              });
            }
          }).catch(() => {
            // Ignore network errors for background updates
          });
          
          return cachedResponse;
        }
        
        // No cache, fetch from network
        return fetch(request).then((response) => {
          if (response.ok) {
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, response.clone());
            });
          }
          return response;
        });
      })
  );
});

// Activate event - clean up old caches and take control immediately
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old cache versions
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Old caches cleaned up');
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

// Listen for messages from the main thread to force cache refresh
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FORCE_REFRESH') {
    console.log('Force refresh requested, clearing dynamic cache');
    caches.delete(DYNAMIC_CACHE).then(() => {
      console.log('Dynamic cache cleared');
      // Notify all clients to reload
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'CACHE_CLEARED' });
        });
      });
    });
  }
});