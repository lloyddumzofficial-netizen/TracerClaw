async function run() {
  const url = 'https://uenetmnnlozeuckkynxf.supabase.co/rest/v1/projects?id=eq.bdf18f96-9332-44c3-8b77-e82917acbffa';
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlbmV0bW5ubG96ZXVja2t5bnhmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzE5ODk1NSwiZXhwIjoyMDk4Nzc0OTU1fQ.xBBOIxZnkR5cLnO-WnO7UAOPGqGNh3icradgzcFw1vU';
  
  const res = await fetch(url, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run();
