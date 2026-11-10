package cn.musecanvas.api;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class NativePoolService {
    public static final String MUSE = "native_muse";
    public static final String DOUBAO = "native_doubao";
    public static final String MUSE_SERVICE = "muse_service";
    private static final long OPERATION_LEASE_SECONDS = 120;
    private static final long GENERATION_LEASE_SECONDS = 660;
    private static final String ROW_SELECT = "SELECT *, (lease_until IS NOT NULL AND lease_until>CURRENT_TIMESTAMP(3)) AS busy, "
        + "COALESCE(last_checked_at>=TIMESTAMPADD(MINUTE,-10,CURRENT_TIMESTAMP(3)),FALSE) AS fresh FROM pool_account";

    private record Row(String id, String ownerId, String name, String type, String provider, boolean enabled, boolean shared, String state,
                       String message, boolean image, boolean video, boolean busy, boolean fresh,
                       String lastCheckedAt, String lastUsedAt, String createdAt, String updatedAt, String encryptedCredential) {
        Map<String, Object> publicView(boolean schedulable) {
            var caps = Map.of("image", image, "video", video);
            var result = new LinkedHashMap<String, Object>();
            result.put("id", id); result.put("name", name); result.put("type", type); result.put("provider", provider);
            result.put("state", state); result.put("message", message); result.put("enabled", enabled);
            result.put("shared", shared);
            result.put("busy", busy); result.put("capabilities", caps); result.put("createdAt", createdAt); result.put("updatedAt", updatedAt);
            result.put("fresh", fresh); result.put("lastCheckedAt", lastCheckedAt); result.put("lastUsedAt", lastUsedAt);
            result.put("schedulable", schedulable);
            return result;
        }
    }
    public record ModelSnapshot(Map<String, Object> models, boolean workerAvailable, boolean encryptionReady) {}
    public static final class PoolLease implements AutoCloseable {
        private final NativePoolService owner;
        private final String accountId, ownerId, name, type, provider, token, encryptedCredential;
        private PoolLease(NativePoolService owner, String accountId, String ownerId, String name, String type, String provider, String token, String encryptedCredential) {
            this.owner=owner; this.accountId=accountId; this.ownerId=ownerId; this.name=name; this.type=type; this.provider=provider; this.token=token; this.encryptedCredential=encryptedCredential;
        }
        public String accountId(){return accountId;} public String name(){return name;} public String type(){return type;}
        public String provider(){return provider;} public String token(){return token;} public String encryptedCredential(){return encryptedCredential;}
        @Override public void close() { owner.release(this); }
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final RedisSupport redis;
    private final PoolSettings settings;
    private final MuseProvider museProvider;
    private final CredentialCipher cipher;
    private final BrowserWorkerClient worker;
    private final PoolQuotaService quotas;

    public NativePoolService(JdbcTemplate jdbc, TransactionTemplate tx, RedisSupport redis, PoolSettings settings,
                             MuseProvider museProvider, CredentialCipher cipher, BrowserWorkerClient worker, PoolQuotaService quotas) {
        this.jdbc=jdbc; this.tx=tx; this.redis=redis; this.settings=settings; this.museProvider=museProvider;
        this.cipher=cipher; this.worker=worker; this.quotas=quotas;
    }

    public Map<String, Object> accounts(String owner, boolean canImportLocal) {
        requireOwner(owner);
        var rows = jdbc.query(ROW_SELECT + " WHERE owner_id=? ORDER BY created_at,id", (rs,n) -> row(rs), owner);
        boolean workerAvailable = worker.available();
        boolean interactiveLoginEnabled = worker.interactiveLoginEnabled();
        return Map.of("accounts", publicViews(rows, workerAvailable && interactiveLoginEnabled), "workerAvailable", workerAvailable,
            "interactiveLoginEnabled", interactiveLoginEnabled, "encryptionReady", cipher.ready(), "localManagement", true,
            "scope", "personal", "canImportLocal", canImportLocal, "sharedChannels", sharedChannels());
    }

    /** All logged-in users may inspect shared quota, but never supplier identities or credentials. */
    public Map<String, Object> refreshQuotas(String owner, boolean canImportLocal) {
        requireOwner(owner);
        if (!settings.enabled()) throw disabled();
        redis.limit(owner, "pool-quota", 6);
        var seen = new java.util.HashSet<String>();
        var calls = new ArrayList<java.util.concurrent.Callable<Void>>();
        for (Row row : generationRows(owner)) {
            if (!MUSE_SERVICE.equals(row.type()) || !row.enabled() || row.busy()) continue;
            String key = serviceKey(row);
            if (!key.isBlank() && seen.add(PoolQuotaService.fingerprint(museProvider.baseUrl(), key)))
                calls.add(() -> { quotas.snapshot(key, true); return null; });
            if (calls.size() == 8) break;
        }
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(Math.min(3, Math.max(1, calls.size())))) {
            executor.invokeAll(calls, 65, java.util.concurrent.TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        return accounts(owner, canImportLocal);
    }

    public Map<String, Object> refreshQuota(String owner, String id) {
        Row row = require(owner, id);
        if (!settings.enabled()) throw disabled();
        redis.limit(owner, "pool-quota", 6);
        if (row.busy()) throw busy();
        if (MUSE_SERVICE.equals(row.type())) quotas.snapshot(serviceKey(row), true);
        return publicView(row);
    }

    public Map<String, Object> create(String owner, String name, String type) {
        requireOwner(owner);
        String safeName = accountName(name);
        if (!MUSE.equals(type) && !DOUBAO.equals(type)) throw ApiException.invalid("type 必须为 native_muse 或 native_doubao；服务账号请使用 import-local");
        String id = UUID.randomUUID().toString(); String provider = DOUBAO.equals(type) ? "doubao" : "muse";
        jdbc.update("INSERT INTO pool_account(id,owner_id,name,type,provider,state,capability_image,capability_video) VALUES(?,?,?,?,?,'login_required',?,?)",
            id, owner, safeName, type, provider, MUSE.equals(type), MUSE.equals(type));
        return publicView(require(owner,id));
    }

    /** Imports only a key from the configured loopback MuseProvider; plaintext is never returned or logged. */
    public Map<String, Object> importLocal(String owner, String name) {
        requireOwner(owner);
        if (!cipher.ready()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "POOL_ENCRYPTION_UNAVAILABLE", "未配置有效的 POOL_CREDENTIAL_MASTER_KEY，不能导入服务密钥");
        if (PoolSettings.loopbackBase(museProvider.baseUrl()) == null)
            throw new ApiException(HttpStatus.CONFLICT, "LOCAL_MUSE_NOT_LOOPBACK", "仅支持从部署机本地回环 Muse 服务导入密钥");
        String secret = museProvider.importableLocalKey();
        if (secret == null || secret.isBlank()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "LOCAL_MUSE_KEY_UNAVAILABLE", "本机 MuseProvider 暂未提供可导入的密钥");
        String id = UUID.randomUUID().toString(); String encrypted = cipher.encrypt(id, secret);
        jdbc.update("INSERT INTO pool_account(id,owner_id,name,type,provider,enabled,state,state_message,capability_image,capability_video,encrypted_credential,last_checked_at) VALUES(?,?,?,?,'muse',TRUE,'ready','从本机 MuseProvider 导入的服务凭据',TRUE,TRUE,?,CURRENT_TIMESTAMP(3))",
            id, owner, accountName(name), MUSE_SERVICE, encrypted);
        return publicView(require(owner,id));
    }

    public List<Map<String, Object>> list(String owner) { return publicViews(accountRows(owner), worker.interactiveLoginEnabled() && worker.available()); }

    public Map<String, Object> login(String owner, String id) {
        Row current = require(owner,id);
        requireNative(current);
        if (!settings.enabled()) throw disabled();
        if (!worker.interactiveLoginEnabled()) throw new ApiException(HttpStatus.FORBIDDEN, "INTERACTIVE_LOGIN_DISABLED", "部署者尚未启用本机交互式网页登录");
        try (var lease = acquireOperation(owner,id)) {
            var status = worker.login(id, current.provider());
            saveStatus(id, lease.token(), status);
        }
        return publicView(require(owner,id));
    }

    public Map<String, Object> check(String owner, String id) {
        Row current = require(owner,id);
        requireNative(current);
        if (!settings.enabled()) throw disabled();
        try (var lease = acquireOperation(owner,id)) {
            var status = worker.status(id);
            saveStatus(id, lease.token(), status);
        }
        return publicView(require(owner,id));
    }

    public Map<String, Object> close(String owner, String id) {
        Row current = require(owner,id);
        requireNative(current);
        if (!settings.enabled()) throw disabled();
        try (var lease = acquireOperation(owner,id)) {
            var status = worker.close(id);
            saveStatus(id, lease.token(), new BrowserWorkerClient.Status("login_required", status.message(), status.image(), status.video()));
        }
        return publicView(require(owner,id));
    }

    public Map<String, Object> setEnabled(String owner, String id, boolean enabled) {
        return update(owner,id,enabled,null);
    }

    public Map<String, Object> update(String owner, String id, Boolean enabled, Boolean shared) {
        Row current = require(owner,id);
        if (!settings.enabled()) throw disabled();
        if (Boolean.TRUE.equals(enabled) && MUSE_SERVICE.equals(current.type()) && !cipher.ready())
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "POOL_ENCRYPTION_UNAVAILABLE", "未配置有效的凭据加密主密钥");
        if (shared != null && !MUSE_SERVICE.equals(current.type())) throw ApiException.invalid("只有 Muse 服务凭据可共享生成调用");
        jdbc.update("UPDATE pool_account SET enabled=?,shared=?,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=?",
            enabled == null ? current.enabled() : enabled, shared == null ? current.shared() : shared, id, owner);
        return publicView(require(owner,id));
    }

    /** Soft disable only; preserves the audit row and never removes the worker's on-disk profile. */
    public Map<String, Object> disable(String owner, String id) {
        require(owner,id);
        if (!settings.enabled()) throw disabled();
        jdbc.update("UPDATE pool_account SET enabled=FALSE,updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=?", id, owner);
        return Map.of("ok", true, "id", id);
    }

    public ModelSnapshot modelSnapshot(String owner) {
        boolean workerAvailable = worker.available();
        boolean nativeReady = settings.enabled() && workerAvailable && worker.interactiveLoginEnabled();
        var image = new ArrayList<Map<String, Object>>(); var video = new ArrayList<Map<String, Object>>();
        for (String type : List.of(MUSE, DOUBAO)) {
            boolean available = nativeReady && hasCapability(owner,type,"image");
            String provider = DOUBAO.equals(type) ? "doubao" : "muse";
            if ("muse".equals(provider)) {
                image.add(MuseProvider.describe("muse-image", available,true)); video.add(MuseProvider.describe("muse-video", nativeReady&&hasCapability(owner,type,"video"),true));
            } else {
                image.add(MuseProvider.describe("doubao-image", false)); video.add(MuseProvider.describe("doubao-video", false));
            }
        }
        boolean serviceAvailable = settings.enabled() && cipher.ready() && serviceAccountAvailable(owner);
        image.add(MuseProvider.describe("muse-service-image", serviceAvailable));
        video.add(MuseProvider.describe("muse-service-video", serviceAvailable));
        return new ModelSnapshot(Map.of("image", List.copyOf(image), "video", List.copyOf(video)), workerAvailable, cipher.ready());
    }

    public Map<String,Object> integration(String owner) {
        ModelSnapshot snapshot=modelSnapshot(owner);
        boolean museReady=settings.enabled()&&snapshot.workerAvailable()&&worker.interactiveLoginEnabled()&&(hasCapability(owner,MUSE,"image")||hasCapability(owner,MUSE,"video")), serviceReady=settings.enabled()&&cipher.ready()&&serviceAccountAvailable(owner);boolean available=museReady||serviceReady;
        return Map.of("name","个人账号池","enabled",available,
            "status",available?"configured":"unavailable","modelDiscovery","native_pool",
            "error",available?"":"你的账号池当前没有可用的生成通道");
    }

    public void validate(String owner, JobService.Request request) {
        requireOwner(owner);
        if (!settings.enabled()) throw disabled();
        museProvider.validateShape(request);
        String model=request.model();
        String type=model.startsWith("muse-service-")?MUSE_SERVICE:model.startsWith("doubao-")?DOUBAO:MUSE;
        if(MUSE.equals(type)&&request.kind().equals("video")&&("frames".equals(request.videoMode())||request.referenceAssetIds().size()>2))
            throw ApiException.invalid("网页 Muse 通道当前仅支持最多 2 张普通参考图；首尾帧或更多参考图请选择 Muse 服务通道");
        if(DOUBAO.equals(type))throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"MODEL_UNAVAILABLE","豆包网页登录生成尚未支持；目前只支持检查登录状态");
        if(!MUSE_SERVICE.equals(type)&&!worker.interactiveLoginEnabled())throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"INTERACTIVE_LOGIN_DISABLED","部署者尚未启用本机交互式网页生成");
        if(!MUSE_SERVICE.equals(type)&&!worker.available())throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"WORKER_UNAVAILABLE","本机浏览器执行器不可用");
        boolean ready=MUSE_SERVICE.equals(type)?serviceAccountAvailable(owner):hasCapability(owner,type,request.kind());
        if(!ready)throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"MODEL_UNAVAILABLE","当前通道没有启用且已就绪的账号");
    }

    public PoolService.Overview overview(String owner) {
        requireOwner(owner);
        if (!settings.enabled()) return new PoolService.Overview("disabled", false, new PoolService.Counts(null,null),
            new PoolService.Counts(null,null), null, null, "本机账号池尚未启用", Instant.now().toString());
        boolean workerAvailable = worker.available();
        var rows = accountRows(owner);
        boolean nativeReady = workerAvailable && worker.interactiveLoginEnabled();
        PoolService.Counts muse = counts("muse", rows, nativeReady); PoolService.Counts doubao = counts("doubao", rows, nativeReady);
        boolean serviceAvailable=rows.stream().anyMatch(row -> MUSE_SERVICE.equals(row.type()) && schedulable(row, false));boolean configured=workerAvailable||serviceAvailable;
        String status = configured ? "connected" : "unavailable";
        String message = configured ? "已读取你的账号池状态；账号可用性不代表供应商额度或生成成功" : "浏览器执行器或你的服务凭据不可用，已保存的账号与状态仍保留";
        return new PoolService.Overview(status, configured, muse, doubao, workerAvailable, null, message, Instant.now().toString());
    }

    public PoolLease acquireForGeneration(String owner, String type) {
        return acquire(owner,type, GENERATION_LEASE_SECONDS);
    }

    public PoolLease acquireForGeneration(String owner,String type,long seconds) { return acquire(owner,type,seconds); }

    public PoolLease acquireForQueuedGeneration(String owner,String type,long seconds) { return acquire(owner,type,seconds,true); }

    public PoolLease acquirePinned(String owner,String type,String id,long seconds) {
        Row row=requireForGeneration(owner,id);
        if (!settings.enabled()) throw disabled();
        if(!row.type().equals(type)||!row.enabled()||!"ready".equals(row.state())||!fresh(owner,id))throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"POOL_ACCOUNT_UNAVAILABLE","生成任务指定的账号已停用或未就绪");
        PoolLease lease=acquireOne(row,seconds,owner);
        if(lease==null)throw busy();
        return lease;
    }

    public PoolLease acquirePinnedService(String owner,String id,long seconds) {
        Row row=requireForGeneration(owner,id);
        if (!settings.enabled()) throw disabled();
        if(!MUSE_SERVICE.equals(row.type())||!row.enabled()||!cipher.ready())throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"POOL_ACCOUNT_UNAVAILABLE","指定的 Muse 服务通道当前不可用");
        PoolLease lease=acquireOne(row,seconds,owner);
        if(lease==null)throw busy();
        return lease;
    }

    public String routeForModel(String model) {
        if(model.startsWith("muse-service-"))return MUSE_SERVICE;
        if(model.startsWith("doubao-"))return DOUBAO;
        return MUSE;
    }

    public BrowserWorkerClient.Generated generate(PoolLease lease,String owner,JobService.Request request,AssetService assets,BrowserWorkerClient worker) {
        if (!owner.equals(lease.ownerId)) throw ApiException.notFound();
        if(MUSE_SERVICE.equals(lease.type()))throw new IllegalArgumentException("Service credential routes use MuseClient");
        return worker.generate(lease.accountId(),request,referenceImages(owner,request,assets));
    }

    public PoolLease acquireServiceForGeneration(String owner) {
        if (!cipher.ready()) return null;
        return acquire(owner,MUSE_SERVICE, GENERATION_LEASE_SECONDS);
    }

    public boolean serviceTextAvailable(String owner) {
        return settings.enabled() && cipher.ready() && serviceAccountAvailable(owner);
    }

    public String decryptCredential(PoolLease lease) {
        if (!MUSE_SERVICE.equals(lease.type())) throw new IllegalArgumentException("Only the service account has an encrypted provider key");
        return cipher.decrypt(lease.accountId(), lease.encryptedCredential());
    }

    public List<String> referenceImages(String owner, JobService.Request request, AssetService assets) {
        var result = new ArrayList<String>();
        for (String id : request.referenceAssetIds()) {
            var asset = assets.content(owner, id);
            try {
                long size = java.nio.file.Files.size(asset);
                if (size > 4L * 1024 * 1024) throw ApiException.invalid("浏览器参考图不能超过 4 MiB");
                String mime = jdbc.queryForObject("SELECT mime_type FROM asset WHERE id=? AND owner_id=?", String.class, id, owner);
                if (!List.of("image/png", "image/jpeg", "image/webp").contains(mime)) throw ApiException.invalid("浏览器参考图仅支持 PNG、JPEG 或 WebP");
                result.add("data:" + mime + ";base64," + java.util.Base64.getEncoder().encodeToString(java.nio.file.Files.readAllBytes(asset)));
            } catch (java.io.IOException ex) { throw ApiException.invalid("浏览器参考图暂不可读取"); }
        }
        return List.copyOf(result);
    }

    private PoolLease acquire(String owner,String type, long seconds) {
        return acquire(owner,type,seconds,false);
    }

    private PoolLease acquire(String owner,String type,long seconds,boolean queueIfBusy) {
        requireOwner(owner);
        if (!settings.enabled()) throw disabled();
        boolean nativeReady = MUSE.equals(type) && worker.interactiveLoginEnabled() && worker.available();
        boolean contended=false;
        for (Row row : generationRows(owner)) {
            if (!row.type().equals(type) || !generationReady(row, nativeReady)) continue;
            if(row.busy()){contended=true;continue;}
            PoolLease lease = acquireOne(row, seconds,owner);
            if (lease != null) return lease;
            contended=true;
        }
        if(queueIfBusy&&contended)throw busy();
        return null;
    }

    private PoolLease acquireOne(Row row, long seconds, String requester) {
        String token = UUID.randomUUID().toString();
        if (!redis.tryPoolLease(row.id(), token, seconds)) return null;
        int changed;
        try {
            // Recheck ownership or sharing atomically with reservation: a revoked
            // shared flag must not be bypassed using a previously read candidate.
            changed = jdbc.update("UPDATE pool_account SET lease_token=?,lease_until=TIMESTAMPADD(SECOND,?,CURRENT_TIMESTAMP(3)),last_used_at=CURRENT_TIMESTAMP(3) WHERE id=? AND owner_id=? AND (owner_id=? OR (type='muse_service' AND shared=TRUE)) AND enabled=TRUE AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(3))",
                token, seconds, row.id(), row.ownerId(), requester);
        } catch (RuntimeException ex) { redis.releasePoolLease(row.id(), token); throw ex; }
        if (changed != 1) { redis.releasePoolLease(row.id(), token); return null; }
        String encrypted = MUSE_SERVICE.equals(row.type()) ? jdbc.queryForObject("SELECT encrypted_credential FROM pool_account WHERE id=? AND owner_id=?", String.class, row.id(), row.ownerId()) : null;
        return new PoolLease(this,row.id(), row.ownerId(), row.name(), row.type(), row.provider(), token, encrypted);
    }

    private void release(PoolLease lease) {
        try { jdbc.update("UPDATE pool_account SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?", lease.accountId(), lease.token()); }
        finally { redis.releasePoolLease(lease.accountId(), lease.token()); }
    }

    private PoolLease acquireOperation(String owner,String id) {
        Row row = require(owner,id);
        if (!row.enabled()) throw new ApiException(HttpStatus.CONFLICT, "POOL_ACCOUNT_DISABLED", "此账号已停用，请先启用后再操作");
        PoolLease lease = acquireOne(row, OPERATION_LEASE_SECONDS,owner);
        if (lease == null) throw busy();
        return lease;
    }

    private void saveStatus(String id, String token, BrowserWorkerClient.Status status) {
        jdbc.update("UPDATE pool_account SET state=?,state_message=?,capability_image=?,capability_video=?,last_checked_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND lease_token=?",
            status.state(), status.message(), status.image(), status.video(), id, token);
    }

    private PoolService.Counts counts(String provider, List<Row> rows, boolean nativeReady) {
        var matching = rows.stream().filter(row -> provider.equals(row.provider())).toList();
        return new PoolService.Counts(matching.size(), (int)matching.stream().filter(row -> schedulable(row, nativeReady)).count());
    }

    private boolean hasCapability(String owner,String type,String kind){
        if (owner == null || owner.isBlank()) return false;
        String column="image".equals(kind)?"capability_image":"capability_video";
        Integer count=jdbc.queryForObject("SELECT COUNT(*) FROM pool_account WHERE owner_id=? AND type=? AND enabled=TRUE AND state='ready' AND "+column+"=TRUE AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP(3)) AND last_checked_at>=TIMESTAMPADD(MINUTE,-10,CURRENT_TIMESTAMP(3))",Integer.class,owner,type);
        return count!=null&&count>0;
    }
    private boolean fresh(String owner,String id){Integer count=jdbc.queryForObject("SELECT COUNT(*) FROM pool_account WHERE id=? AND owner_id=? AND last_checked_at>=TIMESTAMPADD(MINUTE,-10,CURRENT_TIMESTAMP(3))",Integer.class,id,owner);return count!=null&&count>0;}

    public void recordWorkerError(String accountId,String token,BrowserWorkerClient.WorkerException error){
        String state=switch(error.code()){case "LOGIN_REQUIRED"->"login_required";case "VERIFICATION_REQUIRED"->"verification_required";case "UNSUPPORTED_CAPABILITY"->"unsupported";default->"error";};
        jdbc.update("UPDATE pool_account SET state=?,state_message=?,last_checked_at=CURRENT_TIMESTAMP(3),updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND lease_token=?",state,error.getMessage(),accountId,token);
    }

    private boolean serviceAccountAvailable(String owner) {
        if (owner == null || owner.isBlank() || !cipher.ready()) return false;
        return jdbc.query(ROW_SELECT + " WHERE type='muse_service' AND (owner_id=? OR (shared=TRUE AND owner_id IS NOT NULL))", (rs,n) -> row(rs), owner).stream().anyMatch(row -> schedulable(row, false));
    }

    private boolean schedulable(Row row, boolean nativeReady) {
        return !row.busy() && generationReady(row,nativeReady);
    }

    private boolean generationReady(Row row, boolean nativeReady) {
        if (!row.enabled() || !"ready".equals(row.state())) return false;
        if (MUSE_SERVICE.equals(row.type())) {
            if (!cipher.ready() || row.encryptedCredential() == null) return false;
            try { return !cipher.decrypt(row.id(), row.encryptedCredential()).isBlank(); }
            catch (RuntimeException ignored) { return false; }
        }
        return MUSE.equals(row.type()) && nativeReady && row.fresh() && (row.image() || row.video());
    }

    private List<Map<String,Object>> publicViews(List<Row> rows, boolean nativeReady) {
        return rows.stream().map(row -> publicView(row, nativeReady)).toList();
    }

    private Map<String,Object> publicView(Row row) {
        boolean nativeReady = MUSE.equals(row.type()) && worker.interactiveLoginEnabled() && worker.available();
        return publicView(row, nativeReady);
    }

    private Map<String,Object> publicView(Row row, boolean nativeReady) {
        var view = row.publicView(schedulable(row, nativeReady));
        view.put("quota", MUSE_SERVICE.equals(row.type()) ? quotas.snapshot(serviceKey(row), false) : PoolQuotaService.unsupported());
        return view;
    }

    private String serviceKey(Row row) {
        if (!cipher.ready() || row.encryptedCredential() == null) return "";
        try { return cipher.decrypt(row.id(), row.encryptedCredential()); }
        catch (RuntimeException unavailable) { return ""; }
    }

    private List<Row> accountRows(String owner) {
        requireOwner(owner);
        return jdbc.query(ROW_SELECT + " WHERE owner_id=? ORDER BY COALESCE(last_used_at,'1970-01-01'),created_at,id", (rs,n)->row(rs), owner);
    }

    private List<Row> generationRows(String owner) {
        requireOwner(owner);
        return jdbc.query(ROW_SELECT + " WHERE owner_id=? OR (type='muse_service' AND shared=TRUE AND owner_id IS NOT NULL) ORDER BY COALESCE(last_used_at,'1970-01-01'),created_at,id", (rs,n)->row(rs), owner);
    }

    private Row requireForGeneration(String owner,String id) {
        requireOwner(owner);
        try { return jdbc.queryForObject(ROW_SELECT + " WHERE id=? AND (owner_id=? OR (type='muse_service' AND shared=TRUE AND owner_id IS NOT NULL))", (rs,n)->row(rs), id, owner); }
        catch (EmptyResultDataAccessException ex) { throw ApiException.notFound(); }
    }

    private Map<String,Object> sharedChannels() {
        var rows = jdbc.query(ROW_SELECT + " WHERE type='muse_service' AND shared=TRUE AND owner_id IS NOT NULL AND enabled=TRUE",(rs,n)->row(rs));
        int available=(int)rows.stream().filter(row->schedulable(row,false)).count();
        int busy=(int)rows.stream().filter(Row::busy).count();
        var snapshots = new LinkedHashMap<String,PoolQuotaService.Quota>();
        for (Row row : rows) {
            String key = serviceKey(row);
            String identity = PoolQuotaService.fingerprint(museProvider.baseUrl(), key);
            snapshots.computeIfAbsent(identity, ignored -> quotas.snapshot(key, false));
        }
        return Map.of("muse",Map.of("available",available,"busy",busy,"quota",PoolQuotaService.combine(List.copyOf(snapshots.values()))),
            "message","共享服务的实际周额度及额外余额如下，密钥由服务端保管");
    }

    private Row require(String owner,String id) {
        requireOwner(owner);
        try { return jdbc.queryForObject(ROW_SELECT + " WHERE id=? AND owner_id=?", (rs,n)->row(rs), id, owner); }
        catch (EmptyResultDataAccessException ex) { throw ApiException.notFound(); }
    }

    private static Row row(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Row(rs.getString("id"), rs.getString("owner_id"), rs.getString("name"), rs.getString("type"), rs.getString("provider"), rs.getBoolean("enabled"), rs.getBoolean("shared"),
            rs.getString("state"), rs.getString("state_message"), rs.getBoolean("capability_image"), rs.getBoolean("capability_video"),
            rs.getBoolean("busy"), rs.getBoolean("fresh"), WorkbenchStore.iso(rs,"last_checked_at"), WorkbenchStore.iso(rs,"last_used_at"),
            WorkbenchStore.iso(rs,"created_at"), WorkbenchStore.iso(rs,"updated_at"), rs.getString("encrypted_credential"));
    }

    private static void requireNative(Row row) {
        if (MUSE_SERVICE.equals(row.type())) throw ApiException.invalid("Muse 服务密钥账号不使用网页登录窗口");
    }

    private static void requireOwner(String owner) {
        if (owner == null || owner.isBlank()) throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHENTICATED","请先登录");
    }

    private static String accountName(String value) {
        if (value == null || value.isBlank()) throw ApiException.invalid("账号名称必填");
        String name = value.strip();
        if (name.length() > 120 || name.codePoints().anyMatch(Character::isISOControl)) throw ApiException.invalid("账号名称最多 120 字且不能包含控制字符");
        return name;
    }

    private static ApiException busy() { return new ApiException(HttpStatus.CONFLICT, "ACCOUNT_BUSY", "该账号正在登录、检查或生成，请稍后重试"); }
    private static ApiException disabled() { return new ApiException(HttpStatus.FORBIDDEN, "POOL_MANAGEMENT_DISABLED", "本机账号池管理尚未启用"); }
}
