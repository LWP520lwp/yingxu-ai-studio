package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;

class ReviewerAuthControllerTest {
    @AfterEach void clearContext(){SecurityContextHolder.clearContext();}
    @Test void loginRotatesAnExistingSessionAndNeverGrantsAdministration() {
        var access=mock(ReviewerAccessService.class);
        var user=new UserService.User("judge-id","作品评审","","reviewer");
        when(access.authenticate("judge","private-password","127.0.0.1")).thenReturn(user);
        when(access.credentialVersion()).thenReturn("version");
        var req=new MockHttpServletRequest();req.setRemoteAddr("127.0.0.1");String before=req.getSession().getId();
        var response=new ReviewerAuthController(access).login(new ReviewerAuthController.Login("judge","private-password"),req,new MockHttpServletResponse());
        assertSame(user,response.getBody());assertEquals("no-store",response.getHeaders().getCacheControl());
        assertNotEquals(before,req.getSession().getId());
        var auth=SecurityContextHolder.getContext().getAuthentication();
        assertEquals(List.of("ROLE_USER","ROLE_REVIEWER"),auth.getAuthorities().stream().map(a->a.getAuthority()).toList());
        assertEquals("",auth.getCredentials());
        assertSame(user,new UserService(null).current(auth));
        assertNotNull(req.getSession().getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY));
    }
    @Test void disablingCredentialsInvalidatesAlreadyAuthenticatedSessions() throws Exception {
        var access=mock(ReviewerAccessService.class);when(access.enabled()).thenReturn(false);
        var user=new UserService.User("judge-id","作品评审","","reviewer");
        SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(new UserService.ReviewerPrincipal(user,"old"),"",List.of(new SimpleGrantedAuthority("ROLE_USER"))));
        var req=new MockHttpServletRequest();req.getSession();var res=new MockHttpServletResponse();
        new SecurityConfig.ReviewerSessionGuard(access).doFilter(req,res,(request,response)->fail("Revoked sessions must not reach protected code"));
        assertEquals(401,res.getStatus());assertTrue(res.getContentAsString().contains("REVIEWER_SESSION_EXPIRED"));
        assertNull(req.getSession(false));assertNull(SecurityContextHolder.getContext().getAuthentication());
    }
}
