package cn.musecanvas.api;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/projects/{projectId}/rag")
public class RagController {
    public record Document(String id, String title, String sourceUrl, String content, JsonNode metadata) {}
    public record Search(String query, Integer topK) {}
    private final RagService service;
    private final UserService users;
    private final RedisSupport redis;
    public RagController(RagService service, UserService users, RedisSupport redis) { this.service = service; this.users = users; this.redis = redis; }
    @GetMapping("/documents") public List<Map<String, Object>> documents(Authentication auth, @PathVariable String projectId) { return service.documents(users.require(auth).id(), projectId); }
    @PostMapping("/documents") @ResponseStatus(HttpStatus.CREATED) public Map<String, Object> upsert(Authentication auth, @PathVariable String projectId, @RequestBody Document input) { String owner = users.require(auth).id(); redis.limit(owner, "rag-write", 60); if (input == null) throw ApiException.invalid("知识文档不能为空"); return service.upsert(owner, projectId, new RagService.Input(input.id(), input.title(), input.sourceUrl(), input.content(), input.metadata())); }
    @DeleteMapping("/documents/{documentId}") public Map<String, Object> delete(Authentication auth, @PathVariable String projectId, @PathVariable String documentId) { String owner = users.require(auth).id(); redis.limit(owner, "rag-write", 60); return service.delete(owner, projectId, documentId); }
    @PostMapping("/search") public Map<String, Object> search(Authentication auth, @PathVariable String projectId, @RequestBody Search input) { String owner = users.require(auth).id(); redis.limit(owner, "rag-search", 240); if (input == null) throw ApiException.invalid("检索问题不能为空"); return service.search(owner, projectId, input.query(), input.topK()); }
}
