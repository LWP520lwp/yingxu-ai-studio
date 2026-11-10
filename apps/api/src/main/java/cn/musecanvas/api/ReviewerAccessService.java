package cn.musecanvas.api;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** One deployment-configured review identity; no public signup or administrative role. */
@Service
public class ReviewerAccessService {
    private static final DefaultRedisScript<Long> FAIL = new DefaultRedisScript<>("local n=redis.call('INCR',KEYS[1]); if redis.call('TTL',KEYS[1])<0 then redis.call('EXPIRE',KEYS[1],900) end; return n", Long.class);
    private final Environment env;
    private final UserService users;
    private final RedisSupport limits;
    private final StringRedisTemplate redis;
    public ReviewerAccessService(Environment env, UserService users, RedisSupport limits, StringRedisTemplate redis) { this.env=env;this.users=users;this.limits=limits;this.redis=redis; }
    private String configured(String key) { return env.getProperty(key, "").trim(); }
    public boolean enabled() { return configured("REVIEWER_USERNAME").matches("[A-Za-z0-9][A-Za-z0-9._-]{3,63}") && ReviewerCredentials.validHash(configured("REVIEWER_PASSWORD_HASH")); }
    String credentialVersion() { return Json.hash(configured("REVIEWER_USERNAME")+"\n"+configured("REVIEWER_PASSWORD_HASH")); }
    public UserService.User authenticate(String username, String password, String address) {
        if (!enabled()) throw new ApiException(HttpStatus.NOT_FOUND,"REVIEWER_LOGIN_DISABLED","评审登录未开放");
        limits.limit(address,"reviewer-login-ip",8);
        limits.limit("all","reviewer-login-global",60);
        if (username==null||username.length()>64||password==null||password.length()>256) throw denied();
        String expected=configured("REVIEWER_USERNAME");
        String key="workbench:reviewer:failures:"+Json.hash(expected);
        try {
            String previous=redis.opsForValue().get(key);
            if (previous!=null&&Integer.parseInt(previous)>=5) {
                Long ttl=redis.getExpire(key,TimeUnit.SECONDS);
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"REVIEWER_LOGIN_LOCKED","评审账号验证失败次数较多，请稍后重试",Map.of("retryAfterSeconds",ttl==null||ttl<1?900:ttl));
            }
            // Verify the configured hash for both matching and unknown usernames.
            boolean passwordMatches=ReviewerCredentials.matches(password,configured("REVIEWER_PASSWORD_HASH"));
            boolean usernameMatches=MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),username.getBytes(StandardCharsets.UTF_8));
            if (!usernameMatches||!passwordMatches) {
                Long failures=redis.execute(FAIL,List.of(key));
                if(failures==null||failures<1)throw new IllegalStateException("Login failure counter is unavailable");
                throw denied();
            }
            redis.delete(key);
        } catch (ApiException ex) { throw ex; }
        catch (RuntimeException ex) { throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"REVIEWER_AUTH_UNAVAILABLE","评审登录验证暂不可用，请稍后重试"); }
        String display=configured("REVIEWER_DISPLAY_NAME");
        return users.reviewerUser(expected,display.isBlank()?"作品评审":display);
    }
    private static ApiException denied() { return new ApiException(HttpStatus.UNAUTHORIZED,"REVIEWER_LOGIN_FAILED","账号或密码不正确"); }
}
