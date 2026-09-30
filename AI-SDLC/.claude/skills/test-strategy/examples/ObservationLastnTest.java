package org.example.fhir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.example.fhir.domain.Observation;
import org.example.fhir.repository.ObservationRepository;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * API, negative, edge, security and integration tests for GET /fhir/Observation/$lastn, from the
 * test plan in .claude/skills/test-strategy/examples/lastn-test-plan.md (TC ids in comments).
 *
 * Copy to sample-app/src/test/java/org/example/fhir/. Tests marked @Disabled fail against the current
 * code for the documented reason; the bug-fix workflow enables them first (testing-standards.md:
 * "Every bug fix starts with a failing test"). The query-count test lives in the performance-review
 * skill (LastnQueryCountTest, module 04).
 */
class ObservationLastnTest extends ApiTestSupport {

    private static final String LASTN = "/fhir/Observation/$lastn";

    @Autowired private ObservationRepository observations;

    private void postUndatedObservation(String patientId, String value) throws Exception {
        String body = """
            {"resourceType":"Observation","status":"final",
             "code":{"coding":[{"system":"http://loinc.org","code":"8867-4","display":"Heart rate"}]},
             "subject":{"reference":"Patient/%s"},
             "valueQuantity":{"value":%s,"unit":"beats/min"}}
            """.formatted(patientId, value);
        mvc.perform(post("/fhir/Observation").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());
    }

    // TC-04
    @Test
    void lastnFiltersByLoincCodeWithSystemPipe() throws Exception {
        String p = createPatient("Lastnpipe");
        createObservation(p, "8867-4", "2026-02-01T08:00:00Z", "64");
        createObservation(p, "8480-6", "2026-02-02T08:00:00Z", "120");
        mvc.perform(get(LASTN).param("subjects", p).param("code", "http://loinc.org|8867-4").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.entry[0].resource.code.coding[0].code").value("8867-4"))
                .andExpect(jsonPath("$.entry[0].resource.valueQuantity.value").value(64));
    }

    // TC-05
    @Test
    void lastnReturnsEmptySearchsetWhenNoObservationHasTheCode() throws Exception {
        String p = createPatient("Lastnnocode");
        createObservation(p, "8867-4", "2026-02-01T08:00:00Z", "64");
        mvc.perform(get(LASTN).param("subjects", p).param("code", "8480-6").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("searchset"))
                .andExpect(jsonPath("$.total").value(0))
                .andExpect(jsonPath("$.entry").isEmpty());
    }

    // TC-06
    @Test
    void lastnWithoutSubjectsParameterIs400() throws Exception {
        mvc.perform(get(LASTN).with(CLINICIAN))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"))
                .andExpect(jsonPath("$.issue[0].code").value("required"));
    }

    // TC-07
    @Test
    void lastnWithNonNumericSubjectIs400() throws Exception {
        mvc.perform(get(LASTN).param("subjects", "abc").with(CLINICIAN))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.issue[0].code").value("invalid"))
                .andExpect(jsonPath("$.issue[0].diagnostics").value("Invalid value for parameter: subjects"));
    }

    // TC-08 (characterization: unknown ids are skipped, not reported)
    @Test
    void lastnSkipsUnknownSubjects() throws Exception {
        String p = createPatient("Lastnunknown");
        createObservation(p, "8867-4", "2026-02-01T08:00:00Z", "66");
        mvc.perform(get(LASTN).param("subjects", p + ",987654321").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1));
    }

    // TC-09 (characterization: an empty list is not rejected)
    @Test
    void lastnWithEmptySubjectsReturnsEmptyBundle() throws Exception {
        mvc.perform(get(LASTN).param("subjects", "").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
    }

    // TC-10 (finding TS-001)
    @Test
    @Disabled("FHIR-130: an Observation without effectiveDateTime sorts first and wins $lastn")
    void lastnPrefersDatedObservationOverUndated() throws Exception {
        String p = createPatient("Lastnundated");
        postUndatedObservation(p, "99");
        createObservation(p, "8867-4", "2026-02-03T08:00:00Z", "80");
        mvc.perform(get(LASTN).param("subjects", p).with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entry[0].resource.valueQuantity.value").value(80));
    }

    // TC-11 (finding TS-002)
    @Test
    @Disabled("FHIR-131: duplicate subject ids return duplicate entries")
    void lastnReturnsOneEntryPerDistinctSubject() throws Exception {
        String p = createPatient("Lastnduplicate");
        createObservation(p, "8867-4", "2026-02-01T08:00:00Z", "70");
        mvc.perform(get(LASTN).param("subjects", p + "," + p).with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1));
    }

    // TC-12 (finding TS-006, characterization: the system part of code is ignored)
    @Test
    void lastnIgnoresTheCodeSystemPart() throws Exception {
        String p = createPatient("Lastnsystem");
        createObservation(p, "8867-4", "2026-02-01T08:00:00Z", "72");
        mvc.perform(get(LASTN).param("subjects", p).param("code", "http://snomed.info/sct|8867-4").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1));
    }

    // TC-14 (finding TS-004)
    @Test
    @Disabled("FHIR-132: no cap on the number of subjects per request")
    void lastnRejectsMoreThanHundredSubjects() throws Exception {
        String ids = IntStream.rangeClosed(1, 101).mapToObj(String::valueOf).collect(Collectors.joining(","));
        mvc.perform(get(LASTN).param("subjects", ids).with(CLINICIAN))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"));
    }

    // TC-15
    @Test
    void lastnWithoutCredentialsIs401() throws Exception {
        mvc.perform(get(LASTN).param("subjects", "1"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.issue[0].code").value("login"));
    }

    // TC-16
    @Test
    void lastnWithWrongPasswordIs401() throws Exception {
        mvc.perform(get(LASTN).param("subjects", "1").with(httpBasic("clinician", "wrong")))
                .andExpect(status().isUnauthorized());
    }

    // TC-17
    @Test
    void adminCanCallLastn() throws Exception {
        String p = createPatient("Lastnadmin");
        createObservation(p, "8867-4", "2026-02-01T08:00:00Z", "75");
        mvc.perform(get(LASTN).param("subjects", p).with(ADMIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entry[*].resource.subject.reference", contains("Patient/" + p)));
    }

    // TC-03 (integration: repository ordering on H2 in PostgreSQL mode; explains TS-001)
    @Test
    void repositoryOrdersUndatedObservationsFirstOnH2() throws Exception {
        String p = createPatient("Lastnordering");
        createObservation(p, "8867-4", "2026-02-03T08:00:00Z", "80");
        postUndatedObservation(p, "99");
        List<Observation> history = observations.findByPatientIdOrderByEffectiveDateTimeDesc(Long.valueOf(p));
        assertThat(history).hasSize(2);
        assertThat(history.get(0).getEffectiveDateTime()).isNull();
    }
}
