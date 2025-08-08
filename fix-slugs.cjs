const fs = require('fs');

const data = JSON.parse(fs.readFileSync('data/articles.json', 'utf-8'));

function generateSlug(title, id) {
  if (!title || title.trim() === '') {
    return 'untitled-' + id;
  }
  
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
    
  return slug || 'untitled-' + id;
}

let fixedCount = 0;
data.articles = data.articles.map(article => {
  if (!article.slug || article.slug.trim() === '') {
    fixedCount++;
    return {
      ...article,
      slug: generateSlug(article.title, article.id)
    };
  }
  return article;
});

fs.writeFileSync('data/articles.json', JSON.stringify(data, null, 2));
console.log(`Fixed ${fixedCount} articles with empty slugs`);