package org.example.fhir.error;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Maps every failure to a FHIR OperationOutcome with an appropriate HTTP status. */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(FhirApiException.class)
    ResponseEntity<OperationOutcome> handleFhir(FhirApiException ex) {
        return respond(ex.getStatus(), OperationOutcome.error(ex.getIssueCode(), ex.getMessage()));
    }

    /** Bean Validation failures -> 422. Only field names and constraint messages are echoed, never values. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<OperationOutcome> handleValidation(MethodArgumentNotValidException ex) {
        List<String> problems = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .sorted()
                .toList();
        return respond(HttpStatus.UNPROCESSABLE_ENTITY, OperationOutcome.errors("invalid", problems));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<OperationOutcome> handleUnreadable(HttpMessageNotReadableException ex) {
        return respond(HttpStatus.BAD_REQUEST, OperationOutcome.error("structure", "Request body is not valid JSON for this resource"));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    ResponseEntity<OperationOutcome> handleMissingParam(MissingServletRequestParameterException ex) {
        return respond(HttpStatus.BAD_REQUEST, OperationOutcome.error("required", "Missing required parameter: " + ex.getParameterName()));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<OperationOutcome> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return respond(HttpStatus.BAD_REQUEST, OperationOutcome.error("invalid", "Invalid value for parameter: " + ex.getName()));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<OperationOutcome> handleNoResource(NoResourceFoundException ex) {
        return respond(HttpStatus.NOT_FOUND, OperationOutcome.error("not-found", "Unknown endpoint"));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<OperationOutcome> handleMethod(HttpRequestMethodNotSupportedException ex) {
        return respond(HttpStatus.METHOD_NOT_ALLOWED, OperationOutcome.error("not-supported", "Method " + ex.getMethod() + " not supported"));
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<OperationOutcome> handleDenied(AccessDeniedException ex) {
        return respond(HttpStatus.FORBIDDEN, OperationOutcome.error("forbidden", "Insufficient privileges"));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<OperationOutcome> handleUnexpected(Exception ex) {
        log.error("Unhandled exception", ex);
        return respond(HttpStatus.INTERNAL_SERVER_ERROR, OperationOutcome.error("exception", "Internal server error"));
    }

    private static ResponseEntity<OperationOutcome> respond(HttpStatus status, OperationOutcome body) {
        return ResponseEntity.status(status).body(body);
    }
}
