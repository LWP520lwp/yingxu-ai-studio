import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createMuseRelay } from './relay.mjs';

const token = 'test-scoped-token-never-used-in-production-123456789';
async function fixture(t, handler, options={}) {
  const upstream = http.createServer(async (req,res) => {
    if (req.url === '/admin/local-key') {res.setHeader('content-type','application/json'); return res.end(JSON.stringify({key:'local-private-provider-key'}));}
    assert.equal(req.headers.authorization,'Bearer local-private-provider-key');
    try {await handler(req,res);} catch {res.writeHead(500);res.end();}
  });
  upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const relay = createMuseRelay({token,upstreamBase:origin,...options});
  relay.listen(0,'127.0.0.1'); await once(relay,'listening');
  t.after(() => {relay.closeAllConnections();relay.close();upstream.closeAllConnections();upstream.close();});
  return {origin,call:(path,init={}) => fetch(`http://127.0.0.1:${relay.address().port}${path}`,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers}})};
}

test('rejects unauthenticated requests and blocks all privileged supplier controls',async t => {
  let calls = 0;
  const f = await fixture(t,(_req,res) => {calls++;res.end();});
  assert.equal((await f.call('/v1/models',{headers:{Authorization:'Bearer wrong'}})).status,401);
  for (const path of ['/admin/local-key','/admin/accounts','/admin/apikey','/admin/repo/push','/admin/login-window','/admin/accounts/id/cookies','/v1/media/x/../../admin/status'])
    assert.equal((await f.call(path)).status,403,path);
  assert.equal(calls,0);
});

test('uses a separate provider key without exposing it to the cloud or browser',async t => {
  const f=await fixture(t,(_req,res) => {res.setHeader('content-type','application/json');res.setHeader('set-cookie','private=secret');res.end(JSON.stringify({data:[{id:'muse-video'}]}));});
  const response=await f.call('/v1/models');
  assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.deepEqual(await response.json(),{data:[{id:'muse-video'}]});
});

test('strips raw configuration, account identities, cookies and quota page text',async t => {
  const f=await fixture(t,(_req,res) => {res.setHeader('content-type','application/json');res.end(JSON.stringify({config:{key:'never-share'},accounts:[{id:'a1',label:'private@email.invalid',cookies:{auth:'secret'},enabled:true,ok:true,quota:{raw:'personal account page',found:true,weekly_used_pct:16,weekly_reset:'Monday'}}]}));});
  const data=await (await f.call('/admin/status')).json();
  assert.deepEqual(data,{accounts:[{id:'a1',label:'共享通道 1',enabled:true,ok:true,quota:{found:true,weekly_used_pct:16,weekly_reset:'Monday'}}]});
});

test('rewrites only loopback media URLs to the API-side origin',async t => {
  let origin;
  const f=await fixture(t,(_req,res) => {res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'completed',data:[{url:origin+'/v1/media/result.webp'}],external:'https://cdn.example.com/asset',prompt:'a normal description'}));});
  origin=f.origin;
  const body=await (await f.call('/v1/images/tasks/t1')).json();
  assert.equal(body.data[0].url,'http://127.0.0.1:18610/v1/media/result.webp');
  assert.equal(body.external,'https://cdn.example.com/asset');assert.equal(body.prompt,'a normal description');
});

test('preserves multipart bodies and idempotency without forwarding cookies',async t => {
  const payload=Buffer.from('--boundary\r\nContent-Disposition: form-data; name="prompt"\r\n\r\ncar\r\n--boundary--');
  const f=await fixture(t,async(req,res) => {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks),payload);
    assert.equal(req.headers['idempotency-key'],'one-job');assert.equal(req.headers.cookie,undefined);
    assert.equal(req.headers['content-type'],'multipart/form-data; boundary=boundary');
    res.setHeader('content-type','application/json');res.end('{"id":"v1","status":"queued"}');
  });
  const response=await f.call('/v1/videos',{method:'POST',body:payload,headers:{'Content-Type':'multipart/form-data; boundary=boundary','Idempotency-Key':'one-job',Cookie:'private=never'}});
  assert.equal(response.status,200);assert.equal((await response.json()).id,'v1');
});

test('streams media bytes and range metadata intact',async t => {
  const bytes=Buffer.from([0,1,2,255,128]);
  const f=await fixture(t,(req,res) => {assert.equal(req.headers.range,'bytes=0-4');res.writeHead(206,{'content-type':'video/mp4','content-range':'bytes 0-4/5'});res.end(bytes);});
  const response=await f.call('/v1/videos/t1/content',{headers:{Range:'bytes=0-4'}});
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-4/5');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
});

test('rejects oversized inputs and does not follow supplier redirects',async t => {
  const f=await fixture(t,(_req,res) => {res.writeHead(302,{Location:'http://private.invalid'});res.end();},{requestLimit:16});
  assert.equal((await f.call('/v1/videos',{method:'POST',body:'x'.repeat(17)})).status,413);
  assert.equal((await f.call('/v1/models')).status,502);
});

test('does not accept a remote upstream or a short bridge token',() => {
  assert.throws(()=>createMuseRelay({token,upstreamBase:'http://example.com'}));
  assert.throws(()=>createMuseRelay({token:'short'}));
  assert.throws(()=>createMuseRelay({token,upstreamBase:'http://127.0.0.1:18610/admin'}));
});
