# Task 6: Documentation Finalization

## Description

After all schema changes are implemented, update the architecture documentation to reflect the final state and remove any obsolete files.

## Actions

### 6.1 Verify neo4j-schema.md consistency

**File:** `docs/architecture/neo4j-schema.md`

- Confirm it already reflects the final schema (Feature, Actor, BusinessRule, Operation, Entity nodes present; Flow/Step absent)
- Confirm all relationship types match what domain-analyzer.md and grasp-requirements/SKILL.md emit
- Check that `IMPLEMENTED_BY` status values are documented correctly
- Check that `Decision.status` includes `"draft"`

### 6.2 Check for obsolete documentation files

Search for any files that reference the old schema:
```bash
grep -r "flow\|step\|contains_flow\|flow_step\|cross_domain" docs/ --include="*.md" -l
```

- `docs/architecture/approaches/feature-development-graph-design.md` — this was a draft exploration document. If it exists, archive it or note that it's superseded by neo4j-schema.md and the schema-evolution-plan.md final decisions section.

### 6.3 Update CLAUDE.md schema reference if needed

**File:** `CLAUDE.md`

- Ensure the "Knowledge Graph" section (line 18-20) references the correct node types
- Ensure the "Conventions" section accurately describes the current graph structure

### 6.4 Verify graph documentation internal consistency

`docs/graph/` files were created as part of Task 3 and validated/corrected during that task. As a final check, confirm that after Task 5 schema changes are applied, the `docs/graph/` files remain consistent with each other and with `docs/architecture/neo4j-schema.md`:
- No contradictory node type names or relationship types
- No stale references to removed nodes (`Flow`, `Step`) or removed relationships (`CONTAINS_FLOW`, `FLOW_STEP`, `CROSS_DOMAIN`)
- Seeding rules in `docs/graph/seeding-rules.md` align with what domain-analyzer actually produces after Task 5 updates
- If any inconsistencies were introduced by Task 5 changes, fix them here

### 6.5 Final review checklist

- [ ] neo4j-schema.md matches actual agent/skill output after Task 5
- [ ] No obsolete schema files remain without clear deprecation notice
- [ ] CLAUDE.md schema description is accurate
- [ ] docs/graph/ files exist and are validated (Task 3 completed)
- [ ] docs/graph/architecture.md is a good summary (complementary to neo4j-schema.md, not a duplicate)
- [ ] All docs/graph/ files reference neo4j-schema.md as canonical source
- [ ] docs/graph/ content is still consistent after Task 5 schema changes

## Completion

When complete:
- All documentation consistent and accurate
- Obsolete files archived or clearly marked as superseded
- Commit with message: `docs: finalize documentation after schema updates`
- Push to remote