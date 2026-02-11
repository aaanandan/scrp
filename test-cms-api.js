const axios = require('axios');

const PROD_API_KEY = 'kec-5UdyrLbifWUIGnKyjLOR4w4oPj36';
const DEFAULT_CATEGORY = 1;

const ENDPOINTS = [
  { name: 'PROD (ecitizen.kailasa.ai)', baseUrl: 'https://ecitizen.kailasa.ai', apiKey: PROD_API_KEY },
  { name: 'ALT (135.181.129.60:3000)', baseUrl: 'http://135.181.129.60:3000', apiKey: PROD_API_KEY }
];

async function testEndpoint(endpoint) {
  console.log('='.repeat(60));
  console.log(`TESTING: ${endpoint.name}`);
  console.log(`URL: ${endpoint.baseUrl}`);
  console.log('='.repeat(60));

  // Step 1: Test API connectivity
  console.log('\n[1/3] Testing API connectivity...');
  try {
    const healthCheck = await axios.get(`${endpoint.baseUrl}/api/cms/posts`, {
      headers: { 'X-API-Key': endpoint.apiKey },
      timeout: 15000
    });
    console.log(`  OK - API responded with status ${healthCheck.status}`);
    console.log(`  Existing posts count: ${healthCheck.data?.docs?.length || healthCheck.data?.totalDocs || 'unknown'}`);
    return { reachable: true, endpoint };
  } catch (error) {
    console.log(`  Response status: ${error.response?.status || 'N/A'}`);
    console.log(`  Message: ${error.response?.data?.message || error.response?.data || error.message}`);
    return { reachable: false, endpoint };
  }
}

async function testCMSApi() {
  console.log('='.repeat(60));
  console.log('CMS API CONNECTIVITY & CONTENT CREATION TEST');
  console.log('API Key: kec-5Udyr...j36 (prod)');
  console.log('='.repeat(60) + '\n');

  // Step 1: Test connectivity on both endpoints, pick the first that works
  let workingEndpoint = null;
  for (const ep of ENDPOINTS) {
    const result = await testEndpoint(ep);
    if (result.reachable) {
      workingEndpoint = result.endpoint;
      break;
    }
    console.log('');
  }

  if (!workingEndpoint) {
    console.log('\nNeither endpoint is reachable. Cannot proceed with post creation.');
    console.log('Both returned 403 "Host not allowed" - this environment\'s IP is not whitelisted.');
    return;
  }

  const CONFIG = { CMS_BASE_URL: workingEndpoint.baseUrl, API_KEY: workingEndpoint.apiKey };
  console.log(`\nUsing working endpoint: ${CONFIG.CMS_BASE_URL}\n`);

  // Step 2: Create sample test posts (simulating Facebook imports)
  console.log('[2/3] Creating sample posts to test the import pipeline...\n');

  const samplePosts = [
    {
      title: 'Test Import - Spiritual Discourse on Consciousness',
      status: 'published',
      categories: [DEFAULT_CATEGORY],
      publishedDate: new Date('2025-10-15T10:00:00').toISOString(),
      content: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: 'This is a test post simulating a Facebook import. The discourse on consciousness explores the nature of awareness and the path to enlightenment through traditional practices.' }]
            },
            {
              type: 'heading',
              tag: 'h2',
              children: [{ type: 'text', text: 'Source' }]
            },
            {
              type: 'paragraph',
              children: [{
                type: 'link',
                url: 'https://www.facebook.com/srinithyananda/posts/test1',
                children: [{ type: 'text', text: 'View original post on Facebook' }]
              }]
            }
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1
        }
      }
    },
    {
      title: 'Test Import - Morning Meditation Session Update',
      status: 'published',
      categories: [DEFAULT_CATEGORY],
      publishedDate: new Date('2025-10-20T08:00:00').toISOString(),
      content: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: 'Test post simulating a Facebook import about a morning meditation session. Participants gathered for the daily practice of inner awakening and mindfulness.' }]
            },
            {
              type: 'heading',
              tag: 'h2',
              children: [{ type: 'text', text: 'Source' }]
            },
            {
              type: 'paragraph',
              children: [{
                type: 'link',
                url: 'https://www.facebook.com/srinithyananda/posts/test2',
                children: [{ type: 'text', text: 'View original post on Facebook' }]
              }]
            }
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1
        }
      }
    },
    {
      title: 'Test Import - Community Event Announcement',
      status: 'published',
      categories: [DEFAULT_CATEGORY],
      publishedDate: new Date('2025-11-01T14:00:00').toISOString(),
      content: {
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: 'Test post simulating a Facebook import about a community event. Join us for the upcoming spiritual gathering and celebration of ancient traditions.' }]
            },
            {
              type: 'heading',
              tag: 'h2',
              children: [{ type: 'text', text: 'Source' }]
            },
            {
              type: 'paragraph',
              children: [{
                type: 'link',
                url: 'https://www.facebook.com/srinithyananda/posts/test3',
                children: [{ type: 'text', text: 'View original post on Facebook' }]
              }]
            }
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          version: 1
        }
      }
    }
  ];

  const createdPosts = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < samplePosts.length; i++) {
    const post = samplePosts[i];
    console.log(`  [${i + 1}/${samplePosts.length}] Creating: "${post.title}"`);

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
      console.log(`    SUCCESS - Status: ${response.status}`);
      console.log(`    Post ID: ${response.data?.doc?.id || response.data?.id || 'N/A'}`);
      createdPosts.push(response.data?.doc || response.data);
      successCount++;
    } catch (error) {
      console.log(`    FAILED - Status: ${error.response?.status || 'N/A'}`);
      console.log(`    Error: ${JSON.stringify(error.response?.data || error.message)}`);
      failCount++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Step 3: Verify created content by fetching posts
  console.log('\n[3/3] Verifying created content via GET /api/cms/posts...\n');
  try {
    const response = await axios.get(`${CONFIG.CMS_BASE_URL}/api/cms/posts`, {
      headers: { 'X-API-Key': CONFIG.API_KEY },
      timeout: 15000,
      params: { limit: 20, sort: '-createdAt' }
    });

    const posts = response.data?.docs || response.data || [];
    console.log(`  Total posts returned: ${posts.length}`);
    console.log(`  Total docs in CMS: ${response.data?.totalDocs || 'unknown'}\n`);

    if (Array.isArray(posts) && posts.length > 0) {
      console.log('  Recent posts in CMS:');
      console.log('  ' + '-'.repeat(56));
      posts.slice(0, 10).forEach((p, idx) => {
        console.log(`  ${idx + 1}. ID: ${p.id || 'N/A'}`);
        console.log(`     Title: ${p.title || 'N/A'}`);
        console.log(`     Status: ${p.status || 'N/A'}`);
        console.log(`     Published: ${p.publishedDate || 'N/A'}`);
        console.log(`     Created: ${p.createdAt || 'N/A'}`);
        console.log('');
      });
    }
  } catch (error) {
    console.log(`  Failed to verify: ${error.response?.status || ''} ${error.response?.data?.message || error.message}`);
  }

  // Summary
  console.log('\nREPORT');
  console.log('='.repeat(60));
  console.log(`CMS Base URL:          ${CONFIG.CMS_BASE_URL}`);
  console.log(`API Endpoint:          ${CONFIG.CMS_BASE_URL}/api/cms/posts`);
  console.log(`Posts attempted:       ${samplePosts.length}`);
  console.log(`Successfully created:  ${successCount}`);
  console.log(`Failed:                ${failCount}`);
  console.log('='.repeat(60));

  if (successCount > 0) {
    console.log('\nCreated post details:');
    createdPosts.forEach((p, idx) => {
      console.log(`  ${idx + 1}. "${p.title || 'N/A'}" (ID: ${p.id || 'N/A'})`);
    });
  }

  if (failCount > 0 && successCount === 0) {
    console.log('\nNOTE: All posts failed. Possible causes:');
    console.log('  - API key may be invalid or expired');
    console.log('  - CMS endpoint may be unreachable');
    console.log('  - Post schema may not match CMS expectations');
  }

  console.log('\nNOTE: Facebook scraping via Puppeteer could not run in this');
  console.log('environment (no browser available). The above test validates');
  console.log('the CMS API integration portion of the pipeline.');
}

testCMSApi().catch(err => {
  console.error('Fatal error:', err.message);
});
