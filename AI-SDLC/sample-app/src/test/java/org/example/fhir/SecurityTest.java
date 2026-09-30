package org.example.fhir;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;

class SecurityTest extends ApiTestSupport {

    @Test
    void anonymousRequestIs401OperationOutcome() throws Exception {
        mvc.perform(get("/fhir/Patient/1"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().exists("WWW-Authenticate"))
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"))
                .andExpect(jsonPath("$.issue[0].code").value("login"));
    }

    @Test
    void wrongPasswordIs401() throws Exception {
        mvc.perform(get("/fhir/Patient/1").with(httpBasic("clinician", "wrong")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void clinicianCannotDelete() throws Exception {
        String id = createPatient("Nightingale");
        mvc.perform(delete("/fhir/Patient/{id}", id).with(CLINICIAN))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"))
                .andExpect(jsonPath("$.issue[0].code").value("forbidden"));
    }

    @Test
    void adminCanDeleteAndPatientIsGone() throws Exception {
        String id = createPatient("Seacole");
        createObservation(id, "8867-4", "2026-01-01T08:00:00Z", "72");
        mvc.perform(delete("/fhir/Patient/{id}", id).with(ADMIN)).andExpect(status().isNoContent());
        mvc.perform(get("/fhir/Patient/{id}", id).with(ADMIN)).andExpect(status().isNotFound());
    }

    @Test
    void healthEndpointIsPublic() throws Exception {
        mvc.perform(get("/actuator/health/readiness"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }
}
