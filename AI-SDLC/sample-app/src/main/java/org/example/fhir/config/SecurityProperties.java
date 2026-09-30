package org.example.fhir.config;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/** Passwords for the two in-memory demo users. Supplied via env vars / Secret outside the local profile. */
@Validated
@ConfigurationProperties(prefix = "fhir.security")
public record SecurityProperties(@NotBlank String clinicianPassword, @NotBlank String adminPassword) {}
