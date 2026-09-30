package org.example.fhir.service;

import java.util.List;
import org.example.fhir.audit.AuditLogger;
import org.example.fhir.audit.AuditLogger.Action;
import org.example.fhir.domain.Patient;
import org.example.fhir.error.FhirApiException;
import org.example.fhir.repository.PatientRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PatientService {

    private final PatientRepository patients;
    private final AuditLogger audit;

    public PatientService(PatientRepository patients, AuditLogger audit) {
        this.patients = patients;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public Patient get(Long id) {
        Patient patient = patients.findById(id).orElseThrow(() -> FhirApiException.notFound("Patient", id));
        audit.record(Action.READ, "Patient", id);
        return patient;
    }

    /** Search by family name and/or MRN. At least one criterion is required (no unbounded listing of PHI). */
    @Transactional(readOnly = true)
    public List<Patient> search(String family, String mrn) {
        boolean hasFamily = family != null && !family.isBlank();
        boolean hasMrn = mrn != null && !mrn.isBlank();
        if (!hasFamily && !hasMrn) {
            throw FhirApiException.badRequest("At least one search parameter (family, identifier) is required");
        }
        List<Patient> result;
        if (hasMrn) {
            result = patients.findByMrn(mrn.trim()).stream()
                    .filter(p -> !hasFamily || p.getFamilyName().equalsIgnoreCase(family.trim()))
                    .toList();
        } else {
            result = patients.findByFamilyNameIgnoreCaseOrderByIdAsc(family.trim());
        }
        audit.recordSearch("Patient", result.size());
        return result;
    }

    @Transactional
    public Patient create(Patient patient) {
        if (patients.existsByMrn(patient.getMrn())) {
            throw FhirApiException.conflict("A Patient with this identifier already exists");
        }
        Patient saved = patients.save(patient);
        audit.record(Action.CREATE, "Patient", saved.getId());
        return saved;
    }

    @Transactional
    public Patient update(Long id, Patient changes) {
        Patient existing = patients.findById(id).orElseThrow(() -> FhirApiException.notFound("Patient", id));
        if (!existing.getMrn().equals(changes.getMrn()) && patients.existsByMrn(changes.getMrn())) {
            throw FhirApiException.conflict("A Patient with this identifier already exists");
        }
        existing.setMrnSystem(changes.getMrnSystem());
        existing.setMrn(changes.getMrn());
        existing.setFamilyName(changes.getFamilyName());
        existing.setGivenNames(changes.getGivenNames());
        existing.setGender(changes.getGender());
        existing.setBirthDate(changes.getBirthDate());
        existing.setActive(changes.isActive());
        audit.record(Action.UPDATE, "Patient", id);
        return existing;
    }

    @Transactional
    public void delete(Long id) {
        if (!patients.existsById(id)) {
            throw FhirApiException.notFound("Patient", id);
        }
        patients.deleteById(id);
        audit.record(Action.DELETE, "Patient", id);
    }
}
