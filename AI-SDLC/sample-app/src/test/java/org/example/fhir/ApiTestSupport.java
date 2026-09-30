package org.example.fhir;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** Shared setup: full Spring context on H2 (PostgreSQL mode) with Flyway migrations applied. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class ApiTestSupport {

    protected static final RequestPostProcessor CLINICIAN = httpBasic("clinician", "clinician-pass");
    protected static final RequestPostProcessor ADMIN = httpBasic("admin", "admin-pass");

    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper json;

    protected static String uniqueMrn() {
        return "MRN-" + UUID.randomUUID().toString().substring(0, 8);
    }

    protected static String patientJson(String mrn, String family, String gender) {
        return """
            {"resourceType":"Patient",
             "identifier":[{"system":"urn:oid:1.2.36.146.595.217.0.1","value":"%s"}],
             "name":[{"family":"%s","given":["Ada","Marie"]}],
             "gender":"%s","birthDate":"1980-04-12","active":true}
            """.formatted(mrn, family, gender);
    }

    protected static String observationJson(String subject, String code, String when, String value) {
        return """
            {"resourceType":"Observation","status":"final",
             "code":{"coding":[{"system":"http://loinc.org","code":"%s","display":"Heart rate"}]},
             "subject":{"reference":"%s"},
             "effectiveDateTime":"%s",
             "valueQuantity":{"value":%s,"unit":"beats/min"}}
            """.formatted(code, subject, when, value);
    }

    /** Creates a patient and returns its server-assigned id. */
    protected String createPatient(String family) throws Exception {
        return postAndReadId("/fhir/Patient", patientJson(uniqueMrn(), family, "female"));
    }

    protected String createObservation(String patientId, String code, String when, String value) throws Exception {
        return postAndReadId("/fhir/Observation", observationJson("Patient/" + patientId, code, when, value));
    }

    private String postAndReadId(String url, String body) throws Exception {
        String response = mvc.perform(post(url).with(CLINICIAN).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        JsonNode node = json.readTree(response);
        return node.get("id").asText();
    }
}
