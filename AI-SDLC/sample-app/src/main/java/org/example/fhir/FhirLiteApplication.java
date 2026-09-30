package org.example.fhir;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class FhirLiteApplication {

    public static void main(String[] args) {
        SpringApplication.run(FhirLiteApplication.class, args);
    }
}
