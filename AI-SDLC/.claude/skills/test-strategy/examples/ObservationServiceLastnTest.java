package org.example.fhir.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.example.fhir.audit.AuditLogger;
import org.example.fhir.domain.Observation;
import org.example.fhir.domain.Patient;
import org.example.fhir.repository.ObservationRepository;
import org.example.fhir.repository.PatientRepository;
import org.junit.jupiter.api.Test;

/**
 * Unit tests (JUnit 5 + Mockito, no Spring context) for ObservationService.lastN business rules,
 * from .claude/skills/test-strategy/examples/lastn-test-plan.md (TC-01, TC-02).
 * Copy to sample-app/src/test/java/org/example/fhir/service/.
 */
class ObservationServiceLastnTest {

    private final ObservationRepository observations = mock(ObservationRepository.class);
    private final PatientRepository patients = mock(PatientRepository.class);
    private final AuditLogger audit = mock(AuditLogger.class);
    private final ObservationService service = new ObservationService(observations, patients, audit);

    private static Patient patient(long id) {
        Patient p = new Patient();
        p.setId(id);
        return p;
    }

    private static Observation observation(String code, String when) {
        Observation o = new Observation();
        o.setCode(code);
        o.setEffectiveDateTime(OffsetDateTime.parse(when));
        return o;
    }

    // TC-01
    @Test
    void lastNFiltersByTrimmedCodeAndKeepsFirstMatch() {
        Observation bp = observation("8480-6", "2026-02-03T08:00:00Z");
        Observation hrNew = observation("8867-4", "2026-02-02T08:00:00Z");
        Observation hrOld = observation("8867-4", "2026-02-01T08:00:00Z");
        when(patients.findById(1L)).thenReturn(Optional.of(patient(1L)));
        when(observations.findByPatientIdOrderByEffectiveDateTimeDesc(1L)).thenReturn(List.of(bp, hrNew, hrOld));

        List<Observation> result = service.lastN(List.of(1L), " 8867-4 ");

        assertThat(result).containsExactly(hrNew);
    }

    // TC-02
    @Test
    void lastNSkipsUnknownSubjectsAndAuditsOnlyTheCount() {
        when(patients.findById(anyLong())).thenReturn(Optional.empty());

        List<Observation> result = service.lastN(List.of(41L, 42L), null);

        assertThat(result).isEmpty();
        verify(observations, never()).findByPatientIdOrderByEffectiveDateTimeDesc(anyLong());
        verify(audit).recordSearch("Observation", 0);
    }
}
