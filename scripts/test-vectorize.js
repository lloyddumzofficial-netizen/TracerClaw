const fs = require('fs');

async function test() {
  const formData = new FormData();
  const blob = new Blob([fs.readFileSync('src/app/globals.css')], { type: 'text/css' });
  formData.append('image', blob, 'image.png');
  formData.append('model', 'recraft-v4-invalid'); // Bad model

  const res = await fetch("https://external.api.recraft.ai/v1/images/vectorize", {
    method: "POST",
    headers: {
      "Authorization": `Bearer tgIK2suqwJ8xM8hDQQRFgmXXPA1Fz5aYVrOZJJ8ZX7xpXvDx0Z070vLdUV4sM7gE`
    },
    body: formData
  });
  const data = await res.text();
  console.log(res.status, data);
}
test().catch(console.error);
