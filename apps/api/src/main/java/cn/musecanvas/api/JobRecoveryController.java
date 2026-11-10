package cn.musecanvas.api;

import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/jobs")
public class JobRecoveryController {
    private final UserService users;private final RedisSupport redis;private final JobRecoveryService recovery;
    public JobRecoveryController(UserService users,RedisSupport redis,JobRecoveryService recovery){this.users=users;this.redis=redis;this.recovery=recovery;}
    @PostMapping("/{id}/recover")
    public Map<String,Object> recover(Authentication authentication,@PathVariable String id){String owner=users.require(authentication).id();redis.limit(owner,"job-recovery",12);return recovery.recover(owner,id);}
}
