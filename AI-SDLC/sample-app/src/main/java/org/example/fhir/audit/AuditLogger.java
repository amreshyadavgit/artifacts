package org.example.fhir.audit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * Records who touched which clinical record. Logs resource type, resource id, action and the
 * authenticated staff user ONLY - never names, MRNs, birth dates or observation values (PII/PHI).
 * Written to the dedicated "AUDIT" logger so it can be routed to a separate, retained sink.
 */
@Component
public class AuditLogger {

    public enum Action { READ, SEARCH, CREATE, UPDATE, DELETE }

    private static final Logger AUDIT = LoggerFactory.getLogger("AUDIT");

    public void record(Action action, String resourceType, Object resourceId) {
        AUDIT.info("action={} resource={}/{} user={}", action, resourceType, resourceId, currentUser());
    }

    public void recordSearch(String resourceType, int resultCount) {
        AUDIT.info("action={} resource={} results={} user={}", Action.SEARCH, resourceType, resultCount, currentUser());
    }

    private static String currentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth == null ? "anonymous" : auth.getName();
    }
}
