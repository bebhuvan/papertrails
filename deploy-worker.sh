#!/bin/bash

echo "=== Deploying Paper Trails Worker with RSS Proxy ==="
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Installing..."
    npm install -g wrangler
fi

# Check if logged in
echo "Checking Cloudflare authentication..."
wrangler whoami || {
    echo "❌ Not logged in to Cloudflare"
    echo "Please run: wrangler login"
    exit 1
}

echo ""
echo "📦 Building the project..."
npm run build

echo ""
echo "🚀 Deploying to Cloudflare Pages with Functions..."

# Deploy to Cloudflare Pages (includes the worker function)
wrangler pages deploy dist --project-name=substack-curator

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Your worker proxy endpoint will be available at:"
echo "https://papertrails.rabbitholes.garden/api/fetch-rss"
echo ""
echo "To test the proxy:"
echo "curl 'https://papertrails.rabbitholes.garden/api/fetch-rss?url=https://adamtooze.substack.com/feed'"
echo ""
echo "Next steps:"
echo "1. Add WORKER_URL secret to GitHub: https://papertrails.rabbitholes.garden"
echo "2. Run the workflow manually to test"
echo "3. Monitor success rate in GitHub Actions"