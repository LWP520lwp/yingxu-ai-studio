package cn.musecanvas.api;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class MuseTextResponseTest {
    private static final String FINAL="{\"characters\":[{\"id\":\"char_1\",\"name\":\"甲\"}],\"scenes\":[],\"props\":[]}";
    @Test void normalizesSyntheticPartialRewrittenSnapshotsToTheOnlyFinalCompleteDocument(){
        String partial="{\"characters\":{\"id\":\"char_1\"}, {\"id\":\"char_2\"},\"scenes\":";
        String newer="{\"characters\":[{\"id\":\"char_1\",\"name\":\"甲\"}],\"scenes\":[],\"props\":";
        assertEquals(Json.read(FINAL),Json.read(MuseTextResponse.normalize(partial+newer+FINAL,MuseTextResponse.Shape.EXTRACT)));
    }
    @Test void bracesAndEscapedQuotesInsideStringsAreNotCandidateBoundaries(){
        String complete="{\"characters\":[{\"name\":\"内容包含{括号}与\\\"引号\\\"\"}],\"scenes\":[],\"props\":[]}";
        assertEquals(Json.read(complete),Json.read(MuseTextResponse.normalize("{\"characters\":"+complete,MuseTextResponse.Shape.EXTRACT)));
    }
    @Test void differentCompleteDocumentsAreRejectedWithoutChoosingTheLast(){
        String other="{\"characters\":[{\"name\":\"乙\"}],\"scenes\":[],\"props\":[]}";
        assertThrows(MuseClient.Rejected.class,()->MuseTextResponse.normalize(FINAL+other,MuseTextResponse.Shape.EXTRACT));
    }
    @Test void aTruncatedFinalSnapshotCannotBeReplacedByAnEarlierCompleteOne(){
        assertThrows(MuseClient.Rejected.class,()->MuseTextResponse.normalize(FINAL+"{\"characters\":[",MuseTextResponse.Shape.EXTRACT));
    }
    @Test void noJsonAndNestedDocumentsDoNotBecomeSuccessfulPlans(){
        assertThrows(MuseClient.Rejected.class,()->MuseTextResponse.normalize("网页未完成回复",MuseTextResponse.Shape.EXTRACT));
        assertThrows(MuseClient.Rejected.class,()->MuseTextResponse.normalize("{\"outer\":"+FINAL+"}",MuseTextResponse.Shape.EXTRACT));
    }
    @Test void eachPlannerUsesItsDeclaredRootShapeAndNeverRepairsMissingFields(){
        assertEquals("{\"shots\":[]}",MuseTextResponse.normalize("{\"shots\":"+"{\"shots\":[]}",MuseTextResponse.Shape.SHOTS));
        assertEquals("{\"title\":\"标题\",\"scenes\":[]}",MuseTextResponse.normalize("{\"title\":\"未完成"+"{\"title\":\"标题\",\"scenes\":[]}",MuseTextResponse.Shape.SCIENCE));
        assertThrows(MuseClient.Rejected.class,()->MuseTextResponse.normalize("{\"characters\":[],\"scenes\":[]}",MuseTextResponse.Shape.EXTRACT));
        assertThrows(MuseClient.Rejected.class,()->MuseTextResponse.normalize(FINAL,MuseTextResponse.Shape.SHOTS));
    }
    @Test void duplicateKeysAreRejectedAndOrdinaryFencedJsonStillWorks(){
        assertThrows(MuseClient.Rejected.class,()->MuseTextResponse.normalize("{\"shots\":[],\"shots\":[{}]}",MuseTextResponse.Shape.SHOTS));
        assertEquals(Json.read(FINAL),Json.read(MuseTextResponse.normalize("```json\n"+FINAL+"\n```",MuseTextResponse.Shape.EXTRACT)));
    }
}
