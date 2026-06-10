plugins {
    `java-library`
}

import org.gradle.api.file.DuplicatesStrategy

val sailJavaVersion: String by project
val sailVelocityApiVersion: String by project

java {
    sourceCompatibility = JavaVersion.toVersion(sailJavaVersion)
    targetCompatibility = JavaVersion.toVersion(sailJavaVersion)
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(sailJavaVersion.toInt())
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

tasks.jar {
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    exclude("META-INF/*.DSA", "META-INF/*.RSA", "META-INF/*.SF")
    from({
        configurations.runtimeClasspath.get()
            .filter { it.name.endsWith(".jar") }
            .map { zipTree(it) }
    })
}

dependencies {
    compileOnly("com.velocitypowered:velocity-api:$sailVelocityApiVersion")
    annotationProcessor("com.velocitypowered:velocity-api:$sailVelocityApiVersion")

    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
    implementation("com.nimbusds:nimbus-jose-jwt:10.9.1")
    implementation("org.spongepowered:configurate-yaml:4.2.0")

    testImplementation(platform("org.junit:junit-bom:6.1.0"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("com.velocitypowered:velocity-api:$sailVelocityApiVersion")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
