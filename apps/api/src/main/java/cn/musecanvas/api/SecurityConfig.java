package cn.musecanvas.api;

import java.io.IOException;
import java.net.URI;
import java.util.Set;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, AppSettings settings, UserService users, ReviewerAccessService reviewerAccess) throws Exception {
        http.csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.GET, "/api/skills", "/api/skills/*").permitAll()
                .requestMatchers("/api/bootstrap", "/api/auth/local", "/api/auth/reviewer/config", "/api/auth/reviewer", "/api/auth/logout", "/actuator/health", "/error", "/oauth2/**", "/login/**").permitAll()
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .anyRequest().authenticated())
            .exceptionHandling(e -> e.authenticationEntryPoint((req,res,ex) -> {
                res.setStatus(401); res.setContentType("application/json;charset=UTF-8");
                res.getWriter().write(Json.write(java.util.Map.of("code","UNAUTHENTICATED","message","请先登录")));
            }))
            .addFilterBefore(new OriginGuard(settings), AnonymousAuthenticationFilter.class)
            .addFilterBefore(new ReviewerSessionGuard(reviewerAccess), AnonymousAuthenticationFilter.class)
            .logout(l -> l.disable())
            .requestCache(c -> c.disable());
        if (settings.githubEnabled()) {
            var github = ClientRegistration.withRegistrationId("github")
                .clientId(settings.githubId()).clientSecret(settings.githubSecret())
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri(settings.githubRedirectUri())
                .authorizationUri("https://github.com/login/oauth/authorize")
                .tokenUri("https://github.com/login/oauth/access_token")
                .userInfoUri("https://api.github.com/user").userNameAttributeName("id").clientName("GitHub").build();
            http.oauth2Login(o -> o.clientRegistrationRepository(new InMemoryClientRegistrationRepository(github))
                .userInfoEndpoint(u -> u.userService(request -> users.githubUser(new DefaultOAuth2UserService().loadUser(request).getAttributes())))
                .authorizedClientRepository(new LoginOnlyAuthorizedClients())
                .successHandler((req,res,auth) -> res.sendRedirect(settings.frontendUrl()))
                .failureHandler((req,res,ex) -> res.sendRedirect(settings.frontendUrl()+"?authError=github")));
        }
        return http.build();
    }

    /** GitHub grants authenticate users only; this platform never needs to retain access tokens. */
    static class LoginOnlyAuthorizedClients implements OAuth2AuthorizedClientRepository {
        @Override public <T extends OAuth2AuthorizedClient> T loadAuthorizedClient(String id, Authentication principal, HttpServletRequest request) { return null; }
        @Override public void saveAuthorizedClient(OAuth2AuthorizedClient client, Authentication principal, HttpServletRequest request, HttpServletResponse response) {}
        @Override public void removeAuthorizedClient(String id, Authentication principal, HttpServletRequest request, HttpServletResponse response) {}
    }

    /** Disabling or rotating review credentials also revokes existing review sessions. */
    static class ReviewerSessionGuard extends OncePerRequestFilter {
        private final ReviewerAccessService access;
        ReviewerSessionGuard(ReviewerAccessService access) { this.access=access; }
        @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain)throws ServletException,IOException {
            var auth=org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            if(auth!=null&&auth.getPrincipal() instanceof UserService.ReviewerPrincipal principal
                &&(!access.enabled()||!access.credentialVersion().equals(principal.credentialVersion()))) {
                org.springframework.security.core.context.SecurityContextHolder.clearContext();
                if(req.getSession(false)!=null)req.getSession(false).invalidate();
                res.setStatus(401);res.setContentType("application/json;charset=UTF-8");
                res.getWriter().write(Json.write(java.util.Map.of("code","REVIEWER_SESSION_EXPIRED","message","评审会话已失效，请重新登录")));return;
            }
            chain.doFilter(req,res);
        }
    }

    // Session mutations accept only the configured browser origin. OAuth uses its own state validation.
    static class OriginGuard extends OncePerRequestFilter {
        private final String allowed;
        OriginGuard(AppSettings settings) { allowed = origin(settings.frontendUrl()); }
        static String origin(String value) {
            try { URI uri=URI.create(value); return uri.getScheme()+"://"+uri.getAuthority(); }
            catch (Exception e) { return ""; }
        }
        protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
            if (req.getRequestURI().startsWith("/api/") && !Set.of("GET","HEAD","OPTIONS").contains(req.getMethod())) {
                String requestOrigin=req.getHeader("Origin");
                if (!"1".equals(req.getHeader("X-Workbench-Request"))
                    || (requestOrigin!=null && !origin(requestOrigin).equals(allowed))
                    || "cross-site".equals(req.getHeader("Sec-Fetch-Site"))) {
                    res.setStatus(403);res.setContentType("application/json;charset=UTF-8");
                    res.getWriter().write(Json.write(java.util.Map.of("code","ORIGIN_REJECTED","message","变更请求需要可信来源和 X-Workbench-Request: 1")));return;
                }
            }
            chain.doFilter(req,res);
        }
    }
}
