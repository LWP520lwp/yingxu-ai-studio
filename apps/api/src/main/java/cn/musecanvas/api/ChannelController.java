package cn.musecanvas.api;

import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/channels")
public class ChannelController {
    private final ChannelService channels;private final ChannelClient client;private final UserService users;private final RedisSupport redis;
    public ChannelController(ChannelService channels,ChannelClient client,UserService users,RedisSupport redis){this.channels=channels;this.client=client;this.users=users;this.redis=redis;}
    @GetMapping public Map<String,Object> list(Authentication auth){return Map.of("channels",channels.list(users.require(auth).id()));}
    @GetMapping("/models") public Map<String,Object> catalog(Authentication auth){return Map.of("models",channels.modelCatalog(users.require(auth).id()));}
    @PutMapping public Map<String,Object> save(Authentication auth,@RequestBody ChannelService.Input input){String owner=users.require(auth).id();redis.limit(owner,"channel-mutation",60);return channels.save(owner,input);}
    @DeleteMapping("/{id}") public Map<String,Object> delete(Authentication auth,@PathVariable String id){return channels.delete(users.require(auth).id(),id);}
    @PostMapping("/{id}/models") public Map<String,Object> models(Authentication auth,@PathVariable String id){String owner=users.require(auth).id();redis.limit(owner,"channel-probe",20);return Map.of("models",client.models(channels.require(owner,id)));}
}
