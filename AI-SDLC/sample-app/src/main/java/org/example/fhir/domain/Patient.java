package org.example.fhir.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

/**
 * Patient entity. Deliberately has no toString(): patient demographics are PII
 * and must never end up in logs by accident.
 */
@Entity
@Table(name = "patient")
public class Patient {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "mrn_system")
    private String mrnSystem;

    @Column(name = "mrn", nullable = false, unique = true)
    private String mrn;

    @Column(name = "family_name", nullable = false)
    private String familyName;

    @Column(name = "given_names")
    private String givenNames;

    /** FHIR administrative gender: male | female | other | unknown. */
    @Column(name = "gender")
    private String gender;

    @Column(name = "birth_date")
    private LocalDate birthDate;

    @Column(name = "active", nullable = false)
    private boolean active = true;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getMrnSystem() { return mrnSystem; }
    public void setMrnSystem(String mrnSystem) { this.mrnSystem = mrnSystem; }
    public String getMrn() { return mrn; }
    public void setMrn(String mrn) { this.mrn = mrn; }
    public String getFamilyName() { return familyName; }
    public void setFamilyName(String familyName) { this.familyName = familyName; }
    public String getGivenNames() { return givenNames; }
    public void setGivenNames(String givenNames) { this.givenNames = givenNames; }
    public String getGender() { return gender; }
    public void setGender(String gender) { this.gender = gender; }
    public LocalDate getBirthDate() { return birthDate; }
    public void setBirthDate(LocalDate birthDate) { this.birthDate = birthDate; }
    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }
}
