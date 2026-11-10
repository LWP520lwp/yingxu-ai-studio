package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.support.TransactionTemplate;

class JobRecoveryServiceTest {
    private final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    private final JobService jobs=mock(JobService.class);
    private final MuseClient muse=mock(MuseClient.class);
    private final AssetService assets=mock(AssetService.class);
    private JobRecoveryService service(){return new JobRecoveryService(jdbc,mock(TransactionTemplate.class),jobs,muse,mock(NativePoolService.class),mock(ChannelService.class),mock(ChannelClient.class),assets);}
    @SuppressWarnings("unchecked") private void existing(String status,String task){
        var job=new LinkedHashMap<String,Object>();job.put("id","job");job.put("status",status);job.put("providerTaskId",task);job.put("kind","image");job.put("model","muse-image");
        when(jdbc.query(anyString(),any(RowMapper.class),eq("job"),eq("owner"))).thenReturn(List.of(job));
        when(jobs.job("owner","job")).thenReturn(Map.of("id","job","status",status));
    }
    @Test void foreignJobCannotPollOrDownload(){
        assertThrows(ApiException.class,()->service().recover("stranger","job"));verifyNoInteractions(muse,assets);
    }
    @Test void taskWithoutDurableProviderIdCannotBeResubmitted(){
        existing("unknown_external",null);assertThrows(ApiException.class,()->service().recover("owner","job"));verifyNoInteractions(muse,assets);
    }
    @Test void aConcurrentLeasePreventsAnyUpstreamCall(){
        existing("unknown_external","existing-task");assertThrows(ApiException.class,()->service().recover("owner","job"));verifyNoInteractions(muse,assets);
    }
    @Test void pendingRecoveryOnlyPollsTheExistingTaskAndKeepsItsState()throws Exception{
        existing("unknown_external","existing-task");when(jdbc.update(anyString(),any(Object[].class))).thenReturn(1);
        when(muse.poll("image","existing-task")).thenReturn(new MuseClient.Outcome("existing-task","queued",null,null,null));
        var response=service().recover("owner","job");assertEquals("pending",response.get("recoveryStatus"));assertEquals(false,response.get("generationResubmitted"));
        verify(muse).poll("image","existing-task");verifyNoMoreInteractions(muse);verifyNoInteractions(assets);
    }
    @Test void failedRecoveryIsNotTurnedIntoAnotherPaidRequest()throws Exception{
        existing("failed","existing-task");when(jdbc.update(anyString(),any(Object[].class))).thenReturn(1);
        when(muse.poll("image","existing-task")).thenReturn(new MuseClient.Outcome("existing-task","failed",null,null,"上游生成超时"));
        assertEquals("failed",service().recover("owner","job").get("recoveryStatus"));verify(muse).poll("image","existing-task");verifyNoMoreInteractions(muse);verifyNoInteractions(assets);
    }
}
