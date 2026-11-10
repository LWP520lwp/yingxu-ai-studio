package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class OriginGuardTest {
    private SecurityConfig.OriginGuard guard(){return new SecurityConfig.OriginGuard(new AppSettings(new MockEnvironment().withProperty("app.frontend-url","http://localhost:5178")));}
    @Test void sessionMutationsRequireTheCustomHeaderEvenWithoutAnOrigin()throws Exception{
        var request=new MockHttpServletRequest("POST","/api/projects");var response=new MockHttpServletResponse();var called=new AtomicBoolean();
        guard().doFilter(request,response,(req,res)->called.set(true));assertEquals(403,response.getStatus());assertFalse(called.get());
    }
    @Test void forgedBrowserOriginsAreRejectedEvenWithTheHeader()throws Exception{
        var request=new MockHttpServletRequest("PUT","/api/projects/id");request.addHeader("Origin","https://attacker.example");request.addHeader("X-Workbench-Request","1");var response=new MockHttpServletResponse();
        guard().doFilter(request,response,(req,res)->fail("Cross-site request reached application"));assertEquals(403,response.getStatus());
    }
    @Test void trustedFrontendAndHeaderAreAccepted()throws Exception{
        var request=new MockHttpServletRequest("POST","/api/auth/local");request.addHeader("Origin","http://localhost:5178");request.addHeader("X-Workbench-Request","1");var response=new MockHttpServletResponse();var called=new AtomicBoolean();
        guard().doFilter(request,response,(req,res)->called.set(true));assertTrue(called.get());
    }
}
