require('dotenv').config({ path: '.env.local' });
const { getUploadUrl } = require('./src/lib/cloudflare.js');

async function test() {
  const urls = await getUploadUrl('test.jpg', 'image/jpeg');
  console.log(urls);
}
test().catch(console.error);
