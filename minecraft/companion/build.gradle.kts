plugins {
    `java-library`
}

val sailJavaVersion: String by project
val sailPaperApiVersion: String by project

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

dependencies {
    compileOnly("io.papermc.paper:paper-api:$sailPaperApiVersion")

    testImplementation(platform("org.junit:junit-bom:6.1.0"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("io.papermc.paper:paper-api:$sailPaperApiVersion")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
