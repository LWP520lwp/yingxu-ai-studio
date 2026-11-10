package cn.musecanvas.api;

import java.nio.file.Path;
import java.util.Arrays;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class AppSettings {
    private final Environment env;
    public AppSettings(Environment env) { this.env = env; }
    public String frontendUrl() { return env.getProperty("app.frontend-url", "http://localhost:5178"); }
    public Path storageRoot() { return Path.of(env.getProperty("app.storage-root", "./data/assets")).toAbsolutePath().normalize(); }
    public boolean localEnabled() { var profiles=Arrays.asList(env.getActiveProfiles());return profiles.contains("dev")&&!profiles.contains("prod")&&!profiles.contains("production"); }
    public String githubId() { return env.getProperty("app.github-client-id", "").trim(); }
    public String githubSecret() { return env.getProperty("app.github-client-secret", "").trim(); }
    public boolean githubEnabled() { return !githubId().isBlank() && !githubSecret().isBlank(); }
    public String githubRedirectUri() {
        String configured=env.getProperty("app.github-redirect-uri", "").trim();
        var profiles=Arrays.asList(env.getActiveProfiles());boolean production=profiles.contains("prod")||profiles.contains("production");
        if(configured.isBlank()){
            if(production)throw new IllegalStateException("生产 GitHub 登录必须显式配置 GITHUB_REDIRECT_URI");
            int port=env.getProperty("APP_PORT",Integer.class,env.getProperty("server.port",Integer.class,8088));
            configured="http://localhost:"+port+"/login/oauth2/code/github";
        }
        final java.net.URI uri;
        try{uri=java.net.URI.create(configured);}catch(IllegalArgumentException e){throw new IllegalStateException("GITHUB_REDIRECT_URI 必须为有效的绝对 HTTP(S) 回调地址");}
        String host=uri.getHost();
        if(!java.util.Set.of("http","https").contains(uri.getScheme()==null?"":uri.getScheme())||host==null||uri.getUserInfo()!=null
            ||uri.getRawQuery()!=null||uri.getRawFragment()!=null||(uri.getPort()!=-1&&(uri.getPort()<1||uri.getPort()>65535))
            ||uri.getRawPath()==null||!uri.getRawPath().endsWith("/login/oauth2/code/github"))
            throw new IllegalStateException("GITHUB_REDIRECT_URI 必须为不含凭据、query 或 fragment 的完整 GitHub 回调地址");
        if(production&&(!"https".equals(uri.getScheme())||java.util.Set.of("localhost","127.0.0.1","::1","[::1]").contains(host.toLowerCase(java.util.Locale.ROOT))))
            throw new IllegalStateException("生产 GITHUB_REDIRECT_URI 必须使用公开 HTTPS 地址");
        return uri.toASCIIString();
    }
    public String githubLoginUrl() {
        var uri=java.net.URI.create(githubRedirectUri());String suffix="/login/oauth2/code/github";
        String prefix=uri.getRawPath().substring(0,uri.getRawPath().length()-suffix.length());
        return uri.getScheme()+"://"+uri.getRawAuthority()+prefix+"/oauth2/authorization/github";
    }
    public String museBaseUrl() { return env.getProperty("app.muse-base-url", "http://127.0.0.1:18610").replaceAll("/+$", ""); }
    public String museKey() { return env.getProperty("app.muse-api-key", "").trim(); }
    public boolean museLocalKeyRequested() { return env.getProperty("app.muse-local-key-enabled", Boolean.class, false); }
    public String museLocalPoolUrl() { return env.getProperty("app.muse-local-pool-url", "").trim(); }
    public java.util.Set<String> museMediaAllowedHosts() { return Arrays.stream(env.getProperty("app.muse-media-allowed-hosts", "").split(",")).map(String::trim).filter(s->!s.isBlank()).map(s->s.toLowerCase(java.util.Locale.ROOT)).collect(java.util.stream.Collectors.toUnmodifiableSet()); }
    public int workerConcurrency() { return Math.max(1, Math.min(8, env.getProperty("app.worker-concurrency", Integer.class, 2))); }
    public int providerTimeout() { return env.getProperty("app.provider-timeout-seconds", Integer.class, 120); }
    public int maxDocumentBytes() { return env.getProperty("app.max-document-bytes", Integer.class, 2097152); }
    public boolean schedulerEnabled() { return env.getProperty("app.scheduler-enabled", Boolean.class, true); }
    public String browserWorkerUrl() { return env.getProperty("app.browser-worker-url", "http://127.0.0.1:8091").trim(); }
    public String browserWorkerToken() { return env.getProperty("app.browser-worker-token", "").trim(); }
    public boolean browserInteractiveLoginEnabled() { return env.getProperty("app.browser-interactive-login-enabled", Boolean.class, false); }
    public String poolCredentialMasterKey() { return env.getProperty("app.pool-credential-master-key", "").trim(); }
}
