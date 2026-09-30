package org.example.fhir;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class ObservationApiTest extends ApiTestSupport {

    @Test
    void createAndReadObservation() throws Exception {
        String patientId = createPatient("Blackwell");
        String obsId = createObservation(patientId, "8867-4", "2026-03-01T09:30:00Z", "68");
        mvc.perform(get("/fhir/Observation/{id}", obsId).with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resourceType").value("Observation"))
                .andExpect(jsonPath("$.status").value("final"))
                .andExpect(jsonPath("$.code.coding[0].system").value("http://loinc.org"))
                .andExpect(jsonPath("$.code.coding[0].code").value("8867-4"))
                .andExpect(jsonPath("$.subject.reference").value("Patient/" + patientId))
                .andExpect(jsonPath("$.valueQuantity.value").value(68))
                .andExpect(jsonPath("$.valueQuantity.unit").value("beats/min"));
    }

    @Test
    void searchBySubjectReturnsOnlyThatPatientsObservations() throws Exception {
        String p1 = createPatient("Apgar");
        String p2 = createPatient("Barton");
        createObservation(p1, "8867-4", "2026-03-01T09:00:00Z", "70");
        createObservation(p1, "8310-5", "2026-03-01T09:05:00Z", "37.1");
        createObservation(p2, "8867-4", "2026-03-01T09:10:00Z", "90");

        mvc.perform(get("/fhir/Observation").param("subject", "Patient/" + p1).with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("searchset"))
                .andExpect(jsonPath("$.total").value(2));

        mvc.perform(get("/fhir/Observation").param("subject", "Patient/" + p1)
                        .param("code", "http://loinc.org|8867-4").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.entry[0].resource.valueQuantity.value").value(70));
    }

    @Test
    void searchForUnknownSubjectIs404() throws Exception {
        mvc.perform(get("/fhir/Observation").param("subject", "Patient/777777").with(CLINICIAN))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"));
    }

    @Test
    void searchWithoutSubjectIs400() throws Exception {
        mvc.perform(get("/fhir/Observation").with(CLINICIAN))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.issue[0].code").value("required"));
    }

    @Test
    void observationForUnknownPatientIs422() throws Exception {
        mvc.perform(post("/fhir/Observation").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON)
                        .content(observationJson("Patient/666666", "8867-4", "2026-03-01T09:00:00Z", "70")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.issue[0].code").value("processing"));
    }

    @Test
    void invalidSubjectReferenceIs422() throws Exception {
        mvc.perform(post("/fhir/Observation").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON)
                        .content(observationJson("Practitioner/1", "8867-4", "2026-03-01T09:00:00Z", "70")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"));
    }

    @Test
    void lastnReturnsMostRecentObservationPerSubject() throws Exception {
        String p1 = createPatient("Elion");
        String p2 = createPatient("Hodgkin");
        createObservation(p1, "8867-4", "2026-02-01T08:00:00Z", "60");
        createObservation(p1, "8867-4", "2026-02-02T08:00:00Z", "61");
        createObservation(p2, "8867-4", "2026-02-01T08:00:00Z", "80");

        mvc.perform(get("/fhir/Observation/$lastn").param("subjects", p1 + "," + p2).with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.entry[*].resource.valueQuantity.value", containsInAnyOrder(61, 80)));
    }
}
