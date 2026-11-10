package cn.musecanvas.api;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api")
public class ScienceVideoController {
    public record Save(Long baseRevision,JsonNode document){}
    public record Plan(JsonNode document,String model){}
    public record Run(Long revision,String voiceId,Boolean generateMissingImages,String imageModel,
                      String productionMode,String videoModel,Integer videoDuration,String audioMode,Boolean generateMissingVideos){
        // Explicit Java callers of the original API keep their offline narration workflow.
        public Run(Long revision,String voiceId,Boolean generateMissingImages,String imageModel){
            this(revision,voiceId,generateMissingImages,imageModel,"image_narration",null,null,null,false);
        }
    }
    private final ScienceVideoService service;private final UserService users;private final RedisSupport redis;
    public ScienceVideoController(ScienceVideoService service,UserService users,RedisSupport redis){this.service=service;this.users=users;this.redis=redis;}
    @GetMapping("/science/capabilities") public ResponseEntity<Map<String,Object>> capabilities(Authentication auth){users.require(auth);return response(service.capabilities());}
    @GetMapping("/projects/{id}/science") public ResponseEntity<Map<String,Object>> get(Authentication auth,@PathVariable String id){return response(service.get(users.require(auth).id(),id));}
    @PutMapping("/projects/{id}/science") public ResponseEntity<Map<String,Object>> save(Authentication auth,@PathVariable String id,@RequestBody Save input){String owner=users.require(auth).id();redis.limit(owner,"science-save",120);if(input==null)throw ApiException.invalid("请填写科普文档");return response(service.save(owner,id,input.baseRevision(),input.document()));}
    @PostMapping("/projects/{id}/science/plan") public ResponseEntity<Map<String,Object>> plan(Authentication auth,@PathVariable String id,@RequestBody Plan input){String owner=users.require(auth).id();redis.limit(owner,"science-plan",10);if(input==null)throw ApiException.invalid("请填写讲稿或参考资料");return response(service.plan(owner,id,input.document(),input.model()));}
    @GetMapping("/projects/{id}/science/runs") public ResponseEntity<Map<String,Object>> runs(Authentication auth,@PathVariable String id){return response(Map.of("runs",service.runs(users.require(auth).id(),id)));}
    @PostMapping("/projects/{id}/science/runs") public ResponseEntity<Map<String,Object>> run(Authentication auth,@PathVariable String id,@RequestBody Run input){String owner=users.require(auth).id();redis.limit(owner,"science-run",6);if(input==null)throw ApiException.invalid("请先保存讲稿");return ResponseEntity.accepted().header("Cache-Control","no-store").body(service.createRun(owner,id,input));}
    @GetMapping("/projects/{id}/science/runs/{runId}") public ResponseEntity<Map<String,Object>> status(Authentication auth,@PathVariable String id,@PathVariable String runId){return response(service.run(users.require(auth).id(),id,runId));}
    private static ResponseEntity<Map<String,Object>> response(Map<String,Object> value){return ResponseEntity.ok().header("Cache-Control","no-store").body(value);}
}
