require('dotenv').config({path: '.env.local'});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://uenetmnnlozeuckkynxf.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('projects').select('original_image_url, svg_url, generated_image_url, upscaled_image_url').order('created_at', { ascending: false }).limit(1).then(res => console.log(JSON.stringify(res.data[0], null, 2))).catch(console.error);
