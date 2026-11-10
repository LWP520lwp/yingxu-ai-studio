package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

class ScienceModelSelectionTest {
    private final ScienceVideoDocument documents = new ScienceVideoDocument(mock(WorkbenchStore.class));

    private JsonNode withModels(String selection) {
        String document = Json.write(ScienceVideoDocument.empty());
        return Json.read(document.substring(0, document.length() - 1) + ",\"models\":" + selection + "}");
    }

    @Test void oldDraftsRemainValidWithoutModelSelection() {
        JsonNode saved = documents.validate("owner", "project", ScienceVideoDocument.empty());
        assertFalse(saved.has("models"));
    }

    @Test void selectionsRoundTripAndCanOutliveADeletedChannel() {
        JsonNode selected = withModels("{\"text\":\"channel:removed-channel:text-model\",\"image\":\"muse-service-image\",\"video\":\"muse-service-video\"}");
        JsonNode saved = documents.validate("owner", "project", selected);
        assertEquals(selected.path("models"), saved.path("models"));
        assertEquals("", documents.validate("owner", "project", withModels("{\"text\":\"\"}")).path("models").path("text").asString());
    }

    @Test void credentialsAndMalformedSelectionsAreRejected() {
        assertThrows(ApiException.class, () -> documents.validate("owner", "project", withModels("{\"apiKey\":\"example-key\"}")));
        assertThrows(ApiException.class, () -> documents.validate("owner", "project", withModels("{\"text\":123}")));
        assertThrows(ApiException.class, () -> documents.validate("owner", "project", withModels("{\"image\":\"" + "a".repeat(121) + "\"}")));
        assertThrows(ApiException.class, () -> documents.validate("owner", "project", withModels("[]")));
    }
}
