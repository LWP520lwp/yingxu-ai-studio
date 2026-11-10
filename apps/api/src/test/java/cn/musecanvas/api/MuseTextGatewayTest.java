package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.io.IOException;
import java.net.http.HttpTimeoutException;
import org.junit.jupiter.api.Test;

class MuseTextGatewayTest {
    private final MuseProvider provider=mock(MuseProvider.class);
    private final NativePoolService pool=mock(NativePoolService.class);
    private final MuseClient client=mock(MuseClient.class);
    private MuseTextGateway gateway(){when(provider.enabled()).thenReturn(true);when(provider.apiKey()).thenReturn("test-server-only");return new MuseTextGateway(provider,pool,client);}
    private void classified(Exception failure,String category)throws Exception{
        when(client.completeText("system","input",1000,"test-server-only")).thenThrow(failure);
        ApiException result=assertThrows(ApiException.class,()->gateway().complete("owner","muse-spark","system","input",1000));
        assertEquals(category,result.code);assertEquals(category,result.details.get("failureCategory"));
        assertFalse(result.getMessage().contains("PRIVATE-UPSTREAM"));assertFalse(result.getMessage().contains("test-server-only"));
        verify(client,times(1)).completeText("system","input",1000,"test-server-only");verifyNoMoreInteractions(client);verifyNoInteractions(pool);
    }
    @Test void aResponseNormalizationFailureIsNotMisreportedAsNetworkOrTimeout()throws Exception{
        classified(new MuseClient.Rejected("PRIVATE-UPSTREAM malformed snapshots"),"TEXT_MODEL_RESPONSE_INVALID");
    }
    @Test void aConfirmedHttpRejectionKeepsItsOwnCategory()throws Exception{
        classified(new MuseClient.RequestRejected("PRIVATE-UPSTREAM 429"),"TEXT_MODEL_REJECTED");
    }
    @Test void timeoutAndIoFailuresHaveDistinctSafeCategories()throws Exception{
        classified(new HttpTimeoutException("PRIVATE-UPSTREAM"),"TEXT_MODEL_TIMEOUT");
    }
    @Test void anIoFailureDoesNotImplyAProviderRejection()throws Exception{
        classified(new IOException("PRIVATE-UPSTREAM"),"TEXT_MODEL_IO");
    }
    @Test void unexpectedFailureRemainsBoundedAndDoesNotLeakItsMessage()throws Exception{
        classified(new IllegalStateException("PRIVATE-UPSTREAM"),"TEXT_MODEL_UNAVAILABLE");
    }
    @Test void invalidOwnerIsRejectedBeforeAnyModelOrAccountAccess(){
        assertThrows(ApiException.class,()->new MuseTextGateway(provider,pool,client).complete("","muse-spark","system","input",1000));verifyNoInteractions(provider,pool,client);
    }
}
