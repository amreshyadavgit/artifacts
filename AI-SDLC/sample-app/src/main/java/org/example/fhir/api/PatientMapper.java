package org.example.fhir.api;

import java.util.Arrays;
import java.util.List;
import org.example.fhir.api.PatientResource.HumanName;
import org.example.fhir.api.PatientResource.Identifier;
import org.example.fhir.domain.Patient;

final class PatientMapper {

    private PatientMapper() {}

    static PatientResource toResource(Patient p) {
        List<String> given = (p.getGivenNames() == null || p.getGivenNames().isBlank())
                ? List.of()
                : Arrays.asList(p.getGivenNames().split(" "));
        return new PatientResource(
                "Patient",
                String.valueOf(p.getId()),
                List.of(new Identifier(p.getMrnSystem(), p.getMrn())),
                List.of(new HumanName(p.getFamilyName(), given)),
                p.getGender(),
                p.getBirthDate(),
                p.isActive());
    }

    static Patient toEntity(PatientResource r) {
        Patient p = new Patient();
        Identifier id = r.identifier().get(0);
        HumanName name = r.name().get(0);
        p.setMrnSystem(id.system());
        p.setMrn(id.value().trim());
        p.setFamilyName(name.family().trim());
        p.setGivenNames(name.given() == null ? null : String.join(" ", name.given()));
        p.setGender(r.gender());
        p.setBirthDate(r.birthDate());
        p.setActive(r.active() == null || r.active());
        return p;
    }
}
