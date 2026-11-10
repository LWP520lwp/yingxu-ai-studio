package cn.musecanvas.api;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Component
public class JobEvents {
    private record Subscriber(String owner,SseEmitter emitter) {}
    private final ConcurrentHashMap<String,Subscriber> subscribers=new ConcurrentHashMap<>();
    private final Object admissionLock=new Object();
    private final Map<String,Integer> ownerConnections=new HashMap<>();
    private final JdbcTemplate jdbc;
    private final int maxConnections,maxConnectionsPerUser;
    private final Supplier<SseEmitter> emitters;
    private Instant since=Instant.now().minusSeconds(2);
    public JobEvents(JdbcTemplate jdbc){this(jdbc,10000,8);}
    @Autowired
    public JobEvents(JdbcTemplate jdbc,@Value("${app.sse-max-connections:10000}") int maxConnections,
                     @Value("${app.sse-max-connections-per-user:8}") int maxConnectionsPerUser){
        this(jdbc,maxConnections,maxConnectionsPerUser,()->new SseEmitter(30*60*1000L));
    }
    JobEvents(JdbcTemplate jdbc,int maxConnections,int maxConnectionsPerUser,Supplier<SseEmitter> emitters){
        if(maxConnections<1||maxConnectionsPerUser<1)throw new IllegalArgumentException("SSE connection limits must be positive");
        this.jdbc=jdbc;this.maxConnections=maxConnections;this.maxConnectionsPerUser=maxConnectionsPerUser;this.emitters=emitters;
    }
    public SseEmitter subscribe(String owner){
        String key=java.util.UUID.randomUUID().toString();SseEmitter emitter=emitters.get();var subscriber=new Subscriber(owner,emitter);
        synchronized(admissionLock){
            int owned=ownerConnections.getOrDefault(owner,0);
            if(subscribers.size()>=maxConnections||owned>=maxConnectionsPerUser)
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"EVENT_CONNECTION_LIMIT","实时连接较多，请关闭多余标签页后重试",Map.of("retryAfterSeconds",15));
            subscribers.put(key,subscriber);ownerConnections.put(owner,owned+1);
        }
        emitter.onCompletion(()->release(key,subscriber));
        emitter.onTimeout(()->close(key,subscriber));emitter.onError(e->close(key,subscriber));
        try{emitter.send(SseEmitter.event().name("ready").data(Map.of("reconcile","/api/jobs")));}catch(Exception e){close(key,subscriber);}
        return emitter;
    }
    // Completion, timeout and a failed send can race; release exactly one admission slot.
    private void release(String key,Subscriber subscriber){
        synchronized(admissionLock){
            if(!subscribers.remove(key,subscriber))return;
            ownerConnections.computeIfPresent(subscriber.owner(),(owner,count)->count<=1?null:count-1);
        }
    }
    private void close(String key,Subscriber subscriber){
        release(key,subscriber);
        try{subscriber.emitter().complete();}catch(RuntimeException ignored){/* The container may have already completed it. */}
    }
    @Scheduled(fixedDelay=2000,initialDelay=3000)
    public void publish(){
        Instant upper=Instant.now();
        if(subscribers.isEmpty()){since=upper.minusSeconds(2);return;}
        try{
            var changes=jdbc.query("SELECT * FROM generation_job WHERE updated_at>=? AND updated_at<=? ORDER BY updated_at,id LIMIT 2000",(rs,n)->JobService.internalRow(rs),Timestamp.from(since.minusSeconds(1)),Timestamp.from(upper));
            // Build the recipient index once per batch, avoiding changes × all online connections.
            var recipients=new HashMap<String,List<Map.Entry<String,Subscriber>>>();
            subscribers.forEach((key,s)->recipients.computeIfAbsent(s.owner(),ignored->new ArrayList<>()).add(Map.entry(key,s)));
            for(var job:changes)for(var entry:recipients.getOrDefault((String)job.get("ownerId"),List.of())){
                var s=entry.getValue();
                try{s.emitter().send(SseEmitter.event().name("job").id(job.get("id")+":"+job.get("updatedAt")).data(JobService.publicView(job)));}
                catch(Exception e){close(entry.getKey(),s);}
            }
            // At capacity, ask every tab to reconcile durable jobs before advancing the cursor.
            if(changes.size()==2000)subscribers.forEach((key,s)->{try{s.emitter().send(SseEmitter.event().name("reconcile").data(Map.of("reconcile","/api/jobs")));}catch(Exception e){close(key,s);}});
            since=upper;
        }catch(RuntimeException ignored){/* Clients reconcile durable jobs after reconnect. */}
    }
    @Scheduled(fixedDelay=15000)
    public void heartbeat(){subscribers.forEach((key,s)->{try{s.emitter().send(SseEmitter.event().comment("heartbeat"));}catch(Exception e){close(key,s);}});}
}
