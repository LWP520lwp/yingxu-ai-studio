package cn.musecanvas.api;

import java.io.Serializable;
import java.net.URI;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    public record User(String id, String name, String avatarUrl, String provider) implements Serializable {}
    public record ReviewerPrincipal(User user, String credentialVersion) implements Serializable {}
    /** Redis sessions retain only the platform identity and the stable public GitHub id. */
    public record GithubPrincipal(User user, String externalId) implements OAuth2User, Serializable {
        @Override public String getName() { return externalId; }
        @Override public Map<String, Object> getAttributes() { return Map.of("id", externalId); }
        @Override public Collection<? extends GrantedAuthority> getAuthorities() {
            return List.of(new SimpleGrantedAuthority("ROLE_USER"));
        }
    }
    private final JdbcTemplate jdbc;
    public UserService(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public User current(Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) return null;
        if (auth.getPrincipal() instanceof User user) return user;
        if (auth.getPrincipal() instanceof GithubPrincipal github) return github.user();
        if (auth.getPrincipal() instanceof ReviewerPrincipal reviewer) return reviewer.user();
        return null;
    }
    /** Called once by the verified OAuth user-info stage, never by ordinary API reads. */
    public GithubPrincipal githubUser(Map<String, Object> attributes) {
        String externalId = String.valueOf(attributes.get("id"));
        if (!externalId.matches("[1-9][0-9]{0,19}")) {
            throw new OAuth2AuthenticationException(new OAuth2Error("invalid_user_info"), "GitHub 没有返回有效的用户标识");
        }
        String name = displayText(attributes.get("name"));
        if (name.isBlank()) name = displayText(attributes.get("login"));
        if (name.isBlank()) name = "GitHub user";
        return new GithubPrincipal(upsert("github", externalId, name, avatar(attributes.get("avatar_url"))), externalId);
    }
    public User require(Authentication auth) {
        User user = current(auth);
        if (user == null) throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "请先登录");
        return user;
    }
    public User localUser() { return upsert("local", "loopback-developer", "本地创作者", ""); }
    public User reviewerUser(String username, String name) { return upsert("reviewer", username, displayText(name), ""); }
    private static String displayText(Object value) {
        if (!(value instanceof String text)) return "";
        String clean = text.codePoints().filter(c -> !Character.isISOControl(c))
            .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append).toString().strip();
        return clean.codePointCount(0, clean.length()) <= 255 ? clean : clean.substring(0, clean.offsetByCodePoints(0, 255));
    }
    private static String avatar(Object value) {
        if (!(value instanceof String text) || text.length() > 1024) return "";
        try {
            URI uri = URI.create(text);
            String normalized = uri.toASCIIString();
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                && uri.getUserInfo() == null && uri.getFragment() == null && normalized.length() <= 1024 ? normalized : "";
        } catch (IllegalArgumentException ex) { return ""; }
    }
    private User upsert(String provider, String externalId, String name, String avatar) {
        jdbc.update("INSERT INTO app_user(id,provider,external_id,display_name,avatar_url) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),avatar_url=VALUES(avatar_url)", UUID.randomUUID().toString(), provider, externalId, name, avatar);
        return jdbc.queryForObject("SELECT id,display_name,avatar_url,provider FROM app_user WHERE provider=? AND external_id=?", (rs,n) -> new User(rs.getString(1),rs.getString(2),rs.getString(3),rs.getString(4)), provider, externalId);
    }
}
