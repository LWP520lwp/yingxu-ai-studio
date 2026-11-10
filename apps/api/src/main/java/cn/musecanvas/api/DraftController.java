package cn.musecanvas.api;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/drafts")
public class DraftController {
    public record Create(String kind, String title) {}
    public record Rename(String kind, String title, Long baseRevision) {}
    private final DraftService drafts;
    private final UserService users;
    private final RedisSupport redis;

    public DraftController(DraftService drafts, UserService users, RedisSupport redis) {
        this.drafts = drafts; this.users = users; this.redis = redis;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> list(Authentication auth, @RequestParam String kind,
        @RequestParam(required=false) String q, @RequestParam(required=false) Integer limit,
        @RequestParam(required=false) String cursor) {
        String owner = users.require(auth).id();
        redis.limit(owner, "draft-list", 180);
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(drafts.list(owner, kind, q, limit, cursor));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(Authentication auth, @RequestBody Create input) {
        String owner = users.require(auth).id();
        redis.limit(owner, "mutation", 240);
        if (input == null) throw ApiException.invalid("请选择草稿类型");
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store").body(drafts.create(owner, input.kind(), input.title()));
    }

    @PatchMapping("/{projectId}")
    public ResponseEntity<Map<String, Object>> rename(Authentication auth, @PathVariable String projectId, @RequestBody Rename input) {
        String owner = users.require(auth).id();
        redis.limit(owner, "mutation", 240);
        if (input == null) throw ApiException.invalid("请填写草稿名称");
        return ResponseEntity.ok().header("Cache-Control", "no-store")
            .body(drafts.rename(owner, projectId, input.kind(), input.title(), input.baseRevision()));
    }
}
