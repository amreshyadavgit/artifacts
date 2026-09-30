package org.example.fhir.repository;

import java.util.List;
import java.util.Optional;
import org.example.fhir.domain.Patient;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PatientRepository extends JpaRepository<Patient, Long> {

    Optional<Patient> findByMrn(String mrn);

    boolean existsByMrn(String mrn);

    List<Patient> findByFamilyNameIgnoreCaseOrderByIdAsc(String familyName);
}
