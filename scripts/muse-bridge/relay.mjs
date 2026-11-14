import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const hash = value => createHash('sha256').update(value).digest();
const task = '[A-Za-z0-9_-]{1,150}';
const routes = [
  ['GET', /^\/v1\/models$/],
  ['POST', /^\/v1\/chat\/completions$/],
  ['POST', /^\/v1\/images\/tasks$/],
  ['GET', new RegExp(`^/v1/images/tasks/${task}$`)],
  ['POST', /^\/v1\/videos$/],
  ['GET', new RegExp(`^/v1/videos/${task}(?:/content)?$`)],
  ['GET', /^\/v1\/media\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,200}$/],
  ['GET', /^\/admin\/status$/],
  ['POST', new RegExp(`^/admin/accounts/${task}/quota$`)],
];

function reply(response, status, body) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  response.end(JSON.stringify(body));
}

async function limitedBody(stream, maximum) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximum) throw Object.assign(new Error('Body exceeds limit'), {status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Only usage figures leave the desktop. Account identities, cookies, configuration,
// local keys and browser controls are never exposed through this bridge.
function quotaView(body) {
  const fields = ['found','plan','weekly_used_pct','weekly_reset','extra_used_pct','extra_left','extra_expires','checked_at'];
  return {accounts:(Array.isArray(body.accounts) ? body.accounts : []).map((account,index) => ({
    id:account.id, label:`共享通道 ${index + 1}`, enabled:Boolean(account.enabled),
    ok:Boolean(account.ok), checked_at:account.checked_at,
    quota:Object.fromEntries(fields.filter(key => account.quota?.[key] !== undefined).map(key => [key,account.quota[key]])),
  }))};
}

function rewriteMedia(value, upstream, advertised) {
  if (Array.isArray(value)) return value.map(item => rewriteMedia(item,upstream,advertised));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,rewriteMedia(item,upstream,advertised)]));
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      const local = ['127.0.0.1','localhost','[::1]'];
      if (url.origin === upstream.origin || (local.includes(url.hostname) && local.includes(upstream.hostname) && url.port === upstream.port && url.protocol === upstream.protocol))
        return advertised.origin + url.pathname + url.search;
    } catch { /* Ordinary model text is preserved. */ }
  }
  return value;
}

/** A scoped API relay, bound by the caller to desktop loopback only. */
export function createMuseRelay({token, upstreamBase='http://127.0.0.1:18610', advertisedBase='http://127.0.0.1:18610', requestLimit=32*1024*1024}) {
  if (typeof token !== 'string' || token.length < 40) throw new Error('A dedicated bridge token of at least 40 characters is required');
  const expected = hash(`Bearer ${token}`), upstream = new URL(upstreamBase), advertised = new URL(advertisedBase);
  if (!['127.0.0.1','[::1]'].includes(upstream.hostname) || upstream.protocol !== 'http:' || upstream.pathname !== '/' || upstream.search || upstream.hash || upstream.username || upstream.password)
    throw new Error('The Muse upstream must be a literal HTTP loopback origin');
  let key = '', keyUntil = 0, keyRequest;
  async function upstreamKey() {
    if (key && Date.now() < keyUntil) return key;
    if (!keyRequest) keyRequest = (async () => {
      const response = await fetch(new URL('/admin/local-key',upstream), {signal:AbortSignal.timeout(4000),redirect:'error'});
      if (!response.ok) throw new Error('Local key unavailable');
      const body = JSON.parse((await limitedBody(Readable.fromWeb(response.body),8192)).toString('utf8'));
      if (typeof body.key !== 'string' || !body.key || body.key.length > 2048) throw new Error('Invalid local key');
      key = body.key; keyUntil = Date.now() + 60000; return key;
    })().finally(() => {keyRequest = undefined;});
    return keyRequest;
  }
  const server = http.createServer(async (request,response) => {
    response.setHeader('Cache-Control','no-store');
    if (!timingSafeEqual(hash(request.headers.authorization || ''),expected)) {
      request.resume(); return reply(response,401,{error:{code:'BRIDGE_UNAUTHORIZED'}});
    }
    const rawPath = (request.url || '').split('?')[0];
    if (!routes.some(([method,path]) => method === request.method && path.test(rawPath))) {
      request.resume(); return reply(response,403,{error:{code:'BRIDGE_ROUTE_DISABLED'}});
    }
    if (Number(request.headers['content-length'] || 0) > requestLimit) {
      request.resume(); return reply(response,413,{error:{code:'BRIDGE_REQUEST_TOO_LARGE'}});
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(),650000); timer.unref();
    response.once('close',() => {if (!response.writableFinished) abort.abort();});
    try {
      const body = request.method === 'POST' ? await limitedBody(request,requestLimit) : undefined;
      const headers = {Authorization:`Bearer ${await upstreamKey()}`,Accept:request.headers.accept || '*/*'};
      for (const name of ['content-type','idempotency-key','range']) if (request.headers[name]) headers[name] = request.headers[name];
      // Query parameters cannot turn this service into an admin or URL-fetch proxy.
      const parameters = new URL(request.url,'http://bridge').searchParams;
      const query = new URLSearchParams();
      for (const name of ['download','inline']) if (parameters.has(name)) query.set(name,parameters.get(name));
      const target = new URL(rawPath + (query.size ? `?${query}` : ''),upstream);
      const result = await fetch(target,{method:request.method,headers,body,redirect:'manual',signal:abort.signal});
      if (result.status === 401) {key = ''; keyUntil = 0;}
      if ([301,302,303,307,308].includes(result.status)) {
        await result.body?.cancel(); return reply(response,502,{error:{code:'BRIDGE_UNEXPECTED_REDIRECT'}});
      }
      const type = result.headers.get('content-type') || 'application/octet-stream';
      if (type.includes('application/json')) {
        const text = (await limitedBody(Readable.fromWeb(result.body),4*1024*1024)).toString('utf8');
        let output = JSON.parse(text);
        if (rawPath === '/admin/status') output = quotaView(output);
        else if (rawPath.startsWith('/admin/')) output = {ok:result.ok};
        else output = rewriteMedia(output,upstream,advertised);
        return reply(response,result.status,output);
      }
      if (rawPath.startsWith('/admin/')) {
        await result.body?.cancel(); return reply(response,502,{error:{code:'BRIDGE_INVALID_QUOTA_RESPONSE'}});
      }
      const safeHeaders = {'Content-Type':type,'Cache-Control':'no-store'};
      for (const name of ['content-range','accept-ranges']) if (result.headers.has(name)) safeHeaders[name] = result.headers.get(name);
      response.writeHead(result.status,safeHeaders);
      if (result.body) await pipeline(Readable.fromWeb(result.body),response);
      else response.end();
    } catch (error) {
      if (!response.headersSent && !response.destroyed) reply(response,error.status === 413 ? 413 : 503,{error:{code:error.status === 413 ? 'BRIDGE_REQUEST_TOO_LARGE' : 'MUSE_BRIDGE_UNAVAILABLE',message:'Muse 连接暂不可用，请检查本机服务与加密连接。'}});
      else response.destroy();
    } finally {clearTimeout(timer);}
  });
  server.maxConnections = 20;
  server.headersTimeout = 20000;
  server.requestTimeout = 120000;
  return server;
}
