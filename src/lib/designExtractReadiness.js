import { DESIGN_EXTRACT_DEFAULT_BILLING_MODE } from './designExtractPricing';

export function validDesignPrivateBucket(bucket,publicBucket) {
  return typeof bucket==='string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) && bucket!==publicBucket;
}
export function designExtractConfiguration(env=process.env) {
  if(env.DESIGN_EXTRACT_ENABLED!=='true')return {ok:true,enabled:false};
  const missing=[];
  if(!validDesignPrivateBucket(env.DESIGN_EXTRACT_PRIVATE_BUCKET,env.CLOUDFLARE_BUCKET_NAME))missing.push('PRIVATE_STORAGE');
  if(!env.FAL_KEY)missing.push('AI_PROVIDER');
  if(!env.RECRAFT_API_KEY)missing.push('ENHANCEMENT_PROVIDER');
  if(!env.ADMIN_EMAIL)missing.push('ACCESS_CONFIGURATION');
  if((env.NODE_ENV==='production'||env.VERCEL_ENV==='production')&&(!env.UPSTASH_REDIS_REST_URL||!env.UPSTASH_REDIS_REST_TOKEN))missing.push('RATE_LIMIT_STORAGE');
  const billingMode=env.DESIGN_EXTRACT_BILLING_MODE??DESIGN_EXTRACT_DEFAULT_BILLING_MODE,processor=env.DESIGN_EXTRACT_PROCESSOR||'legacy';
  if(!['beta','paid'].includes(billingMode))missing.push('BILLING_CONFIGURATION');
  if(!['legacy','workflow'].includes(processor))missing.push('PROCESSOR_CONFIGURATION');
  if(processor==='workflow'&&env.VERCEL&&!env.VERCEL_DEPLOYMENT_ID)missing.push('WORKFLOW_DEPLOYMENT');
  return {ok:missing.length===0,enabled:true,billingMode,processor,missing};
}
