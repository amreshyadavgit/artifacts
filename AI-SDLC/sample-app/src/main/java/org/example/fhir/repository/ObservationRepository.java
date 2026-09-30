package org.example.fhir.repository;

import java.util.List;
import org.example.fhir.domain.Observation;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ObservationRepository extends JpaRepository<Observation, Long> {

    List<Observation> findByPatientIdOrderByEffectiveDateTimeDesc(Long patientId);

    List<Observation> findByPatientIdAndCodeOrderByEffectiveDateTimeDesc(Long patientId, String code);
}
