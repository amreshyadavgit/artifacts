package org.example.fhir.service;

import java.util.ArrayList;
import java.util.List;
import org.example.fhir.audit.AuditLogger;
import org.example.fhir.audit.AuditLogger.Action;
import org.example.fhir.domain.Observation;
import org.example.fhir.domain.Patient;
import org.example.fhir.error.FhirApiException;
import org.example.fhir.repository.ObservationRepository;
import org.example.fhir.repository.PatientRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ObservationService {

    private final ObservationRepository observations;
    private final PatientRepository patients;
    private final AuditLogger audit;

    public ObservationService(ObservationRepository observations, PatientRepository patients, AuditLogger audit) {
        this.observations = observations;
        this.patients = patients;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public Observation get(Long id) {
        Observation obs = observations.findById(id).orElseThrow(() -> FhirApiException.notFound("Observation", id));
        audit.record(Action.READ, "Observation", id);
        return obs;
    }

    @Transactional(readOnly = true)
    public List<Observation> searchBySubject(Long patientId, String code) {
        if (!patients.existsById(patientId)) {
            throw FhirApiException.notFound("Patient", patientId);
        }
        List<Observation> result = (code == null || code.isBlank())
                ? observations.findByPatientIdOrderByEffectiveDateTimeDesc(patientId)
                : observations.findByPatientIdAndCodeOrderByEffectiveDateTimeDesc(patientId, code.trim());
        audit.recordSearch("Observation", result.size());
        return result;
    }

    /** Creates an Observation; the subject must reference an existing Patient (422 otherwise). */
    @Transactional
    public Observation create(Observation observation, Long subjectId) {
        Patient subject = patients.findById(subjectId)
                .orElseThrow(() -> FhirApiException.unprocessable("subject references unknown Patient/" + subjectId));
        observation.setPatient(subject);
        Observation saved = observations.save(observation);
        audit.record(Action.CREATE, "Observation", saved.getId());
        return saved;
    }

    /**
     * $lastn: the most recent Observation per subject (optionally restricted to one code).
     */
    @Transactional(readOnly = true)
    public List<Observation> lastN(List<Long> subjectIds, String code) {
        List<Observation> result = new ArrayList<>();
        // TEACHING-DEFECT(perf-n+1): this loop issues 2 queries PER subject (a Patient lookup plus an
        // Observation lookup that loads the patient's whole history just to keep the first row).
        // 500 subjects => ~1000 DB round trips. Fix: one set-based query, e.g. a repository method
        // using "WHERE patient_id IN (:ids)" with a window function / max(effective_date_time) per patient.
        // Left in place intentionally for the curriculum exercises - see docs/KNOWN_DEFECTS.md.
        for (Long subjectId : subjectIds) {
            patients.findById(subjectId).ifPresent(patient ->
                    observations.findByPatientIdOrderByEffectiveDateTimeDesc(patient.getId()).stream()
                            .filter(o -> code == null || code.isBlank() || o.getCode().equals(code.trim()))
                            .findFirst()
                            .ifPresent(result::add));
        }
        audit.recordSearch("Observation", result.size());
        return result;
    }
}
