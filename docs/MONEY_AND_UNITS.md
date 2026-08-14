# Money and percentage units

3rdPlace uses integer cents as the canonical money representation for new schema and for planner, approval, and payment logic. A small set of reviewed legacy catalog columns remains dollar-denominated for compatibility. Percentages use percentage points. Unit conversion belongs at an explicit system boundary, never inside ranking, approval, or payment business logic.

## Canonical representations

| Value | Canonical representation | Example |
|---|---|---|
| Persisted money | Integer cents | `$95.50` is `9550` |
| Planner/payment money | Integer cents | `$1,500` is `150000` |
| UI money input | Dollars | A user types `95.50` |
| Margin/percent | Percentage points | `20` means 20%, not `0.2` |
| Ratio used in an intermediate calculation | 0-1 ratio, converted immediately at its output boundary | `0.2` becomes `20` |

New database columns must use a `_cents` suffix. Legacy columns such as `vendor_profiles.base_rate`, `vendor_profiles.hourly_rate`, and `vendor_profiles.per_person_rate` retain their names for schema compatibility, but their canonical application meaning is integer cents.

### Reviewed legacy-major-unit exceptions

The following existing catalog columns are intentionally still stored in dollar major units:

- `vendor_packages.price`
- `vendor_offerings.base_price`

Their package/service forms and discovery API expose dollars. When a value crosses from either column into planner, ranking, approval, booking, or payment logic, an adapter must convert it to integer cents. Conversely, canonical `vendor_profiles.base_rate` and `vendor_profiles.hourly_rate` cents must be converted to dollars before being compared with these package/offering prices in the legacy discovery UI. These exceptions are compatibility contracts, not patterns for new columns.

The typed boundary aliases in `lib/money.ts` make the touched domains explicit:

- `VendorBaseRateCents`
- `VenueBookingCostCents`
- `VenueNightlyRateCents`
- `MarginPercent`

## UI boundaries

Use the shared helpers in `lib/money.ts`:

```ts
const persistedCents = parseDollarsToCents(95.50) // 9550
const formDollars = formatCentsToDollars(persistedCents) // 95.5
```

`parseDollarsToCents` rounds once to the nearest cent and returns `null` for an absent or invalid optional input. `formatCentsToDollars` returns a numeric dollar value suitable for an HTML form control. Use `Intl.NumberFormat` when rendering currency copy.

Do not divide or multiply by 100 in components, route handlers, rankers, approval logic, or payment executors. Convert once when data enters or leaves a dollar-denominated UI or external API.

## Venue nightly-rate reconciliation

Venue signup now writes `price_per_night_cents` once and marks that field authoritative in `auto_approve_conditions.nightly_rate_cents_authoritative`. The historical signup defect wrote only `hourly_rate_cents`, `daily_rate_cents`, and `price_per_night_cents`; it did not write legacy dollar aliases. On an existing-row save, hourly or daily cents are cleared only when they exactly equal the row's prior nightly cents—the recognizable historical triple-write. Differing legacy rates are preserved because they may be intentional, but readers honor the newly confirmed nightly value. Untouched historical rows retain legacy precedence until an operator or venue explicitly confirms their terms; there is no destructive batch guess.

## Percentages and margins

Persist and pass percentages as percentage points:

- `deposit_percentage: 25` means 25%.
- `profit_margin: 18.5` means 18.5%.
- A calculation that produces `profit / revenue` must call `marginRatioToPercent` before returning the value to a workspace, API, or persisted record.

Negative profit margins remain negative percentage points. Do not clamp a loss to zero.

## Legacy vendor rate repair

`scripts/admin/repair-vendor-base-rate-units.ts` audits legacy `vendor_profiles.base_rate` values. It is dry-run by default and never connects with a browser/user token.

```bash
npm run repair:vendor-base-rate
npm run repair:vendor-base-rate -- --apply
```

The script uses the service role for its read-only audit and for an explicitly requested apply. Apply mode calls the service-role-only, `SECURITY INVOKER` `repair_vendor_base_rate_atomic` RPC, which locks the row and commits the update plus `admin_audit_log` record as one transaction. An audit failure therefore rolls back the rate change. Flat, package, hourly, or hybrid rates from `$50` through `$499` that were persisted as values from `50` through `499` are deterministic legacy-dollar candidates and can be converted to cents. Values below `50`, per-person rates, and rows with a missing or unknown pricing model are ambiguous and are flagged for administrator review without changing `vendor_profiles`.

Never run `--apply` against a hosted environment until the dry-run output has been reviewed and the target environment has been explicitly confirmed.

## Review checklist

- Input labels state dollars or percent.
- Dollar inputs accept cent precision (`step="0.01"`).
- Persisted money is a finite, non-negative integer.
- Persisted field/variable names use `_cents`/`Cents` where the schema permits it.
- A `$95.50` input round-trips as `9550` cents and displays as `$95.50`.
- Margin threshold comparisons use percentage points on both sides.
