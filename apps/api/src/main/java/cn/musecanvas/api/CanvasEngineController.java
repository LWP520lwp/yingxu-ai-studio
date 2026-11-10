package cn.musecanvas.api;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/projects/{projectId}/canvas-engine")
public class CanvasEngineController {
    public record SnapshotInput(Long baseRevision, JsonNode document) {}
    private final UserService users;
    private final RedisSupport redis;
    private final CanvasEngineService snapshots;

    public CanvasEngineController(UserService users, RedisSupport redis, CanvasEngineService snapshots) {
        this.users = users;
        this.redis = redis;
        this.snapshots = snapshots;
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> get(Authentication auth, @PathVariable String projectId) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(snapshots.get(users.require(auth).id(), projectId));
    }

    @PutMapping
    public ResponseEntity<Map<String, Object>> save(Authentication auth, @PathVariable String projectId, @RequestBody SnapshotInput input) {
        String owner = users.require(auth).id();
        redis.limit(owner, "mutation", 240);
        if (input == null) throw ApiException.invalid("快照请求不能为空");
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(snapshots.save(owner, projectId, input.baseRevision(), input.document()));
    }
}
