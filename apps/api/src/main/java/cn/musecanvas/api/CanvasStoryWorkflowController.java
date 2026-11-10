package cn.musecanvas.api;

import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api/projects/{projectId}/story-workflow")
public class CanvasStoryWorkflowController {
    public record Save(Long baseRevision,JsonNode document){}
    public record Task(Long revision,String operation){}
    private final CanvasStoryWorkflowService service;private final UserService users;private final RedisSupport redis;
    public CanvasStoryWorkflowController(CanvasStoryWorkflowService service,UserService users,RedisSupport redis){this.service=service;this.users=users;this.redis=redis;}
    @GetMapping public ResponseEntity<Map<String,Object>> get(Authentication auth,@PathVariable String projectId){return response(service.get(users.require(auth).id(),projectId));}
    @PutMapping public ResponseEntity<Map<String,Object>> save(Authentication auth,@PathVariable String projectId,@RequestBody Save input){String owner=users.require(auth).id();redis.limit(owner,"canvas-story-save",120);if(input==null)throw ApiException.invalid("请填写连续剧本工作流");return response(service.save(owner,projectId,input.baseRevision(),input.document()));}
    @GetMapping("/tasks") public ResponseEntity<Map<String,Object>> tasks(Authentication auth,@PathVariable String projectId){return response(Map.of("tasks",service.tasks(users.require(auth).id(),projectId)));}
    @PostMapping("/tasks") public ResponseEntity<Map<String,Object>> create(Authentication auth,@PathVariable String projectId,@RequestBody Task input){String owner=users.require(auth).id();redis.limit(owner,"canvas-story-plan",10);if(input==null)throw ApiException.invalid("请先保存工作流");return ResponseEntity.accepted().header("Cache-Control","no-store").body(service.create(owner,projectId,input.revision(),input.operation()));}
    @PostMapping("/tasks/{taskId}/cancel") public ResponseEntity<Map<String,Object>> cancel(Authentication auth,@PathVariable String projectId,@PathVariable String taskId){String owner=users.require(auth).id();redis.limit(owner,"canvas-story-cancel",30);return response(service.cancel(owner,projectId,taskId));}
    private static ResponseEntity<Map<String,Object>> response(Map<String,Object> value){return ResponseEntity.ok().header("Cache-Control","no-store").body(value);}
}
