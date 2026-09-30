package org.example.fhir;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.persistence.EntityManagerFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.LongStream;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/**
 * Performance smoke test for GET /fhir/Observation/$lastn (context/standards/testing-standards.md,
 * "query-count assertion (Hibernate statistics)").
 *
 * Copy to sample-app/src/test/java/org/example/fhir/ in a scratch copy of the app.
 * Optional: run with -Dspring.jpa.show-sql=true and feed the output to
 * .claude/skills/performance-review/scripts/count-queries.mjs --from LASTN_BEGIN --to LASTN_QUERY_COUNT.
 * Before the fix in lastn-set-based.patch: 2 of 4 tests fail (40 statements for 20 subjects; no cap).
 * After the fix: all 4 pass (1 statement for 20 subjects; 101 subjects rejected with 400).
 */
@TestPropertySource(properties = "spring.jpa.properties.hibernate.generate_statistics=true")
class LastnQueryCountTest extends ApiTestSupport {

    private static final int SUBJECTS = 20;

    @Autowired
    private EntityManagerFactory emf;

    private Statistics statistics() {
        return emf.unwrap(SessionFactory.class).getStatistics();
    }

    @Test
    void lastnIssuesAConstantNumberOfStatementsRegardlessOfSubjectCount() throws Exception {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < SUBJECTS; i++) {
            String patientId = createPatient("Querycount");
            createObservation(patientId, "8867-4", "2026-02-01T08:00:00Z", "60");
            createObservation(patientId, "8867-4", "2026-02-02T08:00:00Z", String.valueOf(61 + i));
            ids.add(patientId);
        }

        Statistics stats = statistics();
        stats.clear();
        System.out.println("LASTN_BEGIN");
        mvc.perform(get("/fhir/Observation/$lastn").param("subjects", String.join(",", ids)).with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(SUBJECTS))
                .andExpect(jsonPath("$.entry[0].resource.subject.reference").value("Patient/" + ids.get(0)))
                .andExpect(jsonPath("$.entry[0].resource.valueQuantity.value").value(61));
        long statements = stats.getPrepareStatementCount();
        System.out.printf("LASTN_QUERY_COUNT subjects=%d statements=%d%n", SUBJECTS, statements);

        assertThat(statements)
                .as("$lastn must not issue queries per subject (TEACHING-DEFECT(perf-n+1))")
                .isLessThanOrEqualTo(2);
    }

    @Test
    void lastnWithCodeReturnsLatestObservationOfThatCode() throws Exception {
        String patientId = createPatient("Querycode");
        createObservation(patientId, "8867-4", "2026-02-01T08:00:00Z", "70");
        createObservation(patientId, "8310-5", "2026-02-03T08:00:00Z", "37");

        mvc.perform(get("/fhir/Observation/$lastn").param("subjects", patientId)
                        .param("code", "http://loinc.org|8867-4").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.entry[0].resource.code.coding[0].code").value("8867-4"))
                .andExpect(jsonPath("$.entry[0].resource.valueQuantity.value").value(70));
    }

    @Test
    void lastnSkipsUnknownSubjects() throws Exception {
        String patientId = createPatient("Queryskip");
        createObservation(patientId, "8867-4", "2026-02-01T08:00:00Z", "75");

        mvc.perform(get("/fhir/Observation/$lastn").param("subjects", patientId + ",987654").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1));
    }

    @Test
    void lastnRejectsMoreThan100Subjects() throws Exception {
        String subjects = LongStream.rangeClosed(900_001, 900_101).mapToObj(Long::toString)
                .collect(Collectors.joining(","));

        mvc.perform(get("/fhir/Observation/$lastn").param("subjects", subjects).with(CLINICIAN))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"))
                .andExpect(jsonPath("$.issue[0].code").value("invalid"));
    }
}
