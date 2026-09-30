package org.example.fhir.api;

import java.util.List;
import org.example.fhir.api.ObservationResource.CodeableConcept;
import org.example.fhir.api.ObservationResource.Coding;
import org.example.fhir.api.ObservationResource.Quantity;
import org.example.fhir.api.ObservationResource.Reference;
import org.example.fhir.domain.Observation;
import org.example.fhir.error.FhirApiException;

final class ObservationMapper {

    private ObservationMapper() {}

    static ObservationResource toResource(Observation o) {
        Quantity quantity = o.getValueQuantity() == null ? null : new Quantity(o.getValueQuantity().stripTrailingZeros(), o.getValueUnit());
        return new ObservationResource(
                "Observation",
                String.valueOf(o.getId()),
                o.getStatus(),
                new CodeableConcept(List.of(new Coding(o.getCodeSystem(), o.getCode(), o.getCodeDisplay()))),
                // getId() on a lazy proxy does not trigger a load
                new Reference("Patient/" + o.getPatient().getId()),
                o.getEffectiveDateTime(),
                quantity);
    }

    static Observation toEntity(ObservationResource r) {
        Observation o = new Observation();
        Coding coding = r.code().coding().get(0);
        o.setStatus(r.status());
        o.setCodeSystem(coding.system());
        o.setCode(coding.code());
        o.setCodeDisplay(coding.display());
        o.setEffectiveDateTime(r.effectiveDateTime());
        if (r.valueQuantity() != null) {
            o.setValueQuantity(r.valueQuantity().value());
            o.setValueUnit(r.valueQuantity().unit());
        }
        return o;
    }

    /** Accepts "Patient/123" (FHIR style) or a bare "123". */
    static Long parseSubject(String subject) {
        String raw = subject.startsWith("Patient/") ? subject.substring("Patient/".length()) : subject;
        try {
            return Long.valueOf(raw);
        } catch (NumberFormatException e) {
            throw FhirApiException.badRequest("subject must be 'Patient/{id}'");
        }
    }
}
