import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Load digests
    const digestsPath = path.join(process.cwd(), 'data', 'digests.json');
    
    if (!fs.existsSync(digestsPath)) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    const data = JSON.parse(fs.readFileSync(digestsPath, 'utf-8'));
    const digests = Array.isArray(data) ? data : (data.digests || []);
    
    // Return only basic digest info (id, title, createdAt) for random selection
    const digestList = digests.map(digest => ({
      id: digest.id,
      title: digest.title,
      createdAt: digest.createdAt
    }));

    return new Response(JSON.stringify(digestList), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
      }
    });
    
  } catch (error) {
    console.error('Error loading digests:', error);
    return new Response(JSON.stringify([]), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}