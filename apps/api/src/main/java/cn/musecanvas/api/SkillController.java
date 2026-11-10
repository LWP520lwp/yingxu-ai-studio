package cn.musecanvas.api;

import java.util.List;
import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.MediaType;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;

@RestController
@RequestMapping("/api")
public class SkillController {
    public record InstallInput(String recipeVersion) {}
    private final SkillService skills;
    private final UserService users;
    private final RedisSupport redis;

    public SkillController(SkillService skills, UserService users, RedisSupport redis) {
        this.skills = skills;
        this.users = users;
        this.redis = redis;
    }

    @GetMapping("/skills")
    public List<Map<String, Object>> directory(Authentication auth) {
        var user = users.current(auth);
        return skills.directory(user == null ? null : user.id());
    }

    @GetMapping("/skills/{id}")
    public Map<String, Object> detail(Authentication auth, @PathVariable String id) {
        var user = users.current(auth);
        return skills.detail(user == null ? null : user.id(), id);
    }

    @GetMapping("/workspace/skills")
    public List<Map<String, Object>> workspace(Authentication auth) {
        return skills.workspace(users.require(auth).id());
    }

    @PostMapping(value = "/workspace/skill-imports", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> importPackage(Authentication auth, @RequestPart("file") MultipartFile file,
            @RequestParam(defaultValue = "video") String capability) throws IOException {
        String owner = users.require(auth).id();
        redis.limit(owner, "skill-import", 12);
        if (file.getSize() > SkillPackageParser.MAX_UPLOAD) throw ApiException.invalid("Skill 上传大小不得超过 2 MiB");
        try (var input = file.getInputStream()) {
            return skills.importPackage(owner, SkillPackageParser.parse(file.getOriginalFilename(), input, capability));
        }
    }

    @PutMapping("/workspace/skills/{id}")
    public Map<String, Object> install(Authentication auth, @PathVariable String id, @RequestBody InstallInput input) {
        String owner = users.require(auth).id();
        redis.limit(owner, "skill-installation", 60);
        if (input == null) throw ApiException.invalid("recipeVersion 必填");
        return skills.install(owner, id, input.recipeVersion());
    }

    @DeleteMapping("/workspace/skills/{id}")
    public Map<String, Object> uninstall(Authentication auth, @PathVariable String id) {
        String owner = users.require(auth).id();
        redis.limit(owner, "skill-installation", 60);
        return skills.uninstall(owner, id);
    }

    @PutMapping("/workspace/skill-favorites/{id}")
    public Map<String, Object> favorite(Authentication auth, @PathVariable String id) {
        String owner = users.require(auth).id();
        redis.limit(owner, "skill-favorite", 60);
        return skills.favorite(owner, id, true);
    }

    @DeleteMapping("/workspace/skill-favorites/{id}")
    public Map<String, Object> unfavorite(Authentication auth, @PathVariable String id) {
        String owner = users.require(auth).id();
        redis.limit(owner, "skill-favorite", 60);
        return skills.favorite(owner, id, false);
    }
}

