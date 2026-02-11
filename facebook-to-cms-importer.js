const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  FB_PAGE_URL: 'https://www.facebook.com/srinithyananda',
  CMS_BASE_URL: 'https://ecitizen.kailasa.ai',
  // CMS_BASE_URL: 'http://135.181.129.60:3000', // Alternative
  API_KEY: 'kec-M3PEi4pscirfodDGM35NVWSDsdZv',

  // Date range for scraping
  START_DATE: new Date('2025-09-01T00:00:00'),
  END_DATE: new Date('2025-11-30T23:59:59'),

  DEFAULT_CATEGORY: 1, // Change this to your news category ID
  TEMP_IMAGE_DIR: './temp_images'
};

// Ensure temp directory exists
if (!fs.existsSync(CONFIG.TEMP_IMAGE_DIR)) {
  fs.mkdirSync(CONFIG.TEMP_IMAGE_DIR, { recursive: true });
}

/**
 * Download image from URL
 */
async function downloadImage(imageUrl, filename) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const filepath = path.join(CONFIG.TEMP_IMAGE_DIR, filename);
    fs.writeFileSync(filepath, response.data);
    return filepath;
  } catch (error) {
    console.error(`Failed to download image: ${imageUrl}`, error.message);
    return null;
  }
}

/**
 * Upload image to CMS
 */
async function uploadImageToCMS(imagePath) {
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(imagePath));

    const response = await axios.post(
      `${CONFIG.CMS_BASE_URL}/api/adhikara/media/upload`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'X-API-Key': CONFIG.API_KEY
        },
        timeout: 60000
      }
    );

    if (response.data.success) {
      console.log(`✓ Uploaded image: ${response.data.doc.filename}`);
      return response.data.doc;
    }
    return null;
  } catch (error) {
    console.error('Failed to upload image to CMS:', error.message);
    return null;
  }
}

/**
 * Create post in CMS
 */
async function createCMSPost(post) {
  try {
    const response = await axios.post(
      `${CONFIG.CMS_BASE_URL}/api/cms/posts`,
      post,
      {
        headers: {
          'X-API-Key': CONFIG.API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log(`✓ Created post: "${post.title}"`);
    return response.data;
  } catch (error) {
    console.error(`✗ Failed to create post: "${post.title}"`, error.response?.data || error.message);
    return null;
  }
}

/**
 * Convert Facebook post to CMS format
 */
async function convertPostToCMSFormat(fbPost) {
  const contentChildren = [];

  // Add main text content
  if (fbPost.text) {
    const paragraphs = fbPost.text.split('\n\n').filter(p => p.trim());
    for (const para of paragraphs) {
      if (para.trim()) {
        contentChildren.push({
          type: 'paragraph',
          children: [
            { type: 'text', text: para.trim() }
          ]
        });
      }
    }
  }

  // Add images
  if (fbPost.images && fbPost.images.length > 0) {
    for (const imageUrl of fbPost.images) {
      const filename = `fb_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
      const localPath = await downloadImage(imageUrl, filename);

      if (localPath) {
        const uploadedImage = await uploadImageToCMS(localPath);

        // Clean up local file
        try { fs.unlinkSync(localPath); } catch (e) {}

        if (uploadedImage) {
          // Add empty paragraph before image
          contentChildren.push({
            type: 'paragraph',
            children: [{ type: 'text', text: '' }]
          });

          // Add image using upload type (as shown in your sample)
          contentChildren.push({
            type: 'upload',
            relationTo: 'media',
            value: {
              url: uploadedImage.url,
              alt: fbPost.title || 'Facebook post image'
            }
          });

          // Add empty paragraph after image
          contentChildren.push({
            type: 'paragraph',
            children: [{ type: 'text', text: '' }]
          });
        }
      }
    }
  }

  // Add source link
  if (fbPost.postUrl) {
    contentChildren.push({
      type: 'heading',
      tag: 'h2',
      children: [
        { type: 'text', text: 'Source' }
      ]
    });

    contentChildren.push({
      type: 'paragraph',
      children: [
        {
          type: 'link',
          url: fbPost.postUrl,
          children: [
            { type: 'text', text: 'View original post on Facebook' }
          ]
        }
      ]
    });
  }

  return {
    title: fbPost.title,
    status: 'published',
    categories: [CONFIG.DEFAULT_CATEGORY],
    publishedDate: fbPost.date,
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
 * Scrape Facebook page posts
 */
async function scrapeFacebookPosts() {
  console.log('🚀 Starting Facebook scraper...\n');

  const browser = await puppeteer.launch({
    headless: false, // Set to true for production
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = await browser.newPage();

  // Set viewport and user agent
  await page.setViewport({ width: 1366, height: 768 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log(`📖 Opening page: ${CONFIG.FB_PAGE_URL}`);
    await page.goto(CONFIG.FB_PAGE_URL, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for content to load
    await page.waitForTimeout(5000);

    // Close any popups (login prompts, cookie notices, etc.)
    try {
      const closeButtons = await page.$$('div[aria-label="Close"], button[aria-label="Close"]');
      for (const btn of closeButtons) {
        await btn.click().catch(() => {});
      }
      await page.waitForTimeout(2000);
    } catch (e) {}

    // Calculate date threshold
    const startDate = CONFIG.START_DATE;
    const endDate = CONFIG.END_DATE;
    console.log(`📅 Fetching posts from: ${startDate.toDateString()} to ${endDate.toDateString()}\n`);

    const posts = [];
    let scrollAttempts = 0;
    const maxScrollAttempts = 50; // Limit scrolling

    while (scrollAttempts < maxScrollAttempts) {
      // Scroll down to load more posts
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(3000);

      // Extract posts from the page
      const newPosts = await page.evaluate((startTimestamp, endTimestamp) => {
        const postElements = document.querySelectorAll('div[role="article"]');
        const extractedPosts = [];

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
            const imgElements = element.querySelectorAll('img[src]');
            imgElements.forEach(img => {
              const src = img.src;
              // Filter out profile pictures, icons, etc.
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

            // Try to extract date (this is tricky on Facebook)
            // Facebook shows relative dates like "2 hrs", "3 days", etc.
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
              extractedPosts.push({
                text: postText,
                images: images,
                postUrl: postUrl,
                dateText: dateText,
                elementIndex: index
              });
            }
          } catch (e) {
            console.error('Error extracting post:', e);
          }
        });

        return extractedPosts;
      }, startDate.getTime(), endDate.getTime());

      // Add new unique posts
      for (const post of newPosts) {
        const exists = posts.some(p => p.text === post.text || p.postUrl === post.postUrl);
        if (!exists) {
          posts.push(post);
        }
      }

      console.log(`📊 Found ${posts.length} posts so far...`);
      scrollAttempts++;

      // Check if we've reached old enough posts
      // This is approximate since Facebook dates are relative
      if (scrollAttempts > 20) {
        console.log('⚠️ Reached scroll limit. Proceeding with found posts.\n');
        break;
      }
    }

    console.log(`\n✅ Scraped ${posts.length} total posts\n`);

    // Filter and process posts within date range
    const postsToImport = [];

    for (const fbPost of posts) {
      // Estimate date from Facebook's relative timestamp
      let postDate = new Date();

      if (fbPost.dateText) {
        const match = fbPost.dateText.match(/(\d+)\s*(hr|hour|min|minute|day|week|month|year)/i);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2].toLowerCase();

          if (unit.includes('min')) {
            postDate.setMinutes(postDate.getMinutes() - value);
          } else if (unit.includes('hr') || unit.includes('hour')) {
            postDate.setHours(postDate.getHours() - value);
          } else if (unit.includes('day')) {
            postDate.setDate(postDate.getDate() - value);
          } else if (unit.includes('week')) {
            postDate.setDate(postDate.getDate() - (value * 7));
          } else if (unit.includes('month')) {
            postDate.setMonth(postDate.getMonth() - value);
          } else if (unit.includes('year')) {
            postDate.setFullYear(postDate.getFullYear() - value);
          }
        }
      }

      // Check if post is within our date range
      if (postDate >= startDate && postDate <= endDate) {
        fbPost.estimatedDate = postDate;
        postsToImport.push(fbPost);
      }
    }

    console.log(`📊 Posts within date range (${startDate.toDateString()} - ${endDate.toDateString()}): ${postsToImport.length}\n`);

    // Process and import posts
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < postsToImport.length; i++) {
      const fbPost = postsToImport[i];
      console.log(`\n[${i + 1}/${postsToImport.length}] Processing post from ${fbPost.estimatedDate.toDateString()}...`);

      // Generate title from text (first 60 chars)
      let title = fbPost.text
        ? fbPost.text.substring(0, 60)
        : `Facebook Post ${fbPost.estimatedDate.toDateString()}`;

      if (fbPost.text && fbPost.text.length > 60) {
        title += '...';
      }

      const postData = {
        title: title,
        text: fbPost.text,
        images: fbPost.images,
        postUrl: fbPost.postUrl,
        date: fbPost.estimatedDate.toISOString()
      };

      const cmsPost = await convertPostToCMSFormat(postData);
      const result = await createCMSPost(cmsPost);

      if (result) {
        successCount++;
      } else {
        failCount++;
      }

      // Rate limiting - wait between posts
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`📅 Date Range: ${startDate.toDateString()} - ${endDate.toDateString()}`);
    console.log(`📝 Posts found in range: ${postsToImport.length}`);
    console.log(`✅ Successfully imported: ${successCount} posts`);
    console.log(`✗ Failed: ${failCount} posts`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Scraping error:', error.message);
  } finally {
    await browser.close();

    // Cleanup temp directory
    try {
      const files = fs.readdirSync(CONFIG.TEMP_IMAGE_DIR);
      files.forEach(file => {
        fs.unlinkSync(path.join(CONFIG.TEMP_IMAGE_DIR, file));
      });
    } catch (e) {}
  }
}

// Run the scraper
scrapeFacebookPosts().catch(console.error);
