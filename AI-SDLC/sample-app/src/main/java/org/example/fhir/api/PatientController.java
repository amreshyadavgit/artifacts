package org.example.fhir.api;

import jakarta.validation.Valid;
import java.net.URI;
import org.example.fhir.domain.Patient;
import org.example.fhir.error.FhirApiException;
import org.example.fhir.service.PatientService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
@RequestMapping("/fhir/Patient")
public class PatientController {

    private final PatientService service;

    public PatientController(PatientService service) {
        this.service = service;
    }

    @GetMapping("/{id}")
    public PatientResource read(@PathVariable Long id) {
        return PatientMapper.toResource(service.get(id));
    }

    /** identifier accepts FHIR token syntax: "value" or "system|value". */
    @GetMapping
    public Bundle search(@RequestParam(required = false) String family,
                         @RequestParam(required = false) String identifier) {
        String mrn = identifier == null ? null : identifier.substring(identifier.indexOf('|') + 1);
        return Bundle.searchset(service.search(family, mrn).stream().map(PatientMapper::toResource).toList());
    }

    @PostMapping
    public ResponseEntity<PatientResource> create(@Valid @RequestBody PatientResource body) {
        Patient saved = service.create(PatientMapper.toEntity(body));
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}").buildAndExpand(saved.getId()).toUri();
        return ResponseEntity.created(location).body(PatientMapper.toResource(saved));
    }

    @PutMapping("/{id}")
    public PatientResource update(@PathVariable Long id, @Valid @RequestBody PatientResource body) {
        if (body.id() != null && !body.id().equals(String.valueOf(id))) {
            throw FhirApiException.badRequest("Resource id in body does not match URL");
        }
        return PatientMapper.toResource(service.update(id, PatientMapper.toEntity(body)));
    }

    /** ADMIN only - enforced in SecurityConfig. */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
