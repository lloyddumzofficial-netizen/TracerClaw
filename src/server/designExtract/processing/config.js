export function designProcessingDriver() {
  const mode = process.env.DESIGN_EXTRACT_PROCESSOR || 'legacy';
  if (!['legacy', 'workflow'].includes(mode)) throw Object.assign(new Error('Design Extract processing is not configured'), {status:503,designExtractError:true});
  if (mode === 'workflow') {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) throw Object.assign(new Error('Design Extract processing requires the configured Node 22 runtime'), {status:503,designExtractError:true});
    if (process.env.VERCEL && !process.env.VERCEL_DEPLOYMENT_ID) throw Object.assign(new Error('Design Extract workflow deployment configuration is incomplete'), {status:503,designExtractError:true});
  }
  return mode;
}
