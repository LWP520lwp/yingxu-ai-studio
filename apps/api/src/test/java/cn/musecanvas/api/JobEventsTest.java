package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class JobEventsTest {
    @Test void appliesOwnerAndGlobalLimitsWithoutBlockingAnotherOwner() {
        var fixture=new Fixture(3,2);
        fixture.events.subscribe("alice");fixture.events.subscribe("alice");
        assertLimited(()->fixture.events.subscribe("alice"));
        fixture.events.subscribe("bob");
        assertLimited(()->fixture.events.subscribe("carol"));
        fixture.emitters.getFirst().completion.run();
        assertDoesNotThrow(()->fixture.events.subscribe("carol"));
        assertLimited(()->fixture.events.subscribe("alice"));
    }

    @Test void completionTimeoutAndErrorReleaseAdmissionExactlyOnce() {
        for(int path=0;path<3;path++) {
            var fixture=new Fixture(2,2);
            fixture.events.subscribe("alice");var emitter=fixture.emitters.getFirst();
            if(path==0)emitter.completion.run();
            if(path==1)emitter.timeout.run();
            if(path==2)emitter.error.accept(new IOException("disconnected"));
            // Containers can deliver completion after timeout/error, or report a second error.
            emitter.completion.run();emitter.error.accept(new IOException("already closed"));
            fixture.events.subscribe("alice");fixture.events.subscribe("alice");
            assertLimited(()->fixture.events.subscribe("alice"));
        }
    }

    @Test void failedReadySendClosesEmitterAndDoesNotConsumeCapacity() {
        var jdbc=mock(JdbcTemplate.class);var failed=new TestEmitter();failed.failSend=true;
        var fresh=new TestEmitter();var pending=new ArrayList<>(List.of(failed,fresh));
        var events=new JobEvents(jdbc,1,1,()->pending.removeFirst());
        assertSame(failed,events.subscribe("alice"));assertEquals(1,failed.completions);
        assertSame(fresh,events.subscribe("alice"));
        verifyNoInteractions(jdbc);
    }

    @Test void failedHeartbeatClosesStreamAndAllowsReconnect() {
        var fixture=new Fixture(1,1);
        fixture.events.subscribe("alice");var emitter=fixture.emitters.getFirst();emitter.failSend=true;
        fixture.events.heartbeat();assertEquals(1,emitter.completions);
        assertDoesNotThrow(()->fixture.events.subscribe("alice"));
        verifyNoInteractions(fixture.jdbc);
    }

    @Test void publicationRemovesFailedStreamAndDoesNotSendOtherOwnersJobs() {
        var fixture=new Fixture(3,2);
        fixture.events.subscribe("alice");fixture.events.subscribe("bob");
        var alice=fixture.emitters.getFirst();var bob=fixture.emitters.getLast();alice.failSend=true;
        doReturn(List.of(Map.of("id","job-one","ownerId","alice","updatedAt","2026-11-11T00:00:00Z","status","running")))
            .when(fixture.jdbc).query(anyString(),org.mockito.ArgumentMatchers.<RowMapper<Map<String,Object>>>any(),any(Timestamp.class),any(Timestamp.class));
        fixture.events.publish();assertEquals(1,alice.completions);assertEquals(1,bob.sent);
        assertDoesNotThrow(()->fixture.events.subscribe("carol"));
        assertDoesNotThrow(()->fixture.events.subscribe("alice"));
        assertLimited(()->fixture.events.subscribe("fourth"));
    }

    @Test void simultaneousAdmissionsNeverExceedGlobalCapacity() throws Exception {
        var fixture=new Fixture(5,2);var gate=new CountDownLatch(1);
        try(var executor=Executors.newFixedThreadPool(12)) {
            var results=new ArrayList<java.util.concurrent.Future<Boolean>>();
            for(int i=0;i<30;i++) {String owner="owner-"+i;results.add(executor.submit(()->{
                assertTrue(gate.await(5,TimeUnit.SECONDS));
                try {fixture.events.subscribe(owner);return true;}
                catch(ApiException ex) {assertEquals(HttpStatus.TOO_MANY_REQUESTS,ex.status);return false;}
            }));}
            gate.countDown();int admitted=0;for(var result:results)if(result.get(10,TimeUnit.SECONDS))admitted++;
            assertEquals(5,admitted);
        }
        assertLimited(()->fixture.events.subscribe("one-more"));
    }

    @Test void invalidConfiguredLimitsAreRejected() {
        assertThrows(IllegalArgumentException.class,()->new JobEvents(mock(JdbcTemplate.class),0,1));
        assertThrows(IllegalArgumentException.class,()->new JobEvents(mock(JdbcTemplate.class),1,0));
    }

    private static void assertLimited(org.junit.jupiter.api.function.Executable action) {
        var error=assertThrows(ApiException.class,action);assertEquals(HttpStatus.TOO_MANY_REQUESTS,error.status);
        assertEquals("EVENT_CONNECTION_LIMIT",error.code);assertEquals(15,error.details.get("retryAfterSeconds"));
    }
    private static class Fixture {
        final JdbcTemplate jdbc=mock(JdbcTemplate.class);
        final List<TestEmitter> emitters=Collections.synchronizedList(new ArrayList<>());
        final JobEvents events;
        Fixture(int global,int perUser) {events=new JobEvents(jdbc,global,perUser,()->{var emitter=new TestEmitter();emitters.add(emitter);return emitter;});}
    }
    private static class TestEmitter extends SseEmitter {
        Runnable completion,timeout;Consumer<Throwable> error;boolean failSend;int sent,completions;
        @Override public void onCompletion(Runnable callback) {completion=callback;}
        @Override public void onTimeout(Runnable callback) {timeout=callback;}
        @Override public void onError(Consumer<Throwable> callback) {error=callback;}
        @Override public void send(SseEventBuilder event) throws IOException {if(failSend)throw new IOException("disconnected");sent++;}
        @Override public void complete() {completions++;if(completion!=null)completion.run();}
    }
}
