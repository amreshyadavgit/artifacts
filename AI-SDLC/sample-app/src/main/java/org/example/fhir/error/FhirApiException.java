package org.example.fhir.error;

import org.springframework.http.HttpStatus;

/**
 * Domain-level API error carrying the HTTP status and the FHIR issue code
 * (http://hl7.org/fhir/valueset-issue-type.html) to report.
 * Diagnostics must never contain PII - reference resources by id only.
 */
public class FhirApiException extends RuntimeException {

    private final HttpStatus status;
    private final String issueCode;

    public FhirApiException(HttpStatus status, String issueCode, String diagnostics) {
        super(diagnostics);
        this.status = status;
        this.issueCode = issueCode;
    }

    public static FhirApiException notFound(String resourceType, Object id) {
        return new FhirApiException(HttpStatus.NOT_FOUND, "not-found", resourceType + "/" + id + " not found");
    }

    public static FhirApiException badRequest(String diagnostics) {
        return new FhirApiException(HttpStatus.BAD_REQUEST, "invalid", diagnostics);
    }

    public static FhirApiException unprocessable(String diagnostics) {
        return new FhirApiException(HttpStatus.UNPROCESSABLE_ENTITY, "processing", diagnostics);
    }

    public static FhirApiException conflict(String diagnostics) {
        return new FhirApiException(HttpStatus.CONFLICT, "duplicate", diagnostics);
    }

    public HttpStatus getStatus() { return status; }
    public String getIssueCode() { return issueCode; }
}
