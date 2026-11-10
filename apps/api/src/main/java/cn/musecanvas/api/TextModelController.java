package cn.musecanvas.api;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Owner-scoped text models shared by the active story and science workflows. */
@RestController
public class TextModelController {
    private final UserService users;
    private final ChannelService channels;
    private final MuseTextGateway muse;
    public TextModelController(UserService users,ChannelService channels,MuseTextGateway muse){this.users=users;this.channels=channels;this.muse=muse;}

    @GetMapping("/api/models/text")
    public ResponseEntity<Map<String,Object>> models(Authentication auth){
        String owner=users.require(auth).id();
        var models=new ArrayList<Map<String,Object>>(channels.textModels(owner));
        models.addAll(muse.models(owner));
        return ResponseEntity.ok().header("Cache-Control","no-store").body(Map.of("models",List.copyOf(models)));
    }
}
