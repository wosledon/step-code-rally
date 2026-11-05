/**
 * Type shims for the StepCode extension specifiers.
 *
 * At runtime StepCode resolves `@step-harness/*` to the modules bundled inside
 * the CLI. For local typechecking and headless tests we point those specifiers
 * at the published upstream packages (see tsconfig.json `paths`, which resolve
 * to their JS entry points so tsx can load them), and these declarations
 * supply the types for the remapped specifiers.
 */

declare module "@step-harness/coding-agent" {
  export * from "@earendil-works/pi-coding-agent";
}

declare module "@step-harness/pi-tui" {
  export * from "@earendil-works/pi-tui";
}
