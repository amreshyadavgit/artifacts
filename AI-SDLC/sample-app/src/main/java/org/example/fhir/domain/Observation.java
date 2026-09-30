package org.example.fhir.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

@Entity
@Table(name = "observation")
public class Observation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** registered | preliminary | final | amended */
    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "code_system", nullable = false)
    private String codeSystem;

    @Column(name = "code", nullable = false)
    private String code;

    @Column(name = "code_display")
    private String codeDisplay;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "patient_id", nullable = false)
    private Patient patient;

    @Column(name = "effective_date_time")
    private OffsetDateTime effectiveDateTime;

    @Column(name = "value_quantity", precision = 18, scale = 4)
    private BigDecimal valueQuantity;

    @Column(name = "value_unit")
    private String valueUnit;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getCodeSystem() { return codeSystem; }
    public void setCodeSystem(String codeSystem) { this.codeSystem = codeSystem; }
    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }
    public String getCodeDisplay() { return codeDisplay; }
    public void setCodeDisplay(String codeDisplay) { this.codeDisplay = codeDisplay; }
    public Patient getPatient() { return patient; }
    public void setPatient(Patient patient) { this.patient = patient; }
    public OffsetDateTime getEffectiveDateTime() { return effectiveDateTime; }
    public void setEffectiveDateTime(OffsetDateTime effectiveDateTime) { this.effectiveDateTime = effectiveDateTime; }
    public BigDecimal getValueQuantity() { return valueQuantity; }
    public void setValueQuantity(BigDecimal valueQuantity) { this.valueQuantity = valueQuantity; }
    public String getValueUnit() { return valueUnit; }
    public void setValueUnit(String valueUnit) { this.valueUnit = valueUnit; }
}
