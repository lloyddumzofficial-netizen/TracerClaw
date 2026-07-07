require('dotenv').config({ path: '.env.local' });

async function test() {
  const fetch = (await import('node-fetch')).default;
  const res = await fetch("https://external.api.recraft.ai/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.RECRAFT_API_KEY}`
    },
    body: JSON.stringify({
      prompt: "A red apple",
      style: "vector_illustration",
      size: "1024x1024"
    })
  });
  const data = await res.json();
  console.log(data);
  const imgRes = await fetch(data.data[0].url);
  console.log("Content-Type:", imgRes.headers.get('content-type'));
}
test().catch(console.error);
