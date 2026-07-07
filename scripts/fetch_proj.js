const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlbmV0bW5ubG96ZXVja2t5bnhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTg5NTUsImV4cCI6MjA5ODc3NDk1NX0.44Qgkam_AbwV75jX4u6b9LTrXLJ6r5kDYwLha0kXJqo";
fetch("https://uenetmnnlozeuckkynxf.supabase.co/rest/v1/projects?id=eq.0e8401f8-6602-4458-a308-8db01e22c0e2&select=*", {
  headers: { apikey: key, Authorization: "Bearer " + key }
}).then(r => r.json()).then(console.log);
