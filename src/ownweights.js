// Starts the daily own stat weights job (.github/workflows/own-weights.yml) from the Worker's 5-minute cron, once a day,
// in case GitHub's own schedule doesn't fire (the price job's never did, see bliz.js). The job itself stops in about a
// minute when the sim engine hasn't changed. Uses the same GH_TOKEN (Actions: read and write) as the price job.
const OW_URL = 'https://api.github.com/repos/itsJJun/wow.junhots.com/actions/workflows/own-weights.yml/dispatches';
export async function kickOwnWeights(env, now) {
  if (!env.GH_TOKEN) return 'no GH_TOKEN';
  const last = +(await env.WOW.get('ow:kick')) || 0;
  if (now - last < 24 * 3600e3) return 'started ' + Math.round((now - last) / 3600e3) + ' h ago';
  await env.WOW.put('ow:kick', String(now));
  const r = await fetch(OW_URL, { method: 'POST', body: JSON.stringify({ ref: 'main' }), headers: {
    authorization: 'Bearer ' + env.GH_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'junhots-wow-worker', 'x-github-api-version': '2022-11-28' } });
  return 'start ' + r.status;
}
