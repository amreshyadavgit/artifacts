package org.example.fhir.api;

import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import org.example.fhir.domain.Observation;
import org.example.fhir.service.ObservationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
@RequestMapping("/fhir/Observation")
public class ObservationController {

    private final ObservationService service;

    public ObservationController(ObservationService service) {
        this.service = service;
    }

    @GetMapping("/{id}")
    public ObservationResource read(@PathVariable Long id) {
        return ObservationMapper.toResource(service.get(id));
    }

    /** GET /fhir/Observation?subject=Patient/{id}[&code=8867-4 | http://loinc.org|8867-4] */
    @GetMapping
    public Bundle search(@RequestParam String subject, @RequestParam(required = false) String code) {
        String codeValue = code == null ? null : code.substring(code.indexOf('|') + 1);
        List<Observation> found = service.searchBySubject(ObservationMapper.parseSubject(subject), codeValue);
        return Bundle.searchset(found.stream().map(ObservationMapper::toResource).toList());
    }

    /** GET /fhir/Observation/$lastn?subjects=1,2,3[&code=...] - latest Observation per subject. */
    @GetMapping("/$lastn")
    public Bundle lastN(@RequestParam List<Long> subjects, @RequestParam(required = false) String code) {
        String codeValue = code == null ? null : code.substring(code.indexOf('|') + 1);
        return Bundle.searchset(service.lastN(subjects, codeValue).stream().map(ObservationMapper::toResource).toList());
    }

    @PostMapping
    public ResponseEntity<ObservationResource> create(@Valid @RequestBody ObservationResource body) {
        Long subjectId = ObservationMapper.parseSubject(body.subject().reference());
        Observation saved = service.create(ObservationMapper.toEntity(body), subjectId);
        URI location = ServletUriComponentsBuilder.fromCurrentRequest().path("/{id}").buildAndExpand(saved.getId()).toUri();
        return ResponseEntity.created(location).body(ObservationMapper.toResource(saved));
    }
}
