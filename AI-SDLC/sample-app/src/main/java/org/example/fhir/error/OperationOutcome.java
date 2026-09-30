package org.example.fhir.error;

import java.util.List;

/** Minimal FHIR OperationOutcome: every error response from this API uses this shape. */
public record OperationOutcome(String resourceType, List<Issue> issue) {

    public record Issue(String severity, String code, String diagnostics) {}

    public static OperationOutcome error(String code, String diagnostics) {
        return new OperationOutcome("OperationOutcome", List.of(new Issue("error", code, diagnostics)));
    }

    public static OperationOutcome errors(String code, List<String> diagnostics) {
        return new OperationOutcome("OperationOutcome",
                diagnostics.stream().map(d -> new Issue("error", code, d)).toList());
    }
}
