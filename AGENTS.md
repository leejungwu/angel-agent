# ANGEL AGENT - AGENTS.md Template

# Purpose

This repository is ANGEL AGENT, an internal ecommerce AI operating system.

Work carefully. Preserve working behavior. Prefer small, verifiable changes over large speculative rewrites.

The repository may be edited by Codex, Claude Code, or other coding agents. These rules exist so different agents behave consistently.


## 1. Read before editing

Before changing non-trivial code:

1. Inspect the relevant files.
2. Trace the current data flow.
3. Identify affected database tables, APIs, environment variables, and external services.
4. Check nearby code for existing patterns before inventing a new one.
5. State the intended change and verification method briefly.
6. Modify only the minimum scope required.

Do not rewrite working code merely for style.

When working with Next.js, follow the Next.js-specific instructions already present in this file and consult the installed Next.js documentation when necessary.


## 2. Plan before implementation

For non-trivial features, refactors, migrations, or bugs, define:

- current behavior
- desired behavior
- files likely to change
- important constraints
- likely failure modes
- verification method

Small, obvious fixes may proceed directly.

Do not start large implementation work while the desired behavior is still ambiguous.


## 3. Test-driven development

Prefer test-first development whenever the behavior can be tested deterministically.

Use this cycle:

1. Write or extend a test that describes the desired behavior.
2. Run it and confirm it fails for the expected reason.
3. Implement the smallest correct change.
4. Re-run the test and confirm it passes.
5. Refactor only when necessary.
6. Re-run all relevant tests after refactoring.

TDD is strongly preferred for:

- parsers
- schemas
- validators
- quality checks
- calculations
- transformations
- prompt assembly logic
- provider adapters
- data mapping
- deterministic business rules

Do not create meaningless tests only to claim TDD compliance.

If strict test-first work is impractical, create the smallest reproducible verification before changing the implementation.


## 4. Bug fixing discipline

When fixing a bug:

1. Reproduce the bug.
2. Capture the exact failing behavior.
3. Identify the likely root cause.
4. Add a regression test or reproducible test script when practical.
5. Change one relevant thing at a time.
6. Re-run the same reproduction.
7. Verify surrounding behavior was not broken.

Do not perform speculative rewrites when the root cause is unknown.


## 5. Browser automation

For Playwright, Naver Blog, and other external web UIs:

1. Reproduce the problem before changing automation code.
2. Inspect the actual DOM/editor behavior.
3. Prefer stable locators and existing selectors.
4. Make the smallest targeted change.
5. Re-run the exact scenario.
6. Perform real end-to-end verification for behavior that cannot be proven by unit tests.

TypeScript, lint, or build success alone does not prove browser automation works.

For Naver Blog automation:

- title insertion must be verified
- body formatting and line breaks must be verified
- image ordering and placement must be verified
- multiple-image insertion must be tested at realistic volume
- browser login/session reuse must be preserved
- stop before the final publish/reservation confirmation unless explicitly instructed otherwise


## 6. External side effects

Do not perform irreversible or externally visible actions unless explicitly requested.

Examples:

- final Naver publishing
- final reservation publishing
- sending messages
- changing live advertising campaigns
- deleting production data
- destructive database migrations
- rotating or exposing credentials
- force pushing Git history

Prefer preparing the action and stopping before the irreversible confirmation step.


## 7. AI provider architecture

Shared AI transport belongs in:

`lib/ai/provider.ts`

Feature-specific modules should own:

- prompts
- schemas
- defaults
- validation
- domain rules
- feature-specific result handling

Do not duplicate OpenAI / Anthropic / xAI transport logic in individual features unless there is a concrete technical reason.

Current shared providers may include:

- OpenAI
- Anthropic / Claude
- xAI / Grok

Feature code should use the shared provider layer where practical.


## 8. Prompt architecture

Keep durable prompt responsibilities separated.

For Blog generation:

- fixed rules
- reference writing guidance
- per-task instructions
- product facts
- structured output schema

For KIN generation:

- fixed KIN rules
- common style instructions
- selected preset instructions
- per-question instructions
- product/VOC context
- structured output schema

Do not mix temporary task instructions into permanent system rules without a reason.

Do not fabricate:

- personal experience
- customer reviews
- product specifications
- efficacy claims
- medical claims
- unsupported performance claims


## 9. Database and migrations

Before changing Supabase/Postgres behavior:

1. Inspect the current schema and migrations.
2. Determine whether the change is additive, destructive, or data-transforming.
3. Avoid re-running old migrations blindly.
4. Preserve existing data unless explicitly instructed otherwise.
5. Keep RLS and credential exposure in mind.

Do not place service-role secrets or private API keys in client-side code.

Never add secrets to Git.


## 10. Git safety

Before Git operations, inspect:

`git status`

Do not:

- force push unless explicitly requested
- discard uncommitted user changes
- use destructive reset commands without explicit approval
- resolve ambiguous merge conflicts by guessing
- unintentionally modify `main`
- overwrite another task's work

If a merge conflict contains unclear intent, stop and report the conflicting files and relevant differences.


## 11. Branch discipline

Use feature branches for unfinished work.

Typical flow:

feature branch
→ implementation
→ tests
→ lint/build
→ review diff
→ commit
→ push
→ merge to main when the feature is actually ready

Delete obsolete feature branches after successful integration when appropriate.

Before continuing an older feature branch, fetch latest remote changes and check whether `main` must be merged first.


## 12. Parallel task isolation

When multiple coding agents may modify files or Git state concurrently, isolate them.

Preferred rule:

- one independent task = one dedicated Git worktree

Do not run multiple implementation agents against the same working tree at the same time.

A shared checkout means:

- same active branch
- same working files
- same index
- same Git state

Concurrent implementation in one checkout can overwrite or corrupt another task's work.

If parallel work is needed:

1. Fetch the latest remote state.
2. Create each task worktree from an explicit commit or remote branch.
3. Keep each task isolated.
4. Merge only after each task is independently verified.

Do not switch the shared working tree to another branch while another task is using it.


## 13. Clean task starting point

Before starting a substantial task:

- confirm the current branch
- confirm the working tree is clean or understand every local change
- fetch remote updates when needed
- use an explicit base branch or commit

Do not silently base new work on stale local state.

If the checkout contains unrelated uncommitted work, leave it untouched.


## 14. Dependency changes

Do not upgrade dependencies unless required by the task.

When dependencies change:

1. explain why
2. update the lockfile consistently
3. run install
4. run lint
5. run build
6. run relevant tests

Do not run destructive dependency fixes such as aggressive forced audit upgrades without explicit approval.


## 15. Verification before completion

Before reporting a coding task as complete, run the relevant checks.

Normal baseline:

`npm.cmd run lint`

`npm.cmd run build`

When relevant, also run feature-specific tests, for example:

`npm.cmd run test:ai-providers`

`npm.cmd run test:naver-blog`

Also inspect:

`git diff --check`

`git status`

When useful, inspect the final diff before committing.

Do not claim success when a required check was skipped or failed.

State explicitly what was tested and what was not tested.


## 16. Review the final diff

Before completion:

- inspect changed files
- remove accidental edits
- remove debug-only code
- check for secrets
- check for unrelated formatting churn
- confirm expected files only
- confirm intended behavior is preserved

A clean build is not a substitute for reviewing the diff.


## 17. Delivery status reporting

Always report delivery state as separate facts.

Include only the categories relevant to the task.

Example:

- **Implementation:** complete / partial / blocked
- **Tests:** exact tests run and whether they passed
- **Lint:** passed / failed / not run
- **Build:** passed / failed / not run
- **Git status:** clean / uncommitted changes
- **Commit:** SHA and message, or not created
- **Push:** pushed / not pushed
- **Pull request:** not created / open / merged / closed
- **Git integration:** exact target branch and whether merged
- **Deployment:** not performed / target environment / verification status
- **Known limitations:** anything still unverified

Do not blur together:

- code completion
- Git merge status
- deployment status
- production verification


## 18. Deployment safety

If deployment workflows are added later, deployments must use explicit, reproducible source state.

Recommended principle:

- deploy only from a clean checkout
- deploy an explicitly fetched remote commit
- verify the commit before build
- verify the same commit before activation
- never deploy arbitrary dirty local state
- never print credentials

If a dedicated staging branch is introduced, document the exact approved deployment command and branch policy here before agents perform staging deployments.


## 19. Project-specific verification

For Blog v1, completion requires realistic use, not only code checks.

Important verification includes:

- real product data
- realistic generated article
- approximately 1,500-character article target when requested
- realistic image count when requested
- inline text/image ordering
- no broken line spacing
- successful Naver editor insertion
- stop before final human publish action

For KIN, completion should include:

- provider generation
- prompt preset behavior
- product/VOC context
- quality checks
- realistic answer review
- no fabricated experience or unsupported claims


## 20. Preserve useful project knowledge

After solving a difficult, recurring, or non-obvious problem, preserve verified knowledge in the appropriate project documentation.

Good examples:

- Naver editor DOM behavior
- Playwright selector quirks
- provider API differences
- Supabase schema assumptions
- recurring failure causes
- project-specific workflows
- verified prompt behavior

Do not document guesses, temporary noise, or unverified theories.

The goal is to avoid rediscovering the same problem repeatedly.


## 21. Keep the system simple

Prefer:

- existing abstractions
- small functions
- clear data flow
- explicit schemas
- reusable shared provider logic
- predictable status transitions
- human approval for risky actions

Avoid:

- unnecessary frameworks
- premature distributed architecture
- duplicated provider clients
- speculative abstractions
- large rewrites without measurable benefit


## 22. Completion standard

A task is complete only when:

1. the requested behavior exists
2. relevant tests or reproducible verification pass
3. lint/build pass when applicable
4. the final diff is reviewed
5. no unrelated changes remain
6. delivery status is reported accurately

"Code was written" is not the same as "task is complete."


## Worktree lifecycle

Use a dedicated Git worktree when multiple coding agents or independent
implementation tasks may run concurrently.

Each independent concurrent task must have:

- its own worktree
- its own branch
- an explicit base commit or remote branch
- a recorded worktree path and branch name

Do not reuse the same worktree or feature branch for unrelated concurrent tasks.

Base a new task on another feature branch only when the new task intentionally
depends on that feature. Otherwise, use the latest appropriate `origin/main`
commit as the base.

Existing worktrees do not automatically receive later `main` updates.
Before merging completed work:

1. fetch the latest remote state
2. compare the task branch with `origin/main`
3. merge or rebase `origin/main` when appropriate
4. resolve conflicts inside that task's worktree
5. run verification from that exact worktree

Do not use files, dependencies, builds, or test results from sibling worktrees
as evidence that the current task passes.


## Worktree cleanup

When a task that used a dedicated worktree is fully integrated:

1. confirm its changes are merged into the intended target branch
2. confirm no process is still using the worktree
3. confirm there are no uncommitted or untracked files that must be preserved
4. confirm the absolute path is the worktree created for that task
5. remove it with `git worktree remove` without `--force`
6. run `git worktree prune`

Never remove:

- the primary shared checkout
- an unrelated worktree
- a worktree containing unsaved work
- a worktree still awaiting review or integration

If cleanup is not safe, preserve the worktree and report:

- its exact path
- its branch
- why it was retained


## Task branch naming

For isolated agent work, use short, meaningful branch names.

Examples:

`codex/blog-inline-images`
`codex/kin-quality-check`
`codex/voc-import-fix`

Add a unique suffix only when multiple concurrent tasks could collide.

Do not create unnecessarily complex branch names for normal sequential work.