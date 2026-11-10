package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class GithubRedirectSettingsTest {
    @Test void developmentDefaultUsesCanonicalLocalhostAndConfiguredPort(){
        var env=new MockEnvironment();env.setActiveProfiles("dev");var settings=new AppSettings(env);
        assertEquals("http://localhost:8088/login/oauth2/code/github",settings.githubRedirectUri());
        env.withProperty("APP_PORT","8099");assertEquals("http://localhost:8099/login/oauth2/code/github",settings.githubRedirectUri());
        assertEquals("http://localhost:8099/oauth2/authorization/github",settings.githubLoginUrl());
    }
    @Test void explicitPublicCallbackPreservesTheCanonicalOriginAndPathPrefix(){
        var env=new MockEnvironment().withProperty("app.github-redirect-uri","https://studio.example.org/workbench/login/oauth2/code/github");env.setActiveProfiles("prod");var settings=new AppSettings(env);
        assertEquals("https://studio.example.org/workbench/login/oauth2/code/github",settings.githubRedirectUri());
        assertEquals("https://studio.example.org/workbench/oauth2/authorization/github",settings.githubLoginUrl());
    }
    @Test void credentialsQueriesFragmentsAndInvalidCallbackPathsAreRejected(){
        for(String value:new String[]{"https://user:pass@example.org/login/oauth2/code/github","https://example.org/login/oauth2/code/github?extra=1","https://example.org/login/oauth2/code/github#fragment","/login/oauth2/code/github","https://example.org/other-callback"}){
            var env=new MockEnvironment().withProperty("app.github-redirect-uri",value);env.setActiveProfiles("dev");assertThrows(IllegalStateException.class,()->new AppSettings(env).githubRedirectUri());
        }
    }
    @Test void productionCannotFallBackToTheDevelopmentCallback(){
        var env=new MockEnvironment();env.setActiveProfiles("prod");assertThrows(IllegalStateException.class,()->new AppSettings(env).githubRedirectUri());
        env.withProperty("app.github-redirect-uri","http://studio.example.org/login/oauth2/code/github");assertThrows(IllegalStateException.class,()->new AppSettings(env).githubRedirectUri());
        env.withProperty("app.github-redirect-uri","https://localhost/login/oauth2/code/github");assertThrows(IllegalStateException.class,()->new AppSettings(env).githubRedirectUri());
    }
}
