package org.example.fhir.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.example.fhir.error.OperationOutcome;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;

/**
 * HTTP Basic with two in-memory users. Deliberately simple for teaching; a real deployment
 * would use OAuth2/SMART-on-FHIR bearer tokens.
 */
@Configuration
public class SecurityConfig {

    public static final String CLINICIAN = "CLINICIAN";
    public static final String ADMIN = "ADMIN";

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ObjectMapper mapper) throws Exception {
        AuthenticationEntryPoint unauthorized = (req, res, ex) -> {
            res.setHeader("WWW-Authenticate", "Basic realm=\"fhir-lite\"");
            write(res, mapper, HttpServletResponse.SC_UNAUTHORIZED, "login", "Authentication required");
        };
        http
            .csrf(csrf -> csrf.disable()) // stateless API, no cookies/sessions
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**", "/actuator/info").permitAll()
                .requestMatchers(HttpMethod.DELETE, "/fhir/**").hasRole(ADMIN)
                .requestMatchers("/fhir/**").hasAnyRole(CLINICIAN, ADMIN)
                .anyRequest().denyAll())
            .httpBasic(basic -> basic.authenticationEntryPoint(unauthorized))
            .exceptionHandling(e -> e
                .authenticationEntryPoint(unauthorized)
                .accessDeniedHandler((req, res, ex) ->
                    write(res, mapper, HttpServletResponse.SC_FORBIDDEN, "forbidden", "Insufficient privileges")))
            .headers(Customizer.withDefaults());
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    UserDetailsService users(SecurityProperties props, PasswordEncoder encoder) {
        return new InMemoryUserDetailsManager(
            User.withUsername("clinician").password(encoder.encode(props.clinicianPassword())).roles(CLINICIAN).build(),
            User.withUsername("admin").password(encoder.encode(props.adminPassword())).roles(ADMIN, CLINICIAN).build());
    }

    private static void write(HttpServletResponse res, ObjectMapper mapper, int status, String code, String msg)
            throws IOException {
        res.setStatus(status);
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        mapper.writeValue(res.getOutputStream(), OperationOutcome.error(code, msg));
    }
}
