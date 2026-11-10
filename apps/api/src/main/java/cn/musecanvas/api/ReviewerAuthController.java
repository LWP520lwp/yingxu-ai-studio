package cn.musecanvas.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth/reviewer")
public class ReviewerAuthController {
    public record Login(String username,String password) {}
    private final ReviewerAccessService access;
    public ReviewerAuthController(ReviewerAccessService access) { this.access=access; }
    @GetMapping("/config")
    public ResponseEntity<Map<String,Boolean>> config() { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("enabled",access.enabled())); }
    @PostMapping
    public ResponseEntity<UserService.User> login(@RequestBody Login input,HttpServletRequest req,HttpServletResponse res) {
        if(input==null)throw ApiException.invalid("请填写评审账号和密码");
        var user=access.authenticate(input.username(),input.password(),req.getRemoteAddr());
        if(req.getSession(false)!=null)req.changeSessionId();
        var context=SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(new UserService.ReviewerPrincipal(user,access.credentialVersion()),"",List.of(new SimpleGrantedAuthority("ROLE_USER"),new SimpleGrantedAuthority("ROLE_REVIEWER"))));
        SecurityContextHolder.setContext(context);
        new HttpSessionSecurityContextRepository().saveContext(context,req,res);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(user);
    }
}
