# src/components/ui

React Native Reusables components, copied by `npx @react-native-reusables/cli@0.7.1 add --styling-library nativewind`
on 2026-10-28 (the CLI reports itself as 1.0.0): alert-dialog, button, dialog, dropdown-menu, icon, input, label,
native-only-animated-view, radio-group, separator, switch, text. They are this project's source now; when taking a
newer version from the registry, re-apply the changes below (each is marked `Sokuji:` in the file).

## Local changes

The touch baseline is 48×48 logical units and text follows the system size (design scope §1: Apple's and
Android's touch-size guidance), so fixed heights become minimums with padding.

- `button.tsx`: every size has a minimum height (`min-h-12`, icon `min-h-12 min-w-12`, lg `min-h-14`) and vertical
  padding instead of a fixed `h-*`; the text is `text-base` (was `text-sm`) and centred. `ButtonProps` drops the
  registry's `React.RefAttributes<typeof Pressable>`, which typed the ref as the component: React Native 0.88's
  Pressable props carry the right ref already.
- `input.tsx`: `min-h-12 py-2` instead of `h-10 sm:h-9`, and no `leading-5`, which clipped large text.
- `switch.tsx`: 28×48 with a 24-unit thumb (was the web's 18×32).
- `dropdown-menu.tsx`: items are `min-h-12` with `text-base`; the menu is at least `12rem` wide.

Project composites built on these (rows, headers, option lists, the language picker) live in `src/components/`.
