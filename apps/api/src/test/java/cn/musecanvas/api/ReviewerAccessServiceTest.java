package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.mock.env.MockEnvironment;

class ReviewerAccessServiceTest {
    private final MockEnvironment env=new MockEnvironment();
    private final UserService users=mock(UserService.class);
    private final RedisSupport limits=mock(RedisSupport.class);
    private final StringRedisTemplate redis=mock(StringRedisTemplate.class);
    private ReviewerAccessService access;
    @BeforeEach void setup() {
        env.setProperty("REVIEWER_USERNAME","reviewer-test");env.setProperty("REVIEWER_PASSWORD_HASH",ReviewerCredentialsTest.HASH);
        when(redis.opsForValue()).thenReturn(mock(ValueOperations.class));
        when(redis.execute(org.mockito.ArgumentMatchers.<RedisScript<Long>>any(),anyList())).thenReturn(1L);
        access=new ReviewerAccessService(env,users,limits,redis);
    }
    @Test void loginIsDisabledWithoutAnExplicitValidDeploymentCredential() {
        env.setProperty("REVIEWER_PASSWORD_HASH","");
        assertFalse(access.enabled());
        assertEquals("REVIEWER_LOGIN_DISABLED",assertThrows(ApiException.class,()->access.authenticate("any","any","127.0.0.1")).code);
        verifyNoInteractions(users,limits);
    }
    @Test void successCreatesANormalReviewIdentityAndClearsFailedAttempts() {
        var expected=new UserService.User("review-id","作品评审","","reviewer");
        when(users.reviewerUser("reviewer-test","作品评审")).thenReturn(expected);
        assertSame(expected,access.authenticate("reviewer-test","reviewer-unit-test-password","127.0.0.1"));
        verify(redis).delete(anyString());
        verify(limits).limit("127.0.0.1","reviewer-login-ip",8);
        verify(limits).limit("all","reviewer-login-global",60);
    }
    @Test void incorrectUsernamesAndPasswordsCannotCreateAnAccount() {
        assertEquals("REVIEWER_LOGIN_FAILED",assertThrows(ApiException.class,()->access.authenticate("wrong-user","reviewer-unit-test-password","127.0.0.1")).code);
        assertEquals("REVIEWER_LOGIN_FAILED",assertThrows(ApiException.class,()->access.authenticate("reviewer-test","wrong","127.0.0.1")).code);
        verifyNoInteractions(users);
        verify(redis,times(2)).execute(org.mockito.ArgumentMatchers.<RedisScript<Long>>any(),anyList());
    }
    @Test void fiveFailuresLockTheAccountAndRedisFailureDoesNotBypassVerification() {
        when(redis.opsForValue().get(anyString())).thenReturn("5");
        when(redis.getExpire(anyString(),eq(TimeUnit.SECONDS))).thenReturn(123L);
        var locked=assertThrows(ApiException.class,()->access.authenticate("reviewer-test","reviewer-unit-test-password","127.0.0.1"));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS,locked.status);assertEquals(123L,locked.details.get("retryAfterSeconds"));
        when(redis.opsForValue().get(anyString())).thenThrow(new IllegalStateException("unavailable"));
        assertEquals("REVIEWER_AUTH_UNAVAILABLE",assertThrows(ApiException.class,()->access.authenticate("reviewer-test","reviewer-unit-test-password","127.0.0.1")).code);
        verifyNoInteractions(users);
    }
    @Test void rotatingOrRemovingThePasswordChangesTheSessionVersion() {
        String before=access.credentialVersion();env.setProperty("REVIEWER_PASSWORD_HASH","");
        assertNotEquals(before,access.credentialVersion());assertFalse(access.enabled());
    }
}
