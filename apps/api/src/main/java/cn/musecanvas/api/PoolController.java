package cn.musecanvas.api;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/pool")
public class PoolController {
    private final PoolSettings settings;
    private final PoolService pool;
    private final NativePoolService nativePool;
    private final UserService users;

    public record CreateAccount(String name, String type) {}
    public record SetEnabled(Boolean enabled, Boolean shared) {}

    public PoolController(PoolSettings settings, PoolService pool, NativePoolService nativePool, UserService users) {
        this.settings = settings;
        this.pool = pool;
        this.nativePool = nativePool;
        this.users = users;
    }

    @GetMapping("/overview")
    public ResponseEntity<PoolService.Overview> overview(Authentication auth, HttpServletRequest request) {
        var user = users.require(auth);
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(nativePool.overview(user.id()));
    }

    @GetMapping("/accounts")
    public ResponseEntity<java.util.Map<String,Object>> accounts(Authentication auth,HttpServletRequest request){var user=manage(auth);return ResponseEntity.ok().header("Cache-Control","no-store").body(nativePool.accounts(user.id(),settings.mayManage(user,auth,request.getRemoteAddr())));}
    @PostMapping("/quota/refresh")
    public ResponseEntity<java.util.Map<String,Object>> refreshQuotas(Authentication auth,HttpServletRequest request){var user=manage(auth);return ResponseEntity.ok().header("Cache-Control","no-store").body(nativePool.refreshQuotas(user.id(),settings.mayManage(user,auth,request.getRemoteAddr())));}
    @PostMapping("/accounts/{id}/quota")
    public ResponseEntity<java.util.Map<String,Object>> refreshQuota(Authentication auth,@PathVariable String id){return ResponseEntity.ok().header("Cache-Control","no-store").body(nativePool.refreshQuota(manage(auth).id(),id));}
    @PostMapping("/accounts")
    public ResponseEntity<java.util.Map<String,Object>> create(Authentication auth,HttpServletRequest request,@RequestBody CreateAccount input){var user=manage(auth);return ResponseEntity.status(HttpStatus.CREATED).body(nativePool.create(user.id(),input==null?null:input.name(),input==null?null:input.type()));}
    @PostMapping("/accounts/import-local")
    public ResponseEntity<java.util.Map<String,Object>> importLocal(Authentication auth,HttpServletRequest request,@RequestBody(required=false) CreateAccount input){var user=manage(auth);if(!settings.mayManage(user,auth,request.getRemoteAddr()))throw new ApiException(HttpStatus.FORBIDDEN,"POOL_IMPORT_FORBIDDEN","只有部署管理员可导入此部署的本地服务凭据");return ResponseEntity.status(HttpStatus.CREATED).body(nativePool.importLocal(user.id(),input==null?null:input.name()));}
    @PostMapping("/accounts/{id}/login")
    public java.util.Map<String,Object> login(Authentication auth,HttpServletRequest request,@PathVariable String id){return nativePool.login(manage(auth).id(),id);}
    @PostMapping("/accounts/{id}/check")
    public java.util.Map<String,Object> check(Authentication auth,HttpServletRequest request,@PathVariable String id){return nativePool.check(manage(auth).id(),id);}
    @PostMapping("/accounts/{id}/close")
    public java.util.Map<String,Object> close(Authentication auth,HttpServletRequest request,@PathVariable String id){return nativePool.close(manage(auth).id(),id);}
    @PatchMapping("/accounts/{id}")
    public java.util.Map<String,Object> enabled(Authentication auth,HttpServletRequest request,@PathVariable String id,@RequestBody SetEnabled input){var user=manage(auth);if(input==null||(input.enabled()==null&&input.shared()==null))throw ApiException.invalid("enabled 或 shared 必填");return nativePool.update(user.id(),id,input.enabled(),input.shared());}
    @DeleteMapping("/accounts/{id}")
    public java.util.Map<String,Object> delete(Authentication auth,HttpServletRequest request,@PathVariable String id){return nativePool.disable(manage(auth).id(),id);}

    private UserService.User manage(Authentication auth){
        var user=users.require(auth);
        if(!settings.enabled())throw new ApiException(HttpStatus.FORBIDDEN,"POOL_MANAGEMENT_DISABLED","此部署尚未启用账号池");
        return user;
    }
}
