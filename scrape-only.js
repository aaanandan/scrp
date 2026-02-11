const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const CONFIG = {
  FB_PAGE_URL: 'https://www.facebook.com/srinithyananda',

  // Date range for scraping
  START_DATE: new Date('2025-09-01T00:00:00'),
  END_DATE: new Date('2025-11-30T23:59:59'),

  // Output directories
  OUTPUT_DIR: './scraped_data',
  IMAGES_DIR: './scraped_data/images',

  // Scraping settings
  MAX_SCROLL_ATTEMPTS: 50,
  SCROLL_DELAY_MS: 3000,
  DEFAULT_CATEGORY: 1
};

// Ensure output directories exist
fs.mkdirSync(CONFIG.IMAGES_DIR, { recursive: true });

/**
 * Download image from URL and save locally
 */
async function downloadImage(imageUrl, filename) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const filepath = path.join(CONFIG.IMAGES_DIR, filename);
    fs.writeFileSync(filepath, response.data);
    console.log(`  Downloaded: ${filename}`);
    return { filepath, filename, originalUrl: imageUrl, size: response.data.length };
  } catch (error) {
    console.error(`  Failed to download image: ${error.message}`);
    return null;
  }
}

/**
 * Convert a raw scraped post into CMS-ready payload format
 */
function buildCMSPayload(post) {
  const contentChildren = [];

  // Add main text content as paragraphs
  if (post.text) {
    const paragraphs = post.text.split('\n\n').filter(p => p.trim());
    for (const para of paragraphs) {
      if (para.trim()) {
        contentChildren.push({
          type: 'paragraph',
          children: [{ type: 'text', text: para.trim() }]
        });
      }
    }
  }

  // Add image placeholders (media IDs to be filled in during import)
  if (post.localImages && post.localImages.length > 0) {
    for (const img of post.localImages) {
      contentChildren.push({
        type: 'paragraph',
        children: [{ type: 'text', text: '' }]
      });
      contentChildren.push({
        type: 'upload',
        relationTo: 'media',
        value: {
          _localFile: img.filename,
          _originalUrl: img.originalUrl,
          alt: post.title || 'Facebook post image'
        }
      });
      contentChildren.push({
        type: 'paragraph',
        children: [{ type: 'text', text: '' }]
      });
    }
  }

  // Add source link
  if (post.postUrl) {
    contentChildren.push({
      type: 'heading',
      tag: 'h2',
      children: [{ type: 'text', text: 'Source' }]
    });
    contentChildren.push({
      type: 'paragraph',
      children: [{
        type: 'link',
        url: post.postUrl,
        children: [{ type: 'text', text: 'View original post on Facebook' }]
      }]
    });
  }

  return {
    title: post.title,
    status: 'published',
    categories: [CONFIG.DEFAULT_CATEGORY],
    publishedDate: post.estimatedDate,
    content: {
      root: {
        type: 'root',
        children: contentChildren,
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1
      }
    }
  };
}

/**
 * Scrape Facebook page posts and save as JSON
 */
async function scrapeFacebookPosts() {
  console.log('Starting Facebook scraper (data-only mode)...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log(`Opening page: ${CONFIG.FB_PAGE_URL}`);
    await page.goto(CONFIG.FB_PAGE_URL, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await new Promise(r => setTimeout(r, 5000));

    // Close any popups
    try {
      const closeButtons = await page.$$('div[aria-label="Close"], button[aria-label="Close"]');
      for (const btn of closeButtons) {
        await btn.click().catch(() => {});
      }
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {}

    const startDate = CONFIG.START_DATE;
    const endDate = CONFIG.END_DATE;
    console.log(`Date range: ${startDate.toDateString()} to ${endDate.toDateString()}\n`);

    const posts = [];
    let scrollAttempts = 0;

    while (scrollAttempts < CONFIG.MAX_SCROLL_ATTEMPTS) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, CONFIG.SCROLL_DELAY_MS));

      const newPosts = await page.evaluate(() => {
        const postElements = document.querySelectorAll('div[role="article"]');
        const extracted = [];

        postElements.forEach((element, index) => {
          try {
            // Extract post text
            const textElements = element.querySelectorAll('div[dir="auto"]');
            let postText = '';
            textElements.forEach(el => {
              const text = el.innerText?.trim();
              if (text && text.length > 20) {
                postText = text;
              }
            });

            // Extract images
            const images = [];
            element.querySelectorAll('img[src]').forEach(img => {
              const src = img.src;
              if (src && !src.includes('profile') && !src.includes('emoji') && src.includes('scontent')) {
                images.push(src);
              }
            });

            // Extract post URL
            let postUrl = '';
            const linkElements = element.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
            if (linkElements.length > 0) {
              postUrl = linkElements[0].href;
            }

            // Extract relative date text
            const dateElements = element.querySelectorAll('a[aria-label], span[class]');
            let dateText = '';
            dateElements.forEach(el => {
              const text = el.innerText?.toLowerCase();
              if (text && (text.includes('hr') || text.includes('day') || text.includes('week') ||
                  text.includes('month') || text.includes('min'))) {
                dateText = text;
              }
            });

            if (postText || images.length > 0) {
              extracted.push({ text: postText, images, postUrl, dateText, elementIndex: index });
            }
          } catch (e) {}
        });

        return extracted;
      });

      // Deduplicate
      for (const post of newPosts) {
        const exists = posts.some(p => p.text === post.text || (p.postUrl && p.postUrl === post.postUrl));
        if (!exists) {
          posts.push(post);
        }
      }

      console.log(`Found ${posts.length} posts so far... (scroll ${scrollAttempts + 1}/${CONFIG.MAX_SCROLL_ATTEMPTS})`);
      scrollAttempts++;

      if (scrollAttempts > 20) {
        console.log('Reached scroll limit. Proceeding with found posts.\n');
        break;
      }
    }

    console.log(`\nScraped ${posts.length} total posts\n`);

    // Filter posts within date range
    const postsInRange = [];
    const now = new Date();

    for (const fbPost of posts) {
      let postDate = new Date(now);

      if (fbPost.dateText) {
        const match = fbPost.dateText.match(/(\d+)\s*(hr|hour|min|minute|day|week|month|year)/i);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2].toLowerCase();

          if (unit.includes('min')) postDate.setMinutes(postDate.getMinutes() - value);
          else if (unit.includes('hr') || unit.includes('hour')) postDate.setHours(postDate.getHours() - value);
          else if (unit.includes('day')) postDate.setDate(postDate.getDate() - value);
          else if (unit.includes('week')) postDate.setDate(postDate.getDate() - (value * 7));
          else if (unit.includes('month')) postDate.setMonth(postDate.getMonth() - value);
          else if (unit.includes('year')) postDate.setFullYear(postDate.getFullYear() - value);
        }
      }

      if (postDate >= startDate && postDate <= endDate) {
        fbPost.estimatedDate = postDate.toISOString();
        postsInRange.push(fbPost);
      }
    }

    console.log(`Posts within date range: ${postsInRange.length}\n`);

    // Download images for each post
    console.log('Downloading images...\n');
    for (let i = 0; i < postsInRange.length; i++) {
      const post = postsInRange[i];
      post.localImages = [];

      if (post.images && post.images.length > 0) {
        for (let j = 0; j < post.images.length; j++) {
          const filename = `post_${i}_img_${j}_${Date.now()}.jpg`;
          const result = await downloadImage(post.images[j], filename);
          if (result) {
            post.localImages.push(result);
          }
        }
      }

      // Generate title
      post.title = post.text
        ? post.text.substring(0, 60) + (post.text.length > 60 ? '...' : '')
        : `Facebook Post ${new Date(post.estimatedDate).toDateString()}`;
    }

    // Save raw scraped data
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const rawDataPath = path.join(CONFIG.OUTPUT_DIR, `raw_posts_${timestamp}.json`);
    fs.writeFileSync(rawDataPath, JSON.stringify(postsInRange, null, 2));
    console.log(`\nSaved raw scraped data: ${rawDataPath}`);

    // Build and save CMS payloads
    const payloads = postsInRange.map(post => buildCMSPayload(post));
    const payloadsPath = path.join(CONFIG.OUTPUT_DIR, `cms_payloads_${timestamp}.json`);
    fs.writeFileSync(payloadsPath, JSON.stringify(payloads, null, 2));
    console.log(`Saved CMS payloads:     ${payloadsPath}`);

    // Save a manifest with metadata
    const manifest = {
      scrapedAt: new Date().toISOString(),
      source: CONFIG.FB_PAGE_URL,
      dateRange: {
        start: CONFIG.START_DATE.toISOString(),
        end: CONFIG.END_DATE.toISOString()
      },
      totalPostsFound: posts.length,
      postsInDateRange: postsInRange.length,
      imagesDownloaded: postsInRange.reduce((sum, p) => sum + (p.localImages?.length || 0), 0),
      files: {
        rawData: path.basename(rawDataPath),
        cmsPayloads: path.basename(payloadsPath),
        imagesDir: 'images/'
      }
    };

    const manifestPath = path.join(CONFIG.OUTPUT_DIR, `manifest_${timestamp}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Saved manifest:         ${manifestPath}`);

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('SCRAPE SUMMARY');
    console.log('='.repeat(50));
    console.log(`Source:           ${CONFIG.FB_PAGE_URL}`);
    console.log(`Date range:       ${startDate.toDateString()} - ${endDate.toDateString()}`);
    console.log(`Total scraped:    ${posts.length}`);
    console.log(`In date range:    ${postsInRange.length}`);
    console.log(`Images saved:     ${manifest.imagesDownloaded}`);
    console.log(`Output dir:       ${CONFIG.OUTPUT_DIR}`);
    console.log('='.repeat(50));
    console.log('\nTo import later, use the CMS payloads JSON file.');
    console.log('Image placeholders have _localFile fields pointing to downloaded images.');

  } catch (error) {
    console.error('Scraping error:', error.message);
  } finally {
    await browser.close();
  }
}

scrapeFacebookPosts().catch(console.error);
