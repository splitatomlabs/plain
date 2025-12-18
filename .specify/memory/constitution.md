<!--
Sync Impact Report:
Version: template → 1.0.0 (MINOR - initial constitution creation)
Modified Principles: N/A (initial creation)
Added Sections:
  - Core Principles (I-V)
  - Technical Standards
  - Performance Standards
  - AI Content Quality Standards
  - Development Workflow
  - Governance
Removed Sections: N/A
Templates Status:
  - ✅ plan-template.md: Constitution Check section ready for principle validation
  - ✅ spec-template.md: User scenarios align with test-first principle
  - ✅ tasks-template.md: Task organization supports TDD workflow
Follow-up TODOs: None
-->

# Plain Constitution

## Core Principles

### I. Platform-Native Excellence (NON-NEGOTIABLE)

The iOS app MUST feel native and leverage platform capabilities fully. Every UI element MUST
use SwiftUI following Apple Human Interface Guidelines. This MUST include best practices for accessibility such as support for VoiceOver, Dark Interface, Larger Text, Differentiate without Color Alone, Sufficient Contrast, Reduced Motion, Voice Control. Interactions MUST use native iOS
patterns: share sheets for distribution, haptics for feedback, system fonts and spacing.
The Firebase backend MUST be optimized for mobile constraints including latency, payload
size, and offline scenarios. Cross-platform compromises that degrade native experience are
prohibited.

**Rationale**: Gen Z users have zero tolerance for non-native apps. Competing with TikTok
and Instagram requires matching their platform-native polish. A compromised experience
breaks immersion and kills sharing, our primary success metric.

### II. Test-First Development (NON-NEGOTIABLE)

TDD is mandatory for all feature development. The workflow is strictly enforced:
1. Write tests that capture requirements
2. Get user/stakeholder approval on test scenarios
3. Verify tests fail (RED)
4. Implement to make tests pass (GREEN)
5. Refactor while keeping tests green (REFACTOR)

Contract tests required for all Firebase Functions. Integration tests required for critical
user journeys. No implementation begins until tests exist and fail. No PR merges with
failing tests.

**Rationale**: Plain's success depends on emotional clarity and consistent quality. Testing
first ensures we build what users need and prevents regressions in AI-generated content
quality and user experience.

### III. AI Content Quality & Philosophical Integrity

AI-generated insights MUST maintain consistent tone aligned with product principles:
grounding, accessible, emotionally relevant. Every insight MUST be traceable to source
material from public domain philosophy (Stoicism, Platonism initially). Tone variations
(gentle clarity, grounded realism) MUST preserve philosophical accuracy while adapting
emotional register.

Quality gates:
- Insights MUST be comprehensible without philosophical background
- Reinterpretations MUST honor source material intent
- Tone MUST support emotional grounding, never increase anxiety
- Generated content requires validation against source before production deployment

**Rationale**: Quality content is our only moat against algorithmic feeds. Users trust
ideas from culturally respected sources. Drift toward generic AI slop destroys the product's
core value proposition.

### IV. User-First Validation & Rapid Iteration

Every feature MUST serve the mission of emotional clarity through accessible philosophy.
Features MUST be designed for independent deployment following v0 → v1 → v2 structure.
Prefer shipping 80% solutions quickly over 100% solutions slowly. Product decisions are
validated through user behavior metrics: shares per DAU, session share rate, D1/D7/D30
retention.

When choosing between implementations, prefer the approach that enables fastest measurement
or best serves success metrics. Features that do not measurably contribute to sharing or
retention require explicit justification.

**Rationale**: User behavior in this space is uncertain. Fast iteration with real users
teaches us what creates emotional clarity without over-investing in unvalidated assumptions.

### V. Performance as User Experience

The app MUST feel instant and responsive at all times. Performance budgets are
NON-NEGOTIABLE quality gates:
- 60fps scrolling in feeds and animations
- Sub-200ms response for all tap interactions
- Sub-100ms p95 latency for Firebase Function responses
- Graceful offline degradation with cached content

Performance regressions are blocking issues that halt feature work until resolved.

**Rationale**: We compete with TikTok and Instagram for user attention. Anything less than
their performance standard drives users back to doom scrolling. Performance is the price of
entry.

## Technical Standards

### Code Quality Requirements

**iOS (Swift/SwiftUI)**
- Swift 5.9+ with strict concurrency checking enabled
- SwiftUI for all UI components (no UIKit bridging without justification)
- Follow Apple Human Interface Guidelines, Accessibility Best Practices, and platform conventions
- Use native share sheet (UIActivityViewController) for all sharing
- Async/await for all asynchronous operations

**Backend (Firebase Functions)**
- TypeScript with strict mode enabled, no implicit any
- Firebase Functions v5.0+, Firebase Admin SDK v12.0+
- Node.js 18 runtime
- Structured logging for all operations (info, warn, error)
- Error responses MUST include actionable messages for client

**Universal Requirements**
- Zero linting warnings tolerated in production builds
- Complex logic requires inline comments explaining "why" not "what"
- Code reviews required for all changes (exceptions: docs, typos, urgent hotfixes)
- Complexity violations require explicit justification in plan.md

### Testing Standards

**Contract Tests (Firebase Functions - REQUIRED)**
- Every Cloud Function endpoint MUST have contract tests
- Tests MUST verify request/response schemas
- Tests MUST verify error handling for invalid inputs
- Located in `firebase/functions/tests/contract/`

**Integration Tests (Critical Paths - REQUIRED)**
- Emotional check-in → insight generation → share flow
- Path progression and node advancement logic
- AI content quality validation against source material
- Located in `ios/PlainTests/Integration/` and `firebase/functions/tests/integration/`

**Unit Tests (Optional but Encouraged)**
- Complex business logic and algorithms
- Data transformations and parsing
- Edge case handling

**Test Workflow (NON-NEGOTIABLE)**
- Write tests first, get approval, verify failure before implementation
- All tests MUST pass before PR approval
- Failing tests block deployments

### Documentation Requirements

- All Firebase Functions MUST document input/output contracts and error codes
- SwiftUI views MUST document purpose and key dependencies in file header
- Complex algorithms MUST include rationale comments
- User-facing features require entries in internal feature documentation
- PRD and constitution supersede all other documentation

## Performance Standards

### iOS App Performance Budgets

**Scroll Performance**
- 60fps sustained scrolling in all feeds and lists
- No dropped frames during card animations
- Smooth haptic feedback synchronized with visual transitions

**Interaction Latency**
- Tap response: <200ms from touch to visual feedback
- Emotional check-in selection: <100ms to show selection state
- Share sheet presentation: <300ms from tap to sheet appearance
- Card generation: <2000ms from emotional selection to rendered card

**Memory & Storage**
- App launch memory footprint: <150MB
- Per-session memory growth: <50MB
- Cached content: <100MB storage for offline support

### Backend Performance Budgets

**Firebase Functions Latency**
- p50: <50ms for content retrieval
- p95: <100ms for all endpoints
- p99: <200ms maximum
- AI content generation: <2000ms for insight card creation

**Database Operations**
- Read operations: <20ms p95
- Write operations: <50ms p95
- Batch operations: <100ms p95

**Monitoring & Alerts**
- Performance regressions beyond budgets trigger alerts
- Daily performance reports for all critical paths
- Regression blockers halt deployments until resolved

## AI Content Quality Standards

### Philosophical Source Integrity

**Source Material Requirements**
- All insights MUST be traceable to specific passages in public domain philosophy
- Initial scope: Stoic texts (Marcus Aurelius, Epictetus, Seneca) and Platonic dialogues
- Source attribution required in internal documentation (not user-facing)
- Reinterpretations MUST preserve philosophical intent and core meaning

### Tone & Emotional Register

**Tone Presets (Strict Definitions)**
- **Gentle clarity**: Soft, non-judgmental reframing that reduces emotional intensity.
  Example: "This feeling won't define you" vs. "You are not your emotions"
- **Grounded realism**: Plainspoken, emotionally neutral interpretation.
  Example: "This is temporary" vs. "Even this will pass"

**Quality Gates**
- Insights MUST be comprehensible without philosophical training
- Language MUST be accessible to Gen Z/Gen Alpha users
- Tone MUST support grounding, never increase anxiety or judgment
- No generic AI platitudes or clichés

### Content Validation Process

**Pre-Production Validation**
1. Verify traceability to source material
2. Validate tone alignment with preset definition
3. Test emotional impact with target demographic
4. Review for accessibility and comprehension

**Production Monitoring**
- Track share rates by insight to identify resonant content
- Monitor tone drift through user feedback
- A/B test tone variations to validate emotional grounding
- Quarterly review of AI output quality against source material

**Rejection Criteria**
- Generic motivational quotes without philosophical grounding
- Content that increases anxiety or emotional intensity
- Insights that misrepresent source material intent
- Language inaccessible to non-academic audiences

## Development Workflow

### Feature Development Process

1. **Specify**: Use `/speckit.specify` to create feature spec with user stories
2. **Plan**: Use `/speckit.plan` for technical design and implementation strategy
3. **Tasks**: Use `/speckit.tasks` to generate prioritized, independently testable tasks
4. **Implement**: Use `/speckit.implement` to execute tasks following TDD workflow
5. **Validate**: Measure against success criteria before advancing to next priority

### TDD Workflow (Per Task)

1. Write contract/integration tests that capture requirements
2. Review tests with stakeholder/pair programmer
3. Run tests and verify they fail (RED state)
4. Implement minimum code to make tests pass (GREEN state)
5. Refactor while maintaining green tests (REFACTOR state)
6. Commit only when tests pass

### Branching & Version Control

- Feature branches: `###-feature-name` format (### = issue number)
- Commits: Concise, imperative mood (e.g., "Add emotional check-in UI")
- PR titles: Match feature name and link to spec document
- Squash commits before merging to main

### Code Review Requirements

**Constitution Compliance Checklist**
- [ ] Platform-native patterns used (Principle I)
- [ ] Tests written first and verified failing (Principle II)
- [ ] AI content validated against source material (Principle III)
- [ ] Success metrics defined and measurable (Principle IV)
- [ ] Performance budgets met (Principle V)

**Review Process**
- All PRs require approval from one other developer
- P1 features require product validation before merge
- Constitution violations require explicit justification in PR description

### Quality Gates (Pre-Deployment)

**Automated Checks**
- All tests passing (contract, integration, unit)
- Linting passing with zero warnings
- Performance budgets verified via automated testing
- TypeScript strict mode compliance

**Manual Validation**
- iOS app runs smoothly on physical device (not just simulator)
- Share flow tested end-to-end with actual sharing
- AI content reviewed for tone and source accuracy
- Offline behavior tested with airplane mode

## Governance

This constitution supersedes all other practices and guides all engineering decisions.
Principles marked NON-NEGOTIABLE are absolute requirements that MUST be met. When
principles conflict, Platform-Native Excellence (Principle I) takes precedence as the
foundation of user experience.

### Amendment Process

1. Propose change with rationale in GitHub issue
2. Demonstrate alignment with product mission (PRD Section 8: Product Principles)
3. Update constitution with version bump per semantic versioning
4. Update all dependent templates and docs (tracked in Sync Impact Report)
5. Announce change to team with migration guidance if breaking

### Versioning Policy

- **MAJOR**: Principle removal, redefinition, or precedence change that invalidates features
- **MINOR**: New principle added or existing principle materially expanded
- **PATCH**: Clarifications, wording improvements, non-semantic refinements

### Compliance Review

All PRs MUST verify alignment with constitution principles. Violations require explicit
justification in the Complexity Tracking section of plan.md. Repeated violations without
justification indicate the constitution needs updating, not that principles should be
ignored.

### Constitution Evolution

The constitution is a living document that evolves with the product. When real-world
constraints conflict with principles, we update principles rather than ignore them. This
preserves the constitution's authority while allowing adaptation.

**Version**: 1.0.0 | **Ratified**: 2025-12-19 | **Last Amended**: 2025-12-19
