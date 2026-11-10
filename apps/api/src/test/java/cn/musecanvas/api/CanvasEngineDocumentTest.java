package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class CanvasEngineDocumentTest {
    private final CanvasEngineService service = new CanvasEngineService(null, null, new AppSettings(new MockEnvironment()));
    private static final String NODE = "{\"id\":\"n\",\"type\":\"text\",\"title\":\"text\",\"position\":{\"x\":-10,\"y\":20},\"width\":340,\"height\":240,\"metadata\":{\"content\":\"hello\"}}";

    @Test void nativeDataAndFutureMetadataArePreservedWithoutATypeWhitelist() {
        var document = Json.read("{\"nodes\":[" + NODE.replace("\"text\",\"title\"", "\"plugin:custom\",\"title\"")
            + "],\"connections\":[],\"viewport\":{\"x\":1,\"y\":2,\"k\":0.05},\"groups\":[{\"custom\":true}],\"promptLibrary\":[{\"text\":\"keep\"}],\"extension\":{\"nested\":[1,2]}}");
        assertEquals(document, Json.read(service.validateDocument(document)));
    }

    @Test void malformedNodesConnectionsAndViewportAreRejected() {
        String valid = "{\"nodes\":[" + NODE + "],\"connections\":[]}";
        for (String invalid : new String[] {
            "{}", "{\"nodes\":{},\"connections\":[]}",
            "{\"nodes\":[" + NODE + "," + NODE + "],\"connections\":[]}",
            valid.replace("\"width\":340", "\"width\":0"),
            valid.replace("\"x\":-10", "\"x\":\"bad\""),
            valid.replace("\"connections\":[]", "\"connections\":[{\"id\":\"e\",\"fromNodeId\":\"n\",\"toNodeId\":\"missing\"}]"),
            valid.replace("\"connections\":[]", "\"connections\":[{\"id\":\"e\",\"fromNodeId\":\"n\",\"toNodeId\":\"n\"},{\"id\":\"e\",\"fromNodeId\":\"n\",\"toNodeId\":\"n\"}]"),
            valid.replace("\"connections\":[]", "\"connections\":[],\"viewport\":{\"x\":0,\"y\":0,\"k\":0}"),
            valid.replace("\"metadata\":{\"content\":\"hello\"}", "\"metadata\":[]")
        }) assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.validateDocument(Json.read(invalid))).code);
    }

    @Test void theExistingDocumentByteLimitIsAppliedToTheEntireSnapshot() {
        var document = Json.read("{\"nodes\":[],\"connections\":[],\"metadata\":\"" + "x".repeat(2 * 1024 * 1024) + "\"}");
        assertEquals("INVALID_REQUEST", assertThrows(ApiException.class, () -> service.validateDocument(document)).code);
    }
}
