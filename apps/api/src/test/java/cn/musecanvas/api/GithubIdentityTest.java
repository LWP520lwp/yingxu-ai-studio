package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

class GithubIdentityTest {
    @Test void invalidProviderIdsCannotCreatePlatformAccounts(){
        var jdbc=mock(JdbcTemplate.class);var users=new UserService(jdbc);
        assertThrows(OAuth2AuthenticationException.class,()->users.githubUser(Map.of("login","someone")));
        for(String id:List.of("null","0","-1","alice","1.5","","1 OR 1=1"))assertThrows(OAuth2AuthenticationException.class,()->users.githubUser(Map.of("id",id)));
        verifyNoInteractions(jdbc);
    }
    @Test void subsequentSessionReadsCannotUpsertOrTrustAnUnmappedOauthProfile(){
        var jdbc=mock(JdbcTemplate.class);var users=new UserService(jdbc);
        var user=new UserService.User("platform-user","Alice","","github");var principal=new UserService.GithubPrincipal(user,"12345");
        var auth=new OAuth2AuthenticationToken(principal,principal.getAuthorities(),"github");
        assertSame(user,users.current(auth));assertSame(user,users.require(auth));
        var raw=new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),Map.of("id",12345L),"id");
        assertNull(users.current(new OAuth2AuthenticationToken(raw,raw.getAuthorities(),"github")));
        verifyNoInteractions(jdbc);
    }
}
