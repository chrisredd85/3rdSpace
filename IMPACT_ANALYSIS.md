# Comprehensive Impact Analysis: Proposed Changes

## Executive Summary

This document analyzes three proposed changes to the 3rdSpace codebase:
1. **CHANGE 1**: Delete `/lib/auth.ts` or remove `'server-only'` import
2. **CHANGE 2**: Drop and recreate RLS policies on `events` table (change from `builder_id` to `organizer_id`)
3. **CHANGE 3**: Add missing columns to `events` table (`budget`, `actual_cost`, `expected_attendance`, `venue_id`)

---

## CHANGE 1: Delete `/lib/auth.ts` or Remove `'server-only'` Import

### Current State
- `lib/auth.ts` is marked as `'server-only'` (will crash if imported in client components)
- Contains both client-side and server-side functions
- **21 files** currently import from `@/lib/auth`

### Files Importing `@/lib/auth`

#### Server Components (✅ Safe to use `@/lib/auth`)
1. **`app/(dashboard)/layout.tsx`**
   - Uses: `getUserType()`
   - **Impact**: Will break if deleted
   - **Replacement**: Use `getUserType()` from API route or inline server-side logic

#### Client Components (❌ Will crash with `'server-only'`)
2. **`app/(dashboard)/venue/calendar/page.tsx`** - `'use client'`
   - Uses: `getCurrentUser()`
   - **Impact**: Currently broken (will crash at runtime)
   - **Replacement**: Use `useUser()` hook from `@/lib/hooks/useUser`

3. **`app/(dashboard)/[userType]/notifications/page.tsx`** - `'use client'`
   - Uses: `getCurrentUser()`
   - **Impact**: Currently broken
   - **Replacement**: Use `useUser()` hook

4. **`app/(dashboard)/builder/event/[eventId]/page.tsx`** - `'use client'`
   - Uses: `getCurrentUser()`
   - **Impact**: Currently broken
   - **Replacement**: Use `useUser()` hook

5. **`app/(dashboard)/builder/analytics/page.tsx`** - `'use client'`
   - Uses: `getCurrentUser()`
   - **Impact**: Currently broken
   - **Replacement**: Use `useUser()` hook

6. **`app/(dashboard)/vendor/calendar/page.tsx`** - `'use client'`
   - Uses: `getCurrentUser()`
   - **Impact**: Currently broken
   - **Replacement**: Use `useUser()` hook

7. **`app/(dashboard)/vendor/pricing/page.tsx`** - `'use client'`
   - Uses: `getCurrentUser()`
   - **Impact**: Currently broken
   - **Replacement**: Use `useUser()` hook

8. **`app/(dashboard)/vendor/bookings/page.tsx`** - `'use client'`
   - Uses: `getCurrentUser()`
   - **Impact**: Currently broken
   - **Replacement**: Use `useUser()` hook

9. **`app/(dashboard)/vendor/services/page.tsx`** - `'use client'`
   - Uses: `getCurrentUser()`
   - **Impact**: Currently broken
   - **Replacement**: Use `useUser()` hook

10. **`app/(dashboard)/venue/listing/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

11. **`app/(dashboard)/venue/requirements/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

12. **`app/(dashboard)/venue/pricing/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

13. **`app/(dashboard)/[userType]/messages/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

14. **`app/(dashboard)/venue/confirmed/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

15. **`app/(dashboard)/venue/requests/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

16. **`app/(dashboard)/builder/vendors/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

17. **`app/(dashboard)/builder/venues/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

18. **`app/(dashboard)/builder/upcoming/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

19. **`app/(dashboard)/builder/events/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

20. **`app/(dashboard)/builder/past/page.tsx`** - `'use client'`
    - Uses: `getCurrentUser()`
    - **Impact**: Currently broken
    - **Replacement**: Use `useUser()` hook

### Functions Used from `lib/auth.ts`

| Function | Usage Count | Used In | Replacement |
|----------|-------------|---------|-------------|
| `getCurrentUser()` | 19 | Client Components | `useUser()` hook |
| `getUserType()` | 1 | Server Component | API route or inline server logic |
| `getCurrentUserServer()` | 0 | Internal only | N/A |
| `getUserProfile()` | 0 | Not used | N/A |
| `getUserProfileClient()` | 0 | Not used | N/A |
| `signUp()` | 0 | Not used (migrated to API) | N/A |
| `signIn()` | 0 | Not used (migrated to API) | N/A |
| `signOut()` | 0 | Not used (migrated to API) | N/A |
| `updateUserProfile()` | 0 | Not used | N/A |

### Alternative Options

#### Option A: Remove `'server-only'` import (NOT RECOMMENDED)
- **Pros**: Quick fix, no code changes needed
- **Cons**: 
  - Breaks server/client boundary protection
  - Allows accidental server code in client bundles
  - Defeats the purpose of the recent refactoring
- **Risk**: High - defeats architectural improvements

#### Option B: Delete `lib/auth.ts` entirely (RECOMMENDED)
- **Pros**: 
  - Clean separation of concerns
  - Forces proper API route usage
  - Aligns with current architecture
- **Cons**: 
  - Requires updating 20 client components
  - Requires updating 1 server component
- **Risk**: Medium - requires systematic refactoring

#### Option C: Split into `lib/auth/client.ts` and `lib/auth/server.ts` (ALTERNATIVE)
- **Pros**: 
  - Maintains some utility functions
  - Clear separation
- **Cons**: 
  - More complex
  - Still need to update imports
- **Risk**: Low - but more work than Option B

### Recommended Approach: Option B (Delete `lib/auth.ts`)

**Step 1**: Fix all client components to use `useUser()` hook
**Step 2**: Update server component to use API route or inline logic
**Step 3**: Delete `lib/auth.ts`

---

## CHANGE 2: Drop and Recreate RLS Policies (builder_id → organizer_id)

### Current State
- Events table uses `builder_id` column
- RLS policies reference `builder_id`
- **35+ files** reference `builder_id` in events context

### Proposed Change
- Change RLS policies to use `organizer_id` instead of `builder_id`
- **CRITICAL ISSUE**: The events table currently has `builder_id`, NOT `organizer_id`!

### Analysis

#### Current Events Table Schema
```typescript
interface Event {
  builder_id: string  // ← Current column name
  // ... other fields
}
```

#### Proposed RLS Policy
```sql
USING (auth.uid() = organizer_id)  // ← References organizer_id
```

### Critical Blocker

**The proposed RLS policies reference `organizer_id`, but the events table has `builder_id`!**

This will cause:
- ❌ All RLS policies to fail (column doesn't exist)
- ❌ All event queries to be blocked
- ❌ Complete application failure

### Required Pre-Change

**You MUST rename the column first:**
```sql
-- Step 1: Rename column
ALTER TABLE events 
RENAME COLUMN builder_id TO organizer_id;

-- Step 2: Update foreign key constraint (if exists)
-- Check for foreign key constraints first
```

### Files Using `builder_id` (Events Context)

#### API Routes (Must Update)
1. `app/api/builder/stats/route.ts` - 4 references
2. `app/api/builder/events/route.ts` - 3 references
3. `app/api/builder/events/[id]/route.ts` - 3 references
4. `app/api/venue/requests/route.ts` - 1 reference
5. `app/api/vendor/bookings/route.ts` - 1 reference
6. `app/api/venue/bookings/[id]/route.ts` - 3 references

#### Components (Must Update)
7. `app/(dashboard)/venue/page.tsx` - 1 reference
8. `app/(dashboard)/vendor/page.tsx` - 1 reference
9. `app/(dashboard)/builder/event/[eventId]/page.tsx` - 1 reference
10. `components/vendor/BookingDetailModal.tsx` - 1 reference
11. `components/venue/BookingDetailModal.tsx` - 1 reference

#### Type Definitions (Must Update)
12. `lib/types/database.ts` - Event interface definition

#### Test Files (Must Update)
13. `lib/test-utils.tsx` - 1 reference

#### Documentation (Should Update)
14. `PROJECT_SUMMARY.md` - Documentation reference
15. `API_ROUTES.md` - Documentation reference

### RLS Policy Analysis

#### Current Policy (Inferred)
```sql
-- Current (likely)
CREATE POLICY "Users can read own events"
  ON events FOR SELECT
  USING (auth.uid() = builder_id);
```

#### Proposed Policy
```sql
-- Proposed
CREATE POLICY "Enable read for users based on organizer_id"
  ON events FOR SELECT
  USING (auth.uid() = organizer_id);
```

### Security Guarantees

**Current**: Users can only access events where `auth.uid() = builder_id`
**Proposed**: Users can only access events where `auth.uid() = organizer_id`

**Security Impact**: ✅ Same security guarantees (assuming column rename happens first)

### Infinite Recursion Analysis

**Question**: What's causing infinite recursion in current policy?

**Possible Causes**:
1. Policy references a function that queries the same table
2. Policy uses a view that queries events table
3. Policy has circular dependency with another policy
4. Policy uses `SELECT` in `USING` clause (not allowed)

**Without seeing current policies, likely cause**: Policy might be using a function or view that queries `events` table, creating recursion.

**New policies look safe** - they only reference `auth.uid()` and direct column comparison.

### Queries That Will Break

**Before column rename**:
- ❌ All queries will fail (column `organizer_id` doesn't exist)

**After column rename**:
- ✅ All queries should work (assuming code is updated)

### Backup Recommendation

**YES - Backup before changing policies!**

```sql
-- Backup current policies
SELECT * FROM pg_policies WHERE tablename = 'events';

-- Backup data
CREATE TABLE events_backup AS SELECT * FROM events;
```

---

## CHANGE 3: Add Missing Columns to Events Table

### Proposed Columns

1. `budget NUMERIC(10, 2) DEFAULT 0`
2. `actual_cost NUMERIC(10, 2) DEFAULT 0`
3. `expected_attendance INTEGER DEFAULT 0`
4. `venue_id UUID REFERENCES venues(id)`

### Current State Analysis

#### Column: `budget`
- **Status**: ✅ Already exists in TypeScript types (`budget: number | null`)
- **Status**: ✅ Already used in 15+ files
- **Status**: ❓ Unknown if exists in database
- **Impact**: If column doesn't exist, all queries referencing it will fail

**Files Using `budget`**:
- `app/api/builder/stats/route.ts`
- `app/(dashboard)/builder/page.tsx`
- `app/(dashboard)/builder/event/[eventId]/page.tsx`
- `app/(dashboard)/builder/analytics/page.tsx`
- `components/shared/EventCard.tsx`
- `components/forms/EventForm.tsx`
- `components/builder/event-wizard/EventFinalizeStep.tsx`
- `components/builder/event-wizard/EventPlanningStep.tsx`
- `app/(dashboard)/builder/upcoming/page.tsx`
- `app/(dashboard)/builder/events/page.tsx`
- `app/(dashboard)/builder/past/page.tsx`
- `lib/hooks/useEvents.ts`

#### Column: `actual_cost`
- **Status**: ❌ Not in TypeScript types
- **Status**: ❌ Not used anywhere in codebase
- **Impact**: Safe to add (no code changes needed)

#### Column: `expected_attendance`
- **Status**: ⚠️ TypeScript has `expected_attendees` (plural)
- **Status**: ⚠️ Code uses `expected_attendance_min` and `expected_attendance_max`
- **Impact**: **NAMING CONFLICT** - need to clarify naming

**Current Usage**:
- `expected_attendees` (singular) - in TypeScript types
- `expected_attendance_min` - in API routes
- `expected_attendance_max` - in API routes

**Recommendation**: Use `expected_attendees` to match existing TypeScript, OR update TypeScript to match new column name.

#### Column: `venue_id`
- **Status**: ✅ Already exists in TypeScript types (`venue_id: string | null`)
- **Status**: ✅ Already used in 20+ files
- **Status**: ❓ Unknown if exists in database
- **Impact**: If column doesn't exist, all queries referencing it will fail

**Files Using `venue_id`**:
- `app/api/builder/events/[id]/route.ts`
- `app/(dashboard)/builder/page.tsx`
- `app/(dashboard)/builder/event/[eventId]/page.tsx`
- `components/builder/event-wizard/EventFinalizeStep.tsx`
- `components/builder/event-wizard/EventVenueStep.tsx`
- `app/(dashboard)/builder/upcoming/page.tsx`
- `app/(dashboard)/builder/events/page.tsx`
- `app/(dashboard)/builder/analytics/page.tsx`
- And 10+ more files

### Database Constraints

**Foreign Key Constraint**:
```sql
venue_id UUID REFERENCES venues(id)
```

**Potential Issues**:
1. If `venues(id)` doesn't exist, constraint will fail
2. If existing events have invalid `venue_id` values, constraint will fail
3. Need to handle NULL values (should be allowed)

**Recommendation**: Make foreign key nullable and add constraint:
```sql
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;
```

### TypeScript Type Updates Needed

**File**: `lib/types/database.ts`

**Current**:
```typescript
export interface Event {
  budget: number | null  // ✅ Exists
  venue_id: string | null  // ✅ Exists
  expected_attendees: number | null  // ⚠️ Different name
  // actual_cost: missing
}
```

**Required Updates**:
```typescript
export interface Event {
  budget: number | null  // ✅ Already correct
  actual_cost: number | null  // ➕ Add this
  expected_attendance: number | null  // ⚠️ Rename from expected_attendees OR keep both
  venue_id: string | null  // ✅ Already correct
}
```

---

## Dependency Tree

```
lib/auth.ts
├── app/(dashboard)/layout.tsx (Server Component) ✅
│   └── getUserType()
│
└── 20 Client Components ❌
    └── getCurrentUser()
        ├── app/(dashboard)/venue/calendar/page.tsx
        ├── app/(dashboard)/[userType]/notifications/page.tsx
        ├── app/(dashboard)/builder/event/[eventId]/page.tsx
        ├── app/(dashboard)/builder/analytics/page.tsx
        ├── app/(dashboard)/vendor/calendar/page.tsx
        ├── app/(dashboard)/vendor/pricing/page.tsx
        ├── app/(dashboard)/vendor/bookings/page.tsx
        ├── app/(dashboard)/vendor/services/page.tsx
        ├── app/(dashboard)/venue/listing/page.tsx
        ├── app/(dashboard)/venue/requirements/page.tsx
        ├── app/(dashboard)/venue/pricing/page.tsx
        ├── app/(dashboard)/[userType]/messages/page.tsx
        ├── app/(dashboard)/venue/confirmed/page.tsx
        ├── app/(dashboard)/venue/requests/page.tsx
        ├── app/(dashboard)/builder/vendors/page.tsx
        ├── app/(dashboard)/builder/venues/page.tsx
        ├── app/(dashboard)/builder/upcoming/page.tsx
        ├── app/(dashboard)/builder/events/page.tsx
        └── app/(dashboard)/builder/past/page.tsx

events.builder_id
├── API Routes (6 files)
│   ├── app/api/builder/stats/route.ts
│   ├── app/api/builder/events/route.ts
│   ├── app/api/builder/events/[id]/route.ts
│   ├── app/api/venue/requests/route.ts
│   ├── app/api/vendor/bookings/route.ts
│   └── app/api/venue/bookings/[id]/route.ts
│
├── Components (5 files)
│   ├── app/(dashboard)/venue/page.tsx
│   ├── app/(dashboard)/vendor/page.tsx
│   ├── app/(dashboard)/builder/event/[eventId]/page.tsx
│   ├── components/vendor/BookingDetailModal.tsx
│   └── components/venue/BookingDetailModal.tsx
│
└── Types (1 file)
    └── lib/types/database.ts

events.budget
├── API Routes (1 file)
│   └── app/api/builder/stats/route.ts
│
├── Components (12 files)
│   └── [Various dashboard and form components]
│
└── Types (1 file)
    └── lib/types/database.ts (already defined)

events.venue_id
├── API Routes (3 files)
│   ├── app/api/builder/events/[id]/route.ts
│   ├── app/api/venue/requests/route.ts
│   └── app/api/vendor/bookings/route.ts
│
├── Components (15+ files)
│   └── [Various dashboard and wizard components]
│
└── Types (1 file)
    └── lib/types/database.ts (already defined)
```

---

## Risk Assessment

### CHANGE 1: Delete `/lib/auth.ts`

| Risk Level | Component | Impact |
|------------|-----------|--------|
| **CRITICAL** | 20 Client Components | App will crash on load (already broken due to `'server-only'`) |
| **HIGH** | 1 Server Component | Layout won't determine userType correctly |
| **LOW** | Build Process | TypeScript errors during build |

**Overall Risk**: **HIGH** - But these are already broken, so fixing them is necessary

### CHANGE 2: RLS Policy Changes (builder_id → organizer_id)

| Risk Level | Component | Impact |
|------------|-----------|--------|
| **CRITICAL** | Database Schema | Column rename must happen FIRST or policies fail |
| **CRITICAL** | All Event Queries | Will fail if column doesn't exist |
| **HIGH** | 6 API Routes | Must update all `builder_id` references |
| **HIGH** | 5 Components | Must update all `builder_id` references |
| **MEDIUM** | Type Definitions | Must update TypeScript types |
| **LOW** | Test Files | Must update test mocks |

**Overall Risk**: **CRITICAL** - Column rename is a breaking change that must be coordinated

### CHANGE 3: Add Missing Columns

| Risk Level | Component | Impact |
|------------|-----------|--------|
| **MEDIUM** | `budget` column | If missing, 12+ files will fail |
| **LOW** | `actual_cost` column | New column, no existing usage |
| **MEDIUM** | `expected_attendance` | Naming conflict with `expected_attendees` |
| **MEDIUM** | `venue_id` column | If missing, 15+ files will fail |
| **LOW** | Foreign Key Constraint | May fail if invalid data exists |

**Overall Risk**: **MEDIUM** - Depends on current database state

---

## Recommended Implementation Order

### Phase 1: Fix Existing Issues (CHANGE 1) - **DO FIRST**

**Priority**: CRITICAL (these are already broken)

1. **Fix all 20 client components** to use `useUser()` hook
   - Estimated time: 2-3 hours
   - Risk: Low (straightforward find/replace)
   - Can be done incrementally

2. **Update server component** (`app/(dashboard)/layout.tsx`)
   - Replace `getUserType()` with API call or inline logic
   - Estimated time: 30 minutes
   - Risk: Low

3. **Delete `lib/auth.ts`**
   - After all imports are removed
   - Estimated time: 5 minutes
   - Risk: Low

**Can dev server run during this?**: ✅ Yes, but pages will crash until fixed

**Restart needed?**: ✅ Yes, after each file change (Next.js hot reload)

---

### Phase 2: Database Schema Changes (CHANGE 3) - **DO SECOND**

**Priority**: HIGH (needed for app functionality)

1. **Verify current database state**
   ```sql
   -- Check which columns exist
   SELECT column_name, data_type, is_nullable 
   FROM information_schema.columns 
   WHERE table_name = 'events';
   ```

2. **Add missing columns** (in order):
   ```sql
   -- Step 1: Add budget (if missing)
   ALTER TABLE events 
   ADD COLUMN IF NOT EXISTS budget NUMERIC(10, 2) DEFAULT 0;
   
   -- Step 2: Add actual_cost (new, safe)
   ALTER TABLE events 
   ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(10, 2) DEFAULT 0;
   
   -- Step 3: Add expected_attendance (resolve naming first!)
   -- DECISION NEEDED: Use expected_attendance or expected_attendees?
   ALTER TABLE events 
   ADD COLUMN IF NOT EXISTS expected_attendance INTEGER DEFAULT 0;
   
   -- Step 4: Add venue_id (if missing, with foreign key)
   ALTER TABLE events 
   ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;
   ```

3. **Update TypeScript types** (`lib/types/database.ts`)
   - Add `actual_cost: number | null`
   - Resolve `expected_attendance` vs `expected_attendees` naming
   - Verify `budget` and `venue_id` are correct

**Can dev server run during this?**: ✅ Yes, but queries may fail until columns exist

**Restart needed?**: ✅ Yes, after TypeScript type updates

**Data migration needed?**: 
- ✅ Yes - if `budget` or `venue_id` exist with different defaults
- ❌ No - new columns have defaults

**Existing data preserved?**: ✅ Yes - `DEFAULT` values applied to existing rows

---

### Phase 3: RLS Policy Changes (CHANGE 2) - **DO LAST**

**Priority**: HIGH (security-critical)

**⚠️ CRITICAL PREREQUISITE**: Must rename `builder_id` to `organizer_id` FIRST!

1. **Backup current state**
   ```sql
   -- Backup policies
   SELECT * FROM pg_policies WHERE tablename = 'events';
   
   -- Backup data
   CREATE TABLE events_backup AS SELECT * FROM events;
   ```

2. **Rename column** (BREAKING CHANGE)
   ```sql
   -- Check for foreign key constraints first
   SELECT conname, contype 
   FROM pg_constraint 
   WHERE conrelid = 'events'::regclass;
   
   -- Rename column
   ALTER TABLE events 
   RENAME COLUMN builder_id TO organizer_id;
   
   -- Update foreign key constraint name (if exists)
   ALTER TABLE events 
   RENAME CONSTRAINT events_builder_id_fkey TO events_organizer_id_fkey;
   ```

3. **Update all code references** (15+ files)
   - API routes: `builder_id` → `organizer_id`
   - Components: `builder_id` → `organizer_id`
   - Types: `builder_id` → `organizer_id`

4. **Drop old policies**
   ```sql
   DROP POLICY IF EXISTS "Users can read own events" ON events;
   DROP POLICY IF EXISTS "Users can create own events" ON events;
   DROP POLICY IF EXISTS "Users can update own events" ON events;
   DROP POLICY IF EXISTS "Users can delete own events" ON events;
   ```

5. **Create new policies**
   ```sql
   CREATE POLICY "Enable read for users based on organizer_id"
     ON events FOR SELECT
     USING (auth.uid() = organizer_id);

   CREATE POLICY "Enable insert for authenticated users"
     ON events FOR INSERT
     WITH CHECK (auth.uid() = organizer_id);

   CREATE POLICY "Enable update for users based on organizer_id"
     ON events FOR UPDATE
     USING (auth.uid() = organizer_id);

   CREATE POLICY "Enable delete for users based on organizer_id"
     ON events FOR DELETE
     USING (auth.uid() = organizer_id);
   ```

**Can dev server run during this?**: ❌ **NO** - App will be completely broken during column rename

**Restart needed?**: ✅ Yes, after all changes

**Data migration needed?**: ❌ No - column rename preserves data

**Existing data preserved?**: ✅ Yes - column rename is metadata-only operation

**Rollback plan**: 
```sql
-- If something goes wrong
ALTER TABLE events RENAME COLUMN organizer_id TO builder_id;
-- Restore policies from backup
```

---

## Files That Need Updates

### CHANGE 1: Delete `lib/auth.ts`

**Total: 21 files**

1. `app/(dashboard)/layout.tsx` - Replace `getUserType()` 
2-21. 20 client component pages - Replace `getCurrentUser()` with `useUser()`

### CHANGE 2: RLS Policy (builder_id → organizer_id)

**Total: 15+ files**

**API Routes (6 files)**:
1. `app/api/builder/stats/route.ts`
2. `app/api/builder/events/route.ts`
3. `app/api/builder/events/[id]/route.ts`
4. `app/api/venue/requests/route.ts`
5. `app/api/vendor/bookings/route.ts`
6. `app/api/venue/bookings/[id]/route.ts`

**Components (5 files)**:
7. `app/(dashboard)/venue/page.tsx`
8. `app/(dashboard)/vendor/page.tsx`
9. `app/(dashboard)/builder/event/[eventId]/page.tsx`
10. `components/vendor/BookingDetailModal.tsx`
11. `components/venue/BookingDetailModal.tsx`

**Types (1 file)**:
12. `lib/types/database.ts`

**Tests (1 file)**:
13. `lib/test-utils.tsx`

**Documentation (2 files)**:
14. `PROJECT_SUMMARY.md`
15. `API_ROUTES.md`

### CHANGE 3: Add Missing Columns

**Total: 1-2 files**

**Types (1 file)**:
1. `lib/types/database.ts` - Add `actual_cost`, resolve `expected_attendance` naming

**Code (0-1 files)**:
- If `budget` or `venue_id` don't exist: All files using them will fail (but code already expects them)

---

## Critical Blockers

### 🔴 CRITICAL: Must Fix Before Anything Works

1. **CHANGE 1**: 20 client components importing `@/lib/auth` - **Already broken**, must fix first
2. **CHANGE 2**: Column rename (`builder_id` → `organizer_id`) - **Must happen before RLS policy changes**

### 🟡 HIGH PRIORITY: Causes Errors But App Partially Works

1. **CHANGE 3**: Missing `budget` column - 12+ files will fail if column doesn't exist
2. **CHANGE 3**: Missing `venue_id` column - 15+ files will fail if column doesn't exist
3. **CHANGE 2**: Code references to `builder_id` - Will fail after column rename

### 🟢 MEDIUM PRIORITY: Causes Warnings But Everything Works

1. **CHANGE 3**: `actual_cost` column - New column, no immediate impact
2. **CHANGE 3**: `expected_attendance` naming conflict - Needs resolution

### ⚪ LOW PRIORITY: Nice to Have, No Immediate Impact

1. Documentation updates
2. Test file updates

---

## Answers to Specific Questions

### CHANGE 1 Questions

**Q: Can we just remove 'server-only' instead of deleting?**
**A**: ❌ **NOT RECOMMENDED** - This defeats the architectural improvements and allows server code in client bundles. Better to fix the 20 broken client components properly.

### CHANGE 2 Questions

**Q: What's causing the infinite recursion in the current policy?**
**A**: Without seeing current policies, likely causes:
- Policy uses a function/view that queries `events` table
- Policy has circular dependency
- Policy uses `SELECT` in `USING` clause

**New policies look safe** - they only use `auth.uid()` and direct column comparison.

**Q: Will these new policies maintain the same security guarantees?**
**A**: ✅ **YES** - Assuming column rename happens first. Security is identical, just using different column name.

**Q: Are there any queries that will break with the new policies?**
**A**: ❌ **ALL queries will break** if column rename doesn't happen first (column `organizer_id` won't exist).

**Q: Should we backup data before changing policies?**
**A**: ✅ **YES** - Always backup before schema changes:
```sql
CREATE TABLE events_backup AS SELECT * FROM events;
SELECT * FROM pg_policies WHERE tablename = 'events';
```

### CHANGE 3 Questions

**Q: What files currently reference these columns?**
**A**: 
- `budget`: 12+ files (already in use)
- `venue_id`: 15+ files (already in use)
- `actual_cost`: 0 files (new column)
- `expected_attendance`: 0 files (naming conflict to resolve)

**Q: Will existing events table records be affected?**
**A**: ✅ **NO** - `DEFAULT` values will be applied to existing rows:
- `budget`: Defaults to `0`
- `actual_cost`: Defaults to `0`
- `expected_attendance`: Defaults to `0`
- `venue_id`: Defaults to `NULL`

**Q: Are there any database constraints that might fail?**
**A**: ⚠️ **POTENTIAL ISSUE**: Foreign key constraint on `venue_id`:
- Will fail if `venues(id)` doesn't exist
- Will fail if existing events have invalid `venue_id` values
- **Solution**: Use `ON DELETE SET NULL` and validate data first

**Q: Do any TypeScript types need updating?**
**A**: ✅ **YES**:
- Add `actual_cost: number | null` to `Event` interface
- Resolve `expected_attendance` vs `expected_attendees` naming conflict
- Verify `budget` and `venue_id` are correct (they already exist in types)

---

## General Analysis

### Can I make these changes while the dev server is running?

| Change | Dev Server Running? |
|--------|---------------------|
| **CHANGE 1** (Fix imports) | ✅ Yes - but pages will crash until fixed |
| **CHANGE 3** (Add columns) | ✅ Yes - but queries may fail until columns exist |
| **CHANGE 2** (Column rename) | ❌ **NO** - App will be completely broken |

### Do I need to restart the server after each change?

| Change | Restart Needed? |
|--------|----------------|
| **CHANGE 1** (Code changes) | ✅ Yes - Next.js hot reload, but restart recommended |
| **CHANGE 3** (Schema changes) | ✅ Yes - After TypeScript type updates |
| **CHANGE 2** (Schema + code) | ✅ Yes - After all changes complete |

### Are there any data migrations needed?

| Change | Migration Needed? |
|--------|-------------------|
| **CHANGE 1** | ❌ No |
| **CHANGE 2** | ❌ No - Column rename is metadata-only |
| **CHANGE 3** | ⚠️ Maybe - If `budget` or `venue_id` exist with different defaults, may need data migration |

### Will existing user data be preserved?

| Change | Data Preserved? |
|--------|----------------|
| **CHANGE 1** | ✅ Yes - No data changes |
| **CHANGE 2** | ✅ Yes - Column rename preserves all data |
| **CHANGE 3** | ✅ Yes - New columns get defaults, existing data unchanged |

---

## Missing Steps & Considerations

### Missing Steps

1. **Verify database schema** - Check which columns actually exist before making assumptions
2. **Resolve naming conflict** - Decide on `expected_attendance` vs `expected_attendees`
3. **Test foreign key constraint** - Verify `venues(id)` exists and is valid
4. **Update Supabase types** - Regenerate TypeScript types from database after schema changes
5. **Update API documentation** - If `API_ROUTES.md` exists, update it

### Additional Considerations

1. **Migration script** - Consider creating a migration script for CHANGE 2
2. **Feature flags** - Consider feature flagging the column rename for gradual rollout
3. **Monitoring** - Monitor error logs after each change
4. **Rollback plan** - Have SQL rollback scripts ready for CHANGE 2
5. **Testing** - Test each change in isolation before combining

---

## Final Recommendations

### Safest Implementation Order

1. **Phase 1**: Fix CHANGE 1 (Delete `lib/auth.ts`)
   - Fix 20 client components
   - Update 1 server component
   - Delete file
   - **Time**: 3-4 hours
   - **Risk**: Low

2. **Phase 2**: Implement CHANGE 3 (Add columns)
   - Verify current schema
   - Add missing columns
   - Update TypeScript types
   - **Time**: 1-2 hours
   - **Risk**: Medium

3. **Phase 3**: Implement CHANGE 2 (RLS policies)
   - Backup everything
   - Rename column
   - Update all code references
   - Update RLS policies
   - **Time**: 2-3 hours
   - **Risk**: High (but manageable with backup)

### Total Estimated Time: 6-9 hours

### Risk Level: **MEDIUM-HIGH** (due to CHANGE 2 column rename)

### Rollback Strategy

1. **CHANGE 1**: Git revert (code changes only)
2. **CHANGE 3**: Drop columns (if needed)
3. **CHANGE 2**: Rename column back + restore policies from backup

---

**END OF ANALYSIS**
