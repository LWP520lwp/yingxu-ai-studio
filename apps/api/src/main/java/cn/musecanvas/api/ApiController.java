package cn.musecanvas.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/api")
public class ApiController {
    public record ProjectInput(String title,JsonNode document,Long baseRevision) {}
    private final AppSettings settings;private final UserService users;private final WorkbenchStore store;private final AssetService assets;private final JobService jobs;private final RedisSupport redis;private final JobEvents events;
    private final MuseProvider provider;
    private final SkillService skills;
    private final NativePoolService nativePool;
    private final ChannelService channels;
    public ApiController(AppSettings settings,UserService users,WorkbenchStore store,AssetService assets,JobService jobs,RedisSupport redis,JobEvents events,MuseProvider provider,SkillService skills,NativePoolService nativePool,ChannelService channels){this.settings=settings;this.users=users;this.store=store;this.assets=assets;this.jobs=jobs;this.redis=redis;this.events=events;this.provider=provider;this.skills=skills;this.nativePool=nativePool;this.channels=channels;}
    @GetMapping("/bootstrap")
    public Map<String,Object> bootstrap(Authentication auth){
        var current=users.current(auth);var result=new LinkedHashMap<String,Object>();result.put("user",current);
        result.put("auth",Map.of("githubEnabled",settings.githubEnabled(),"localEnabled",settings.localEnabled(),"githubLoginUrl",settings.githubEnabled()?settings.githubLoginUrl():"/oauth2/authorization/github"));
        result.put("models",channels.mergeModels(current==null?null:current.id(),nativePool.modelSnapshot(current==null?null:current.id()).models()));
        result.put("skills",skills.directory(current==null?null:current.id()));
        result.put("integration",nativePool.integration(current==null?null:current.id()));return result;
    }
    @PostMapping("/auth/local")
    public UserService.User local(HttpServletRequest request,HttpServletResponse response){
        if(!settings.localEnabled()||!Set.of("127.0.0.1","0:0:0:0:0:0:0:1","::1").contains(request.getRemoteAddr()))throw new ApiException(HttpStatus.FORBIDDEN,"LOCAL_AUTH_DISABLED","本地会话只允许开发环境的回环访问");
        redis.limit(request.getRemoteAddr(),"local-auth",30);var user=users.localUser();
        if(request.getSession(false)!=null)request.changeSessionId();
        var context=SecurityContextHolder.createEmptyContext();context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user,"",List.of(new SimpleGrantedAuthority("ROLE_USER"))));SecurityContextHolder.setContext(context);
        new HttpSessionSecurityContextRepository().saveContext(context,request,response);return user;
    }
    @PostMapping("/auth/logout") public Map<String,Object> logout(Authentication auth,HttpServletRequest req,HttpServletResponse res){new SecurityContextLogoutHandler().logout(req,res,auth);return Map.of("ok",true);}
    @GetMapping("/projects") public JsonNode projects(Authentication auth){return store.projects(users.require(auth).id());}
    @PostMapping("/projects") @ResponseStatus(HttpStatus.CREATED)
    public Map<String,Object> createProject(Authentication auth,@RequestBody ProjectInput input){String owner=users.require(auth).id();redis.limit(owner,"mutation",240);return store.createProject(owner,input.title(),input.document()==null?Json.read("{}"):input.document());}
    @GetMapping("/projects/{id}") public Map<String,Object> project(Authentication auth,@PathVariable String id){return store.project(users.require(auth).id(),id);}
    @PutMapping("/projects/{id}") public Map<String,Object> saveProject(Authentication auth,@PathVariable String id,@RequestBody ProjectInput input){String owner=users.require(auth).id();redis.limit(owner,"mutation",240);if(input.baseRevision()==null)throw ApiException.invalid("baseRevision 必填");return store.saveProject(owner,id,input.baseRevision(),input.title(),input.document());}
    @GetMapping("/assets") public List<Map<String,Object>> assets(Authentication auth,@RequestParam(required=false)String projectId){return store.assets(users.require(auth).id(),projectId);}
    @PostMapping(value="/assets",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) @ResponseStatus(HttpStatus.CREATED)
    public Map<String,Object> upload(Authentication auth,@RequestParam MultipartFile file,@RequestParam(required=false)String projectId){String owner=users.require(auth).id();redis.limit(owner,"upload",30);return assets.upload(owner,projectId,file);}
    @GetMapping("/assets/{id}/content") public ResponseEntity<Resource> content(Authentication auth,@PathVariable String id){
        String owner=users.require(auth).id();var asset=store.asset(owner,id);String mime=String.valueOf(asset.get("mimeType"));boolean inline=mime.startsWith("image/")||mime.startsWith("audio/")||mime.startsWith("video/");
        ContentDisposition disposition=(inline?ContentDisposition.inline():ContentDisposition.attachment()).filename(String.valueOf(asset.get("name")),StandardCharsets.UTF_8).build();
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION,disposition.toString()).header("X-Content-Type-Options","nosniff").header(HttpHeaders.CACHE_CONTROL,"private, max-age=300").contentType(MediaType.parseMediaType(mime)).body(new FileSystemResource(assets.content(owner,id)));
    }
    @PostMapping("/jobs") @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String,Object> submit(Authentication auth,@RequestHeader(value="Idempotency-Key",required=false)String key,@RequestBody JobService.Request request){String owner=users.require(auth).id();redis.limit(owner,"generation",12);return jobs.submit(owner,key,request);}
    @GetMapping("/jobs") public List<Map<String,Object>> jobs(Authentication auth,@RequestParam(required=false)String projectId){return jobs.jobs(users.require(auth).id(),projectId);}
    @GetMapping("/jobs/{id}") public Map<String,Object> job(Authentication auth,@PathVariable String id){return jobs.job(users.require(auth).id(),id);}
    @PostMapping("/jobs/{id}/cancel") public Map<String,Object> cancel(Authentication auth,@PathVariable String id){String owner=users.require(auth).id();redis.limit(owner,"mutation",240);return jobs.cancel(owner,id);}
    @GetMapping(value="/events",produces=MediaType.TEXT_EVENT_STREAM_VALUE) public SseEmitter events(Authentication auth){return events.subscribe(users.require(auth).id());}
}
