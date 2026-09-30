package org.example.fhir.api;

import java.util.List;

/** Minimal FHIR searchset Bundle. */
public record Bundle(String resourceType, String type, int total, List<Entry> entry) {

    public record Entry(Object resource) {}

    public static Bundle searchset(List<?> resources) {
        return new Bundle("Bundle", "searchset", resources.size(),
                resources.stream().map(Entry::new).toList());
    }
}
