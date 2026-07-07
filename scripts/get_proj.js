const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/projects?id=eq.bdf18f96-9332-44c3-8b77-e82917acbffa&select=*`;
fetch(url, {
  headers: {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
  }
}).then(res => res.json()).then(data => console.log(data));
