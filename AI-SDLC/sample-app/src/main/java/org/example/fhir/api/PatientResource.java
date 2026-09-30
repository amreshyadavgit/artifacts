package org.example.fhir.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/** FHIR-lite Patient wire format (a strict subset of FHIR R4 Patient). */
public record PatientResource(
        @Pattern(regexp = "Patient", message = "must be 'Patient'") String resourceType,
        String id,
        @NotEmpty @Size(max = 1, message = "only one identifier (MRN) is supported") List<@Valid Identifier> identifier,
        @NotEmpty @Size(max = 1, message = "only one name is supported") List<@Valid HumanName> name,
        @Pattern(regexp = "male|female|other|unknown", message = "must be one of male|female|other|unknown") String gender,
        @PastOrPresent LocalDate birthDate,
        Boolean active) {

    public record Identifier(String system, @NotBlank @Size(max = 64) String value) {}

    public record HumanName(@NotBlank @Size(max = 255) String family, List<@NotBlank String> given) {}
}
