import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const feedsPath = path.join(process.cwd(), 'data', 'feeds.json');
    const feedsData = fs.readFileSync(feedsPath, 'utf-8');
    const feeds = JSON.parse(feedsData);
    
    return new Response(JSON.stringify(feeds), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to load feeds' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}