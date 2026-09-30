package org.example.fhir.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

/** FHIR-lite Observation wire format (a strict subset of FHIR R4 Observation). */
public record ObservationResource(
        @Pattern(regexp = "Observation", message = "must be 'Observation'") String resourceType,
        String id,
        @NotBlank @Pattern(regexp = "registered|preliminary|final|amended",
                message = "must be one of registered|preliminary|final|amended") String status,
        @NotNull @Valid CodeableConcept code,
        @NotNull @Valid Reference subject,
        OffsetDateTime effectiveDateTime,
        @Valid Quantity valueQuantity) {

    public record CodeableConcept(@NotEmpty List<@Valid Coding> coding) {}

    /** e.g. system=http://loinc.org, code=8867-4, display=Heart rate */
    public record Coding(@NotBlank String system, @NotBlank String code, String display) {}

    public record Reference(@NotBlank @Pattern(regexp = "Patient/[0-9]+", message = "must be 'Patient/{id}'") String reference) {}

    public record Quantity(@NotNull BigDecimal value, String unit) {}
}
