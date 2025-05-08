#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const moment = require('moment');

// Load page-specific metadata configuration
let metadataConfig;
try {
  const configPath = path.join(__dirname, 'page-metadata.json');
  if (fs.existsSync(configPath)) {
    metadataConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('Loaded page-specific metadata configuration');
  } else {
    console.log('No page-metadata.json found, using default settings');
    metadataConfig = { 
      global: {
        defaultDomain: 'https://dzovah.com',
        defaultTitle: 'Dzovah',
        defaultDescription: 'Driving innovation by seamlessly integrating new ideas with the richness of what already exists.',
        defaultKeywords: 'innovation, technology, integration',
        defaultImage: '/Branding/logo/logo001.png',
        socialMedia: {
          instagram: 'https://instagram.com/dzovah._',
          twitter: 'https://x.com/dzovah'
        }
      },
      pages: {},
      patterns: []
    };
  }
} catch (err) {
  console.error('Error loading metadata configuration:', err);
  process.exit(1);
}

// Extract global config
const config = {
  ...metadataConfig.global,
  backupFiles: true,
  generateSitemap: true,
  addOpenGraph: true,
  addTwitterCards: true,
  addStructuredData: true
};

// Create backup directory if backups are enabled
const backupDir = path.join(__dirname, 'seo-backups', moment().format('YYYY-MM-DD_HH-mm-ss'));
if (config.backupFiles) {
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`Backup directory created: ${backupDir}`);
}

// Track all pages for sitemap generation
const sitemapPages = [];

/**
 * Get metadata for a specific file path
 * @param {string} filePath - The path to the HTML file
 * @returns {object} - The merged metadata for this page
 */
function getPageMetadata(filePath) {
  // Start with global defaults
  const metadata = {
    title: config.defaultTitle,
    description: config.defaultDescription,
    keywords: config.defaultKeywords,
    priority: '0.5',
    ogType: 'website',
    image: config.defaultImage
  };
  
  // Get the relative path for easier matching
  const relPath = path.relative(__dirname, filePath).replace(/\\/g, '/');
  
  // Check for exact page match
  if (metadataConfig.pages && metadataConfig.pages[relPath]) {
    return { ...metadata, ...metadataConfig.pages[relPath] };
  }
  
  // If no exact match, check for directory match (ending with /)
  const dirPath = path.dirname(relPath) + '/';
  if (metadataConfig.pages && metadataConfig.pages[dirPath]) {
    return { ...metadata, ...metadataConfig.pages[dirPath] };
  }
  
  // Check for pattern matches
  if (metadataConfig.patterns && metadataConfig.patterns.length > 0) {
    for (const patternConfig of metadataConfig.patterns) {
      const regex = new RegExp(patternConfig.pattern);
      if (regex.test(relPath)) {
        return { ...metadata, ...patternConfig.metadata };
      }
    }
  }
  
  // Fall back to defaults if no matches
  return metadata;
}

/**
 * Extract content-based metadata from the HTML
 * @param {CheerioStatic} $ - Cheerio document
 * @returns {object} - Metadata extracted from content
 */
function extractContentMetadata($) {
  const metadata = {};
  
  // Extract title from content if available
  const pageTitle = $('title').text();
  if (pageTitle) {
    metadata.title = pageTitle;
  }
  
  // Extract description from existing meta tag if available
  const existingDesc = $('meta[name="description"]').attr('content');
  if (existingDesc) {
    metadata.description = existingDesc;
  }
  
  // Extract keywords from existing meta tag if available
  const existingKeywords = $('meta[name="keywords"]').attr('content');
  if (existingKeywords) {
    metadata.keywords = existingKeywords;
  }
  
  // Extract h1 text as potential title if no title exists
  if (!pageTitle && $('h1').length > 0) {
    metadata.title = $('h1').first().text();
  }
  
  // Try to extract a description from the first paragraph if none exists
  if (!existingDesc && $('p').length > 0) {
    let firstParagraph = $('p').first().text().trim();
    if (firstParagraph.length > 160) {
      firstParagraph = firstParagraph.substring(0, 157) + '...';
    }
    if (firstParagraph) {
      metadata.description = firstParagraph;
    }
  }
  
  // Find the first image as a potential OG image
  if ($('img').length > 0) {
    const imgSrc = $('img').first().attr('src');
    if (imgSrc && !imgSrc.startsWith('data:')) {
      metadata.contentImage = imgSrc.startsWith('http') ? imgSrc : imgSrc.startsWith('/') ? `${config.defaultDomain}${imgSrc}` : `${config.defaultDomain}/${imgSrc}`;
    }
  }
  
  return metadata;
}

/**
 * Generate JSON-LD structured data for a page
 * @param {object} metadata - Page metadata
 * @param {string} url - The full URL of the page
 * @returns {object} - Structured data object
 */
function generateStructuredData(metadata, url) {
  // Start with the schema defined in metadata if available
  if (metadata.schema) {
    const schema = { ...metadata.schema };
    
    // Make sure we have @context
    schema['@context'] = 'https://schema.org';
    
    // For certain schema types, add missing common properties
    if (schema['@type'] === 'BlogPosting') {
      if (!schema.headline) schema.headline = metadata.title;
      if (!schema.description) schema.description = metadata.description;
      if (!schema.url) schema.url = url;
      if (!schema.datePublished && metadata.date) schema.datePublished = metadata.date;
    } else if (schema['@type'] === 'Product') {
      if (!schema.name) schema.name = metadata.title;
      if (!schema.description) schema.description = metadata.description;
    }
    
    return schema;
  }
  
  // Default Organization schema if none specified
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    'name': config.defaultTitle,
    'url': config.defaultDomain,
    'logo': `${config.defaultDomain}${config.defaultImage}`,
    'sameAs': Object.values(config.socialMedia)
  };
}

function walkDir(dir) {
  try {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(dirent => {
      const res = path.resolve(dir, dirent.name);
      if (dirent.isDirectory()) {
        // Skip node_modules and hidden directories
        if (!dirent.name.startsWith('.') && dirent.name !== 'node_modules' && dirent.name !== 'seo-backups') {
          walkDir(res);
        }
      } else if (res.endsWith('.html')) {
        processFile(res);
      }
    });
  } catch (err) {
    console.error(`Error walking directory ${dir}:`, err);
  }
}

function createBackup(filePath) {
  if (!config.backupFiles) return;
  
  try {
    const relativePath = path.relative(__dirname, filePath);
    const backupPath = path.join(backupDir, relativePath);
    
    // Ensure the directory exists
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    
    // Copy the file
    fs.copyFileSync(filePath, backupPath);
  } catch (err) {
    console.error(`Error backing up ${filePath}:`, err);
  }
}

function processFile(filePath) {
  try {
    // Create backup before modifying
    createBackup(filePath);
    
    // Read file content
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Use Cheerio for HTML parsing
    const $ = cheerio.load(content);
    
    // Get the relative path for this file
    const relPath = path.relative(__dirname, filePath).replace(/\\/g, '/');
    
    // Calculate the URL for this page
    const pageUrl = relPath === 'index.html' ? config.defaultDomain : `${config.defaultDomain}/${relPath}`;
    
    // Get page-specific metadata from config
    const configMetadata = getPageMetadata(filePath);
    
    // Extract metadata from content
    const contentMetadata = extractContentMetadata($);
    
    // Merge metadata (config takes precedence over content)
    const metadata = { ...contentMetadata, ...configMetadata };
    
    // Use content image as fallback for image if specified
    if (contentMetadata.contentImage && !configMetadata.image) {
      metadata.image = contentMetadata.contentImage;
    }
    
    // Make sure the image property is a full URL
    if (metadata.image && !metadata.image.startsWith('http')) {
      metadata.image = metadata.image.startsWith('/') 
        ? `${config.defaultDomain}${metadata.image}`
        : `${config.defaultDomain}/${metadata.image}`;
    }
    
    // Add robots meta if missing
    if ($('meta[name="robots"]').length === 0) {
      $('head').append('\n  <meta name="robots" content="index, follow">');
    }
    
    // Add canonical link if missing
    if ($('link[rel="canonical"]').length === 0) {
      $('head').append(`\n  <link rel="canonical" href="${pageUrl}">`);
    }
    
    // Track for sitemap
    if (config.generateSitemap) {
      sitemapPages.push({
        url: pageUrl,
        lastmod: moment(fs.statSync(filePath).mtime).format('YYYY-MM-DD'),
        priority: metadata.priority || '0.5'
      });
    }
    
    // Update or add title if needed
    if ($('title').length === 0) {
      $('head').append(`\n  <title>${metadata.title}</title>`);
    } else if (metadata.title && $('title').text() !== metadata.title) {
      $('title').text(metadata.title);
    }
    
    // Update or add description
    if ($('meta[name="description"]').length === 0) {
      $('head').append(`\n  <meta name="description" content="${metadata.description}">`);
    } else if (metadata.description) {
      $('meta[name="description"]').attr('content', metadata.description);
    }
    
    // Update or add keywords
    if ($('meta[name="keywords"]').length === 0) {
      $('head').append(`\n  <meta name="keywords" content="${metadata.keywords}">`);
    } else if (metadata.keywords) {
      $('meta[name="keywords"]').attr('content', metadata.keywords);
    }
    
    // Add Open Graph tags if enabled
    if (config.addOpenGraph) {
      if ($('meta[property="og:title"]').length === 0) {
        $('head').append(`\n  <meta property="og:title" content="${metadata.title}">`);
      } else {
        $('meta[property="og:title"]').attr('content', metadata.title);
      }
      
      if ($('meta[property="og:description"]').length === 0) {
        $('head').append(`\n  <meta property="og:description" content="${metadata.description}">`);
      } else {
        $('meta[property="og:description"]').attr('content', metadata.description);
      }
      
      if ($('meta[property="og:url"]').length === 0) {
        $('head').append(`\n  <meta property="og:url" content="${pageUrl}">`);
      } else {
        $('meta[property="og:url"]').attr('content', pageUrl);
      }
      
      if ($('meta[property="og:type"]').length === 0) {
        $('head').append(`\n  <meta property="og:type" content="${metadata.ogType || 'website'}">`);
      } else {
        $('meta[property="og:type"]').attr('content', metadata.ogType || 'website');
      }
      
      if ($('meta[property="og:image"]').length === 0 && metadata.image) {
        $('head').append(`\n  <meta property="og:image" content="${metadata.image}">`);
      } else if (metadata.image) {
        $('meta[property="og:image"]').attr('content', metadata.image);
      }
    }
    
    // Add Twitter Card tags if enabled
    if (config.addTwitterCards) {
      if ($('meta[name="twitter:card"]').length === 0) {
        $('head').append(`\n  <meta name="twitter:card" content="summary_large_image">`);
      }
      
      if ($('meta[name="twitter:title"]').length === 0) {
        $('head').append(`\n  <meta name="twitter:title" content="${metadata.title}">`);
      } else {
        $('meta[name="twitter:title"]').attr('content', metadata.title);
      }
      
      if ($('meta[name="twitter:description"]').length === 0) {
        $('head').append(`\n  <meta name="twitter:description" content="${metadata.description}">`);
      } else {
        $('meta[name="twitter:description"]').attr('content', metadata.description);
      }
      
      if ($('meta[name="twitter:image"]').length === 0 && metadata.image) {
        $('head').append(`\n  <meta name="twitter:image" content="${metadata.image}">`);
      } else if (metadata.image) {
        $('meta[name="twitter:image"]').attr('content', metadata.image);
      }
    }
    
    // JSON-LD structured data
    if (config.addStructuredData) {
      const structuredData = generateStructuredData(metadata, pageUrl);
      const jsonLdSnippet = `<script type="application/ld+json">\n${JSON.stringify(structuredData, null, 2)}\n</script>`;
      
      // Replace existing or add new JSON-LD
      let jsonLdElement = $('script[type="application/ld+json"]');
      if (jsonLdElement.length) {
        jsonLdElement.replaceWith(jsonLdSnippet);
      } else {
        $('head').append(`\n  ${jsonLdSnippet}`);
      }
    }
    
    // Write the updated content
    fs.writeFileSync(filePath, $.html(), 'utf8');
    console.log(`Processed: ${filePath}`);
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err);
  }
}

// Generate sitemap.xml
function generateSitemap() {
  if (!config.generateSitemap || sitemapPages.length === 0) return;
  
  try {
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    
    sitemapPages.forEach(page => {
      sitemap += '  <url>\n';
      sitemap += `    <loc>${page.url}</loc>\n`;
      sitemap += `    <lastmod>${page.lastmod}</lastmod>\n`;
      sitemap += `    <priority>${page.priority}</priority>\n`;
      sitemap += '  </url>\n';
    });
    
    sitemap += '</urlset>';
    
    fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap, 'utf8');
    console.log(`Generated sitemap.xml with ${sitemapPages.length} pages`);
  } catch (err) {
    console.error('Error generating sitemap:', err);
  }
}

// Main execution
console.log('🔍 Starting SEO optimization with page-specific metadata...');
walkDir(__dirname);

if (config.generateSitemap) {
  generateSitemap();
}

console.log('✅ SEO optimization completed!');