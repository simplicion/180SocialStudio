# 180workspace Platform Workspace Rules

The following design system and UI architecture rules MUST be followed when generating or modifying code in this workspace:

- Read `.agents/rules/security-and-secrets.md` for strict, zero-tolerance secrets management (MANDATORY: NO credentials, connection strings, private keys, or API tokens may ever be hardcoded).
- Read `.agents/rules/ui-architecture.md` for rules on component creation, shared `@workspace/ui` packages, and Shadcn UI best practices.
- Read `.agents/rules/ux-best-practices.md` for rules on mobile-first responsiveness, accessibility, and error states.
- Read `.agents/rules/design-system.md` for rules on Tailwind styling, glassmorphism, and dark mode conventions.
- Read `.agents/rules/180workspace-vision.md` for the core Work Graph architecture, privacy model, and app separation guidelines (MANDATORY FOR ALL ARCHITECTURAL DECISIONS).

## App Subscription & Feature Locking

Any new cross-app section or global dashboard widget MUST first verify the subscription model via `useSubscription()` hook.
- If the app is missing from `enabledApps`, you MUST NOT fetch the data for it.
- Render the generic `FeatureLock` from `@workspace/ui` to indicate the required app.
