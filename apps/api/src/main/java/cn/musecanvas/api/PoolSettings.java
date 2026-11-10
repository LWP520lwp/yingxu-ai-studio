package cn.musecanvas.api;

import java.net.URI;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.core.env.Environment;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

@Component
public class PoolSettings {
    private final AppSettings app;
    private final Environment env;

    public PoolSettings(AppSettings app, Environment env) {
        this.app = app;
        this.env = env;
    }

    public boolean enabled() {
        String value = env.getProperty("app.pool-overview-enabled", "").trim();
        return value.isBlank() ? app.localEnabled() : "true".equalsIgnoreCase(value);
    }

    public boolean mayRead(UserService.User user, Authentication auth, String remoteAddress) {
        if (user == null || auth == null || !auth.isAuthenticated() || !loopbackAddress(remoteAddress)) return false;
        if (app.localEnabled() && "local".equals(user.provider())) return true;
        Set<String> owners = Arrays.stream(env.getProperty("app.pool-overview-owner-ids", "").split(","))
            .map(String::trim).filter(s -> !s.isBlank()).collect(Collectors.toUnmodifiableSet());
        return owners.contains(user.id()) || auth.getAuthorities().stream().anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
    }

    public boolean mayManage(UserService.User user, Authentication auth, String remoteAddress) {
        return mayRead(user, auth, remoteAddress);
    }

    static boolean loopbackAddress(String address) {
        return Set.of("127.0.0.1", "::1", "0:0:0:0:0:0:0:1").contains(address == null ? "" : address);
    }

    static URI loopbackBase(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
            if (host != null && host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length() - 1);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || !loopbackAddress(host) || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                || uri.getRawFragment() != null || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))
                || uri.getPort() == 0 || uri.getPort() > 65535) return null;
            return URI.create(value.replaceAll("/+$", ""));
        } catch (RuntimeException invalid) {
            return null;
        }
    }
}
