package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.HttpStatus;

class RedisSupportTest {
    @Test void exhaustedImportWindowReturnsTheRemainingTimeInBodyAndHeader() {
        var redis=mock(StringRedisTemplate.class);
        when(redis.execute(org.mockito.ArgumentMatchers.<RedisScript<Long>>any(),eq(List.of("workbench:rate:skill-import:owner")),eq("60"))).thenReturn(13L);
        when(redis.getExpire("workbench:rate:skill-import:owner",TimeUnit.SECONDS)).thenReturn(19L);
        var error=assertThrows(ApiException.class,()->new RedisSupport(redis).limit("owner","skill-import",12));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS,error.status);
        assertEquals("RATE_LIMITED",error.code);
        assertEquals(19L,error.details.get("retryAfterSeconds"));
        assertTrue(error.getMessage().contains("Skill 导入"));
        assertTrue(error.getMessage().contains("19 秒"));
        var response=new ApiErrorHandler().api(error);
        assertEquals("19",response.getHeaders().getFirst("Retry-After"));
        assertEquals(19L,response.getBody().get("retryAfterSeconds"));
    }

    @Test void aMissingCounterResultIsUnavailableRatherThanFalseRateLimiting() {
        var redis=mock(StringRedisTemplate.class);
        var error=assertThrows(ApiException.class,()->new RedisSupport(redis).limit("owner","skill-import",12));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,error.status);
        assertEquals("REDIS_UNAVAILABLE",error.code);
        assertFalse(error.details.containsKey("retryAfterSeconds"));
    }

    @Test void anExpiredWindowReportsAtLeastOneSecondAndAllowedRequestsDoNotReadItsTtl() {
        var redis=mock(StringRedisTemplate.class);
        when(redis.execute(org.mockito.ArgumentMatchers.<RedisScript<Long>>any(),anyList(),eq("60"))).thenReturn(12L,13L);
        when(redis.getExpire(anyString(),eq(TimeUnit.SECONDS))).thenReturn(0L);
        var support=new RedisSupport(redis);
        assertDoesNotThrow(()->support.limit("owner","skill-import",12));
        verify(redis,never()).getExpire(anyString(),any(TimeUnit.class));
        var error=assertThrows(ApiException.class,()->support.limit("owner","skill-import",12));
        assertEquals(1L,error.details.get("retryAfterSeconds"));
    }
}
