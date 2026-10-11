# Design System

**Status:** Enforced
**Applies to:** All frontend applications (`apps/*`).

## 1. Aesthetic Identity (SaaS Pro Max & Obsidian Dark Mode)
- **True Black & Grey Mix Dark Mode:** In dark mode, all applications MUST use a pure black base (`bg-black` / `#000000` / `zinc-950`) combined with elevated blackish-grey surfaces (`bg-zinc-900`, `#101012`, `#161619`) and subtle neutral dark grey borders (`border-zinc-800`, `border-white/10`). Avoid blue/navy-tinted dark backgrounds (`slate-900`, `#0f172a`).
- **Glassmorphism:** We heavily utilize frosted glass effects. The standard class for a glass panel is `backdrop-blur-md bg-white/60 dark:bg-black/70 border border-white/20 dark:border-white/10`.
- **Dark Mode Equivalents:** Every hardcoded color MUST have a dark mode equivalent (e.g., `text-gray-900 dark:text-zinc-100`, `bg-white dark:bg-zinc-900`).

## 2. Typography
- **Headings:** Always use tracking-tight and font-bold for primary headings (e.g., `text-4xl md:text-6xl font-bold tracking-tight`).
- **Body Text:** Use `text-gray-600 dark:text-gray-400` for body text to ensure sufficient contrast without being overly harsh.

## 3. Shadows & Elevation
- **Light Mode Shadows:** `shadow-lg shadow-black/5`
- **Dark Mode Shadows:** `dark:shadow-[0_0_40px_rgba(255,255,255,0.05)]`
- Avoid arbitrary, messy shadow values like `shadow-[0_30px_100px_-20px_rgba(0,0,0,0.1)]`. Stick to the Tailwind defaults or the strict rules defined in `globals.css`.

## 4. Spacing & Grids
- Use CSS Grid (`grid grid-cols-1 md:grid-cols-3 gap-8`) for feature cards and layouts rather than complex Flexbox wrapping when aligning items in rows/columns.
- Maintain consistent padding inside cards: usually `p-6` or `p-8`.

