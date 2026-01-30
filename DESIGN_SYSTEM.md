# 3rdSpace Design System

A premium, modern design system inspired by industry-leading SaaS products (Linear, Stripe, Notion, Vercel).

## Brand Identity

- **Primary Color**: Forest Green (#10B981) - `forest-500`
- **Secondary**: Slate/Charcoal for text - `slate-*`
- **Accent**: Warm Amber for highlights - `amber-400/500`
- **Typeface**: Inter (system font)
- **Personality**: Professional yet approachable, Bay Area tech aesthetic

## Color Palette

### Primary (Forest Green)
```css
forest-50:  #f0fdf4
forest-100: #dcfce7
forest-500: #10B981  /* Primary brand color */
forest-600: #059669
forest-700: #047857
```

### Slate (Text & Backgrounds)
```css
slate-50:  #f8fafc
slate-100: #f1f5f9
slate-200: #e2e8f0
slate-600: #475569
slate-700: #334155
slate-900: #0f172a
```

### Accent Colors
```css
amber-400: #fbbf24
amber-500: #f59e0b
red-500:   #ef4444
blue-500:  #3b82f6
```

## Typography

### Hierarchy
- **Heading 1**: `text-4xl` (36px), `font-bold`, `tracking-tight`
- **Heading 2**: `text-2xl` (24px), `font-semibold`
- **Heading 3**: `text-lg` (18px), `font-semibold`
- **Body**: `text-base` (16px), `font-normal`, `leading-relaxed`
- **Small**: `text-sm` (14px) for captions, hints
- **Micro**: `text-xs` (12px) for labels, metadata

### Font Family
```css
font-family: Inter, system-ui, sans-serif
```

## Spacing Scale

Based on 4px unit system:
- `0.5` = 2px
- `1` = 4px
- `2` = 8px
- `3` = 12px
- `4` = 16px
- `6` = 24px
- `8` = 32px
- `12` = 48px
- `16` = 64px

## Border Radius

- **Cards**: `rounded-2xl` (12px)
- **Buttons**: `rounded-xl` (12px)
- **Inputs**: `rounded-xl` (12px)
- **Small elements**: `rounded-lg` (8px)

## Shadows

```css
/* Subtle, layered shadows */
shadow-sm:  0 1px 2px rgba(0, 0, 0, 0.05)
shadow-md:  0 4px 6px rgba(0, 0, 0, 0.07)
shadow-lg:  0 10px 15px rgba(0, 0, 0, 0.1)

/* Brand-colored shadows */
shadow-forest-lg: 0 10px 15px rgba(16, 185, 129, 0.2)
```

## Component Styling

### Buttons

**Primary Button:**
```tsx
<Button variant="default">
  Continue
</Button>
```
- Background: `forest-500`
- Hover: `forest-600` with scale effect
- Shadow: `shadow-lg shadow-forest-500/20`
- Min height: `44px` (touch target)

**Outline Button:**
```tsx
<Button variant="outline">
  Cancel
</Button>
```
- Border: `border-2 border-slate-200`
- Hover: `border-slate-300`, `bg-slate-50`

### Inputs

```tsx
<Input
  type="text"
  placeholder="Enter text..."
/>
```
- Border: `border-2 border-slate-200`
- Focus: `border-forest-500`, `ring-4 ring-forest-500/10`
- Hover: `border-slate-300`
- Padding: `px-4 py-3`
- Border radius: `rounded-xl`

### Cards

```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Description</CardDescription>
  </CardHeader>
  <CardContent>
    Content here
  </CardContent>
</Card>
```
- Border: `border border-slate-200`
- Border radius: `rounded-2xl`
- Shadow: `shadow-sm`
- Padding: `p-6`

## Focus States

All interactive elements should have visible focus rings:

```css
focus-visible:outline-none
focus-visible:ring-4
focus-visible:ring-forest-500/10
```

## Transitions

Standard transition timing:
- **Fast**: `duration-200` (200ms)
- **Medium**: `duration-300` (300ms)
- **Slow**: `duration-500` (500ms)

Easing: `ease-out` for most animations

## Micro-interactions

### Hover Effects
```css
hover:scale-105  /* Buttons, cards */
hover:scale-[1.02]  /* Large cards */
active:scale-95  /* Press feedback */
```

### Animations
```css
animate-slide-up  /* Toast notifications */
animate-fade-in   /* Content appearance */
animate-pulse     /* Loading indicators */
```

## Accessibility

### Touch Targets
- Minimum: `44x44px` (`min-h-[44px] min-w-[44px]`)
- All buttons meet this requirement

### Color Contrast
- Text on white: `slate-900` (WCAG AA compliant)
- Text on colored: White or `slate-50`
- Minimum contrast ratio: 4.5:1

### Focus Indicators
- All interactive elements have visible focus rings
- Use `ring-4 ring-forest-500/10` for focus states

## Usage Examples

### Form Input
```tsx
<div className="space-y-2">
  <label className="block text-sm font-semibold text-slate-700">
    Event Name
    <span className="text-red-500 ml-1">*</span>
  </label>
  <Input
    type="text"
    placeholder="Enter event name..."
  />
  <p className="text-xs text-slate-500">
    Helpful hint text here
  </p>
</div>
```

### Card with Hover
```tsx
<Card className="hover:shadow-lg transition-shadow cursor-pointer">
  <CardContent>
    Content
  </CardContent>
</Card>
```

### Empty State
```tsx
<div className="text-center py-16">
  <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl">
    <Icon className="w-10 h-10 text-slate-400" />
  </div>
  <h3 className="text-xl font-bold text-slate-900 mb-2">
    No items found
  </h3>
  <p className="text-slate-600 mb-6">
    Description text here
  </p>
  <Button>Action</Button>
</div>
```

## Mobile Responsiveness

### Breakpoints
- **Mobile**: `< 640px` (sm)
- **Tablet**: `640px - 1024px` (md)
- **Desktop**: `> 1024px` (lg)

### Mobile Considerations
- Single column layouts
- Larger touch targets (44px minimum)
- Collapsible sidebars/drawers
- Stacked form fields

## Implementation Checklist

When applying this design system:

- [ ] Use `slate-*` colors instead of `gray-*` for text
- [ ] Use `forest-500` as primary brand color
- [ ] Apply `rounded-xl` or `rounded-2xl` to all components
- [ ] Add `shadow-sm` or `shadow-lg` to cards
- [ ] Ensure all buttons have `min-h-[44px]`
- [ ] Add focus rings to all inputs
- [ ] Use consistent spacing (4px grid)
- [ ] Apply hover effects with transitions
- [ ] Use proper typography hierarchy
- [ ] Test on mobile devices
