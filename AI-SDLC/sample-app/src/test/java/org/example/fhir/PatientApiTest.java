package org.example.fhir;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class PatientApiTest extends ApiTestSupport {

    @Test
    void createReturns201WithLocationAndResource() throws Exception {
        mvc.perform(post("/fhir/Patient").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON)
                        .content(patientJson(uniqueMrn(), "Lovelace", "female")))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", containsString("/fhir/Patient/")))
                .andExpect(jsonPath("$.resourceType").value("Patient"))
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.name[0].family").value("Lovelace"))
                .andExpect(jsonPath("$.name[0].given[1]").value("Marie"));
    }

    @Test
    void readById() throws Exception {
        String id = createPatient("Hopper");
        mvc.perform(get("/fhir/Patient/{id}", id).with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id))
                .andExpect(jsonPath("$.gender").value("female"))
                .andExpect(jsonPath("$.birthDate").value("1980-04-12"))
                .andExpect(jsonPath("$.active").value(true));
    }

    @Test
    void readUnknownReturns404OperationOutcome() throws Exception {
        mvc.perform(get("/fhir/Patient/999999").with(CLINICIAN))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"))
                .andExpect(jsonPath("$.issue[0].severity").value("error"))
                .andExpect(jsonPath("$.issue[0].code").value("not-found"));
    }

    @Test
    void searchByFamilyReturnsSearchsetBundle() throws Exception {
        createPatient("Curie");
        createPatient("curie");
        createPatient("Franklin");
        mvc.perform(get("/fhir/Patient").param("family", "CURIE").with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resourceType").value("Bundle"))
                .andExpect(jsonPath("$.type").value("searchset"))
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.entry[0].resource.resourceType").value("Patient"));
    }

    @Test
    void searchByIdentifierAcceptsSystemPipeValue() throws Exception {
        String mrn = uniqueMrn();
        mvc.perform(post("/fhir/Patient").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON)
                .content(patientJson(mrn, "Noether", "female"))).andExpect(status().isCreated());
        mvc.perform(get("/fhir/Patient").param("identifier", "urn:oid:1.2.36.146.595.217.0.1|" + mrn).with(CLINICIAN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.entry[0].resource.identifier[0].value").value(mrn));
    }

    @Test
    void searchWithoutParametersIs400() throws Exception {
        mvc.perform(get("/fhir/Patient").with(CLINICIAN))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"));
    }

    @Test
    void updateReplacesResource() throws Exception {
        String id = createPatient("Meitner");
        String body = patientJson(uniqueMrn(), "Meitner-Frisch", "female").replace("\"active\":true", "\"active\":false");
        mvc.perform(put("/fhir/Patient/{id}", id).with(CLINICIAN).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name[0].family").value("Meitner-Frisch"))
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    void updateUnknownIs404() throws Exception {
        mvc.perform(put("/fhir/Patient/888888").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON)
                        .content(patientJson(uniqueMrn(), "Nobody", "male")))
                .andExpect(status().isNotFound());
    }

    @Test
    void updateWithMismatchedIdIs400() throws Exception {
        String id = createPatient("Germain");
        String body = patientJson(uniqueMrn(), "Germain", "female").replace("{\"resourceType\":\"Patient\",", "{\"resourceType\":\"Patient\",\"id\":\"12345678\",");
        mvc.perform(put("/fhir/Patient/{id}", id).with(CLINICIAN).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.issue[0].code").value("invalid"));
    }

    @Test
    void missingNameIs422WithOperationOutcome() throws Exception {
        String body = """
            {"resourceType":"Patient","identifier":[{"value":"%s"}],"gender":"male"}
            """.formatted(uniqueMrn());
        mvc.perform(post("/fhir/Patient").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.resourceType").value("OperationOutcome"))
                .andExpect(jsonPath("$.issue[*].diagnostics", hasItem(containsString("name"))));
    }

    @Test
    void invalidGenderIs422() throws Exception {
        mvc.perform(post("/fhir/Patient").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON)
                        .content(patientJson(uniqueMrn(), "Turing", "robot")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.issue[0].diagnostics", containsString("gender")));
    }

    @Test
    void malformedJsonIs400() throws Exception {
        mvc.perform(post("/fhir/Patient").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.issue[0].code").value("structure"));
    }

    @Test
    void duplicateMrnIs409() throws Exception {
        String mrn = uniqueMrn();
        mvc.perform(post("/fhir/Patient").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON)
                .content(patientJson(mrn, "Somerville", "female"))).andExpect(status().isCreated());
        mvc.perform(post("/fhir/Patient").with(CLINICIAN).contentType(MediaType.APPLICATION_JSON)
                        .content(patientJson(mrn, "Somerville", "female")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.issue[0].code").value("duplicate"));
    }
}
