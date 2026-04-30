# Signup flow and Supabase

## How the signup flow works (UI → API → Supabase)

The flow you want is:

1. **Splash** → user taps “Sign up”
2. **Select role** → user picks a card: Community Builder, Venue Owner, or Vendor
3. **Enter details** → user enters name, email, and password (and for venue/vendor maybe venue name, capacity, etc.)
4. **Submit** → app creates the account and (if you enable it) Supabase can send a confirmation email

Here’s how that connects to the signup API and Supabase.

### 1. UI (signup page)

- **Step “select-type”**  
  User sees “Join 3rdSpace” and either “Continue with Google” or three role cards.  
  Choosing a card saves the role in React state as `userType`: `'community_builder'` | `'venue_owner'` | `'vendor'` and moves to the form step.

- **Step “form”**  
  The form depends on `userType` (builder / venue / vendor). User fills:
  - **All:** name, email, password  
  - **Venue:** plus venue name, type, capacity, phone  
  - **Vendor:** plus business name, service type, service area, phone  

  On submit, the frontend **POSTs to `/api/auth/signup`** with a body like:

  ```json
  {
    "userType": "community_builder",
    "email": "…",
    "password": "…",
    "name": "…"
  }
  ```

  (Venue/vendor forms add their extra fields.)

### 2. API (`/api/auth/signup`)

The signup route:

1. **Maps role**  
   `userType` → `role`:  
   `community_builder` → `'builder'`, `venue_owner` → `'owner'`, `vendor` → `'vendor'`.

2. **Creates the auth user**  
   Calls Supabase Auth:

   ```ts
   supabase.auth.signUp({
     email,
     password,
     options: {
       data: {
         role,           // for trigger / OAuth
         user_type: userType,
         company_name: companyName,  // from name
       },
       emailRedirectTo: `${origin}/auth/callback`,  // for confirmation email
     },
   })
   ```

   That creates a row in **`auth.users`** and stores `role`, `user_type`, and `company_name` in **metadata** (so the DB trigger and OAuth can use them).

3. **Creates the app user**  
   Inserts into **`public.users`** with `id`, `email`, `role`, `user_type`, `company_name`, `email_verified`.  
   If the trigger already inserted the same row (e.g. with `ON CONFLICT DO NOTHING`), the API treats the duplicate as success and continues.

4. **Optional venue/vendor**  
   For venue owner or vendor, the API may also insert into `venues` or `vendors` when the form sent the extra fields.

5. **Response**  
   Returns `{ success: true, user: { id, email } }`. The frontend then redirects to `/onboarding` (or dashboard).

### 3. Supabase (auth + trigger)

- **Auth**  
  `signUp` creates the user in `auth.users` and can send the confirmation email if “Confirm email” is enabled in **Authentication → Providers → Email**. The link uses `emailRedirectTo` and lands on `/auth/callback`, which exchanges the token and redirects to the right dashboard.

- **Trigger `on_auth_user_created`**  
  When a row is inserted into `auth.users`, this trigger runs. If you **fix the trigger** so it inserts into `public.users` using the new user’s **metadata** (`role`, `user_type`, `company_name`) and uses **`ON CONFLICT (id) DO NOTHING`**:
  - **Email/password signup (via your API):** API creates `auth.users` then `public.users`; if the trigger runs too, the trigger’s insert is a no-op. No error.
  - **OAuth or magic link (no API):** Trigger creates `public.users` from metadata. So every way of creating a user results in exactly one row in `public.users`.

So: **role card** → `userType` → form (name, email, password, …) → **POST /api/auth/signup** → **Supabase Auth** (and optional confirmation email) + **trigger** + **API** both ensure **`public.users`** has one row. The signup flow you described is already wired; the only backend piece to align is the trigger (see below).

---

# Fix "Database error saving new user" – `on_auth_user_created` trigger

You have a custom trigger **`on_auth_user_created`** on `auth.users`. When it runs (on signup), something in its function fails and Supabase returns the generic database error.

## Step 1: See what the trigger does

Run this in **Supabase Dashboard → SQL Editor**:

```sql
-- Which function does on_auth_user_created call?
SELECT
  t.tgname AS trigger_name,
  p.proname AS function_name,
  n.nspname AS schema_name
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE t.tgrelid = 'auth.users'::regclass
  AND NOT t.tgisinternal
  AND t.tgname = 'on_auth_user_created';
```

Note the **schema_name** and **function_name** (e.g. `public.handle_new_user`).

To see the function body (so you can fix it):

```sql
-- Replace 'public.handle_new_user' with your schema_name.function_name from above
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'handle_new_user';  -- use your function_name
```

## Step 2: Fix or disable the trigger

### Option A: Temporarily disable the trigger (fastest way to get signup working)

Your app already creates the row in `public.users` in the signup API route. So the trigger may be redundant. You can disable it:

```sql
-- Disable the trigger (signup will work; your API creates public.users)
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
```

To turn it back on later:

```sql
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
```

### Option B: Fix the trigger function instead

If the trigger is meant to insert into `public.users` or `public.profiles`:

1. Open the function (from Step 1) and check:
   - Column names match your table (e.g. `role`, `user_type`, `company_name`).
   - It doesn’t reference columns that don’t exist.
2. If it inserts into `public.users`, RLS must allow that insert. Options:
   - Use a **SECURITY DEFINER** function so it runs with elevated privileges, or
   - Add an RLS policy that allows insert when `auth.uid() = id` (or the appropriate condition).

After changing the function or RLS, try signup again.

## Step 3: Confirm signup works

Try signing up again. If you disabled the trigger (Option A), it should succeed and your API route will create the `public.users` row as before.
