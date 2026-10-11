# UX Best Practices

**Status:** Enforced
**Applies to:** All frontend applications (`apps/*`).

## 1. Mobile-First Responsiveness
- **Navigation:** Mobile users must ALWAYS have a way to navigate. If hiding a navbar with `hidden md:flex`, you MUST provide a mobile equivalent (e.g., Hamburger Menu, Bottom Sheet, or Drawer).
- **Touch Targets:** All interactive elements (buttons, links) must have a minimum touch target size of 44x44px for mobile devices.
- **Scaling:** Use Tailwind prefixes (`sm:`, `md:`, `lg:`) to scale typography and padding. Do not use desktop-sized margins on mobile screens (e.g., avoid `p-12` on mobile; use `p-4 md:p-12`).

## 2. Error States & Accessibility
- **Error Recovery:** Never show a dead-end error page. Always provide at least two recovery paths (e.g., "Return to Dashboard" and "Help Center").
- **Screen Readers:** All error and warning states must use `role="alert"` and `aria-live="assertive"` or `"polite"` so screen readers can announce them immediately.
- **Empty States:** When a list is empty, show a beautifully designed empty state with an actionable button to create the first item.

## 3. UI/UX Pro Max Guidelines
- **Visual Hierarchy:** Use varying font weights and opacities (e.g., `text-gray-500` for secondary text, `font-bold` for primary) rather than just font sizes to establish hierarchy.
- **Micro-interactions:** Add `transition-all duration-300` to buttons and cards for smooth hover effects. Hover states should provide visual feedback (e.g., `hover:bg-gray-100 dark:hover:bg-gray-800`).

