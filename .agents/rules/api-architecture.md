# API Architecture Governance

**Version**: 1.0  
**Status**: Active  
**Scope**: Project-agnostic principles

---

## Purpose

Establishes non-negotiable architectural standards for API design. These principles apply to any REST API project and prevent architectural drift.

**Project-Specific Reference**: See `route-reference.md` for this project's bounded contexts and route structure.

---

## Core Principles

### P1: Domain-Driven Boundaries

Routes MUST respect bounded context boundaries from Domain-Driven Design.

**Guidelines**:
- One API namespace per bounded context
- Aggregates root resources within their owning domain
- Cross-domain operations use explicit integration contracts
- Resources never span multiple domains

**See**: Route Reference for this project's domain map

---

### P2: Single Source of Truth

Each resource SHALL have **exactly one route handler file** owning all its operations.

**Enforcement**:
- Before creating new routes: `grep -r "resource_name" apps/api/src/routes`
- Check project route registry
- If resource handler exists → extend it
- If not → create and register

---

### P3: Resource-Oriented Design (RESTful)

Routes MUST be organized by **resource**, not by feature or journey.

**Correct**:
```
/api/{domain}/{resource}/:id/{sub-resource}
```

**Incorrect**:
```
/api/feature-name/action      # Feature-oriented
/api/journey-c/resource       # Journey-oriented
/api/do-something             # Action-oriented
```

---

### P4: File Size and Responsibility

Route files SHOULD be focused and maintainable.

**Guidelines**:
- Single responsibility per file
- Split files > 400 lines into focused handlers
- Group by operation type if splitting:
  - `resource.ts` → CRUD
  - `resource-operations.ts` → domain-specific actions

---

### P5: Response Schema Enforcement

**MANDATORY**: Every route MUST define Zod response schemas.

```typescript
{
    schema: {
        response: {
            200: ResourceContractSchema,
            404: ErrorResponseSchema,
            400: ErrorResponseSchema,
        }
    }
}
```

**Rationale**: Prevents serialization errors at runtime.

---

### P6: Consistent Error Responses

All error responses MUST follow a standard envelope:

```typescript
{
    error: string;          // Human-readable message
    code?: string;          // Machine-readable code (e.g., "NOT_FOUND")
    details?: unknown;      // Structured error details
}
```

---

## Architectural Review Gates

### Gate 1: Pre-Implementation (Spec Phase)

Before writing route code:
1. Search existing routes for duplicates
2. Check route registry
3. Verify resource belongs to intended domain
4. Document in spec/plan

**Blocker**: Duplicate handler → REJECT spec

### Gate 2: Code Review

Principal Engineer verifies:
1. [ ] Route follows domain boundaries (P1)
2. [ ] No duplicate handlers exist (P2)
3. [ ] RESTful conventions followed (P3)
4. [ ] File is focused (<400 lines) (P4)
5. [ ] Response schemas defined (P5)
6. [ ] Error format consistent (P6)
7. [ ] Tests exist

**Blocker**: Missing any item → REJECT PR

---

## Testing Standards

### Route Test Coverage

Every route file MUST have corresponding test:

**Route**: `routes/{resource}.ts`  
**Test**: `test/routes/{resource}.test.ts`

**Minimum Coverage**:
- Success cases (200/201/204)
- Not found (404)
- Validation errors (400)
- Authorization (401/403)

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| Scattered handlers | Violates P2 | Consolidate into single file |
| Feature namespaces | Violates P3 | Use resource namespaces |
| Missing schemas | Runtime errors | Define all response schemas |
| 800+ line files | Unmaintainable | Split by responsibility |
| Cross-domain routes | Violates P1 | Explicit integration |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-14 | Initial principles-based version |
