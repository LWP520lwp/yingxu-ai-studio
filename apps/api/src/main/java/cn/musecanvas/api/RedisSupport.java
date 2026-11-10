package cn.musecanvas.api;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class RedisSupport {
    private static final DefaultRedisScript<Long> RATE = new DefaultRedisScript<>("local n=redis.call('INCR',KEYS[1]); if redis.call('TTL',KEYS[1])<0 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", Long.class);
    private static final DefaultRedisScript<Long> RELEASE_LEASE = new DefaultRedisScript<>("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", Long.class);
    private final StringRedisTemplate redis;
    public RedisSupport(StringRedisTemplate redis) { this.redis=redis; }
    public String cachedProjects(String user) { try { return redis.opsForValue().get("workbench:projects:"+user); } catch (RuntimeException e) { return null; } }
    public void cacheProjects(String user,String json) { try { redis.opsForValue().set("workbench:projects:"+user,json,Duration.ofSeconds(10)); } catch (RuntimeException ignored) {} }
    public void evictProjects(String user) { try { redis.delete("workbench:projects:"+user); } catch (RuntimeException ignored) {} }
    public boolean tryPoolLease(String accountId, String token, long seconds) {
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(poolLeaseKey(accountId), token, Duration.ofSeconds(seconds)));
    }
    public void releasePoolLease(String accountId, String token) {
        redis.execute(RELEASE_LEASE, List.of(poolLeaseKey(accountId)), token);
    }
    public void limit(String user,String bucket,int maxPerMinute) {
        String key="workbench:rate:"+bucket+":"+user;
        final Long n;
        try { n=redis.execute(RATE,List.of(key),"60"); }
        catch (RuntimeException e) { throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"REDIS_UNAVAILABLE","限流服务暂不可用，请稍后重试"); }
        if(n==null) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"REDIS_UNAVAILABLE","限流结果暂未确认，请稍后重试");
        if(n>maxPerMinute) {
            long retryAfter=60;
            try { Long ttl=redis.getExpire(key,TimeUnit.SECONDS); if(ttl!=null && ttl>=0) retryAfter=Math.max(1,ttl); }
            catch (RuntimeException ignored) { /* The accepted counter still proves this window is exhausted. */ }
            String operation=bucket.equals("skill-import") ? "Skill 导入较频繁" : "操作较频繁";
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED",operation+"，请在 "+retryAfter+" 秒后重试",Map.of("retryAfterSeconds",retryAfter));
        }
    }
    private static String poolLeaseKey(String accountId) { return "workbench:pool:lease:" + accountId; }
}
