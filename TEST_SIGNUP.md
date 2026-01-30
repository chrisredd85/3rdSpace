# Signup Flow Testing Guide

This document provides comprehensive test logic and checklists for testing all three signup processes.

## Quick Test Commands

```bash
# Run all signup E2E tests
npm run test:e2e e2e/signup.spec.ts

# Run tests in UI mode (interactive)
npm run test:e2e:ui e2e/signup.spec.ts

# Run specific test suite
npm run test:e2e e2e/signup.spec.ts -g "Community Builder"
```

## Manual Testing Checklist

### Pre-Test Setup
- [ ] Dev server is running (`npm run dev`)
- [ ] Database is accessible
- [ ] Supabase environment variables are set
- [ ] Clear browser cookies/localStorage before each test

### Test 1: Community Builder Signup

#### Steps:
1. Navigate to `/signup`
2. Verify page loads with all three user type cards
3. Click "Community Builder" card
4. Verify form appears with:
   - Full Name field
   - Email field
   - Password field
   - "Create account" button
   - "Back" button
5. Fill out form:
   - Full Name: "Test Builder"
   - Email: "test-builder-{timestamp}@example.com"
   - Password: "TestPassword123!"
6. Click "Create account"
7. Verify:
   - Success toast appears
   - Redirects to `/builder` dashboard
   - User is logged in

#### Expected Results:
- ✅ Form validates required fields
- ✅ Account is created in Supabase Auth
- ✅ Profile record is created in `profiles` table
- ✅ User type is set to `community_builder`
- ✅ Redirects to builder dashboard

#### Edge Cases to Test:
- [ ] Empty form submission (should show validation errors)
- [ ] Invalid email format (should show error)
- [ ] Password too short (< 6 chars) (should show error)
- [ ] Duplicate email (should show error)
- [ ] Click "Back" button (should return to user type selection)

---

### Test 2: Venue Owner Signup

#### Steps:
1. Navigate to `/signup`
2. Click "Venue Owner" card
3. Verify form appears with:
   - Venue Name field
   - Contact Name field
   - Email field
   - Phone field
   - Venue Type dropdown
   - Capacity field
   - Password field
4. Fill out form:
   - Venue Name: "Test Venue"
   - Contact Name: "John Doe"
   - Email: "test-venue-{timestamp}@example.com"
   - Phone: "5551234567"
   - Venue Type: "Loft/Warehouse"
   - Capacity: "100"
   - Password: "TestPassword123!"
5. Click "Create account"
6. Verify:
   - Success toast appears
   - Redirects to `/venue` dashboard
   - User is logged in

#### Expected Results:
- ✅ Form validates all required fields
- ✅ Account is created in Supabase Auth
- ✅ Profile record is created
- ✅ Venue record is created in `venues` table with:
     - `owner_id` matches user ID
     - `name` matches venue name
     - `venue_type` matches selection
     - `capacity` matches input
     - `is_active` is `false`
     - `is_verified` is `false`
- ✅ Redirects to venue dashboard

#### Edge Cases to Test:
- [ ] Empty form submission
- [ ] Invalid email format
- [ ] Capacity = 0 (should show error)
- [ ] Missing venue type selection
- [ ] Phone number validation
- [ ] Click "Back" button

---

### Test 3: Vendor Signup

#### Steps:
1. Navigate to `/signup`
2. Click "Vendor" card
3. Verify form appears with:
   - Business Name field
   - Your Name field
   - Email field
   - Phone field
   - Service Type dropdown
   - Service Area field
   - Password field
4. Fill out form:
   - Business Name: "Test Catering Co"
   - Your Name: "Jane Smith"
   - Email: "test-vendor-{timestamp}@example.com"
   - Phone: "5559876543"
   - Service Type: "Catering"
   - Service Area: "San Francisco, CA"
   - Password: "TestPassword123!"
5. Click "Create account"
6. Verify:
   - Success toast appears
   - Redirects to `/vendor` dashboard
   - User is logged in

#### Expected Results:
- ✅ Form validates all required fields
- ✅ Account is created in Supabase Auth
- ✅ Profile record is created
- ✅ Vendor record is created in `vendors` table with:
     - `owner_id` matches user ID
     - `name` matches business name
     - `business_name` matches input
     - `service_type` matches selection
     - `is_active` is `false`
     - `is_verified` is `false`
- ✅ Redirects to vendor dashboard

#### Edge Cases to Test:
- [ ] Empty form submission
- [ ] Invalid email format
- [ ] Missing service type selection
- [ ] Service area validation
- [ ] Click "Back" button

---

### Test 4: Google OAuth Signup

#### Steps:
1. Navigate to `/signup`
2. Verify "Continue with Google" button is visible
3. Click "Continue with Google"
4. Verify redirect to Google OAuth
5. Complete Google authentication
6. Verify redirect back to `/auth/callback`
7. Verify redirect to appropriate dashboard

#### Expected Results:
- ✅ Google OAuth button is visible and clickable
- ✅ Redirects to Google OAuth page
- ✅ After authentication, user is created
- ✅ Profile is created with user type (may need to be set manually)
- ✅ Redirects to dashboard

#### Edge Cases to Test:
- [ ] OAuth cancellation (user cancels Google auth)
- [ ] OAuth error handling
- [ ] Existing user with OAuth (should handle gracefully)

---

## API Route Testing

### Test the Signup API Directly

```bash
# Test Community Builder signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "userType": "community_builder",
    "email": "test-api@example.com",
    "password": "TestPassword123!",
    "name": "Test User"
  }'

# Test Venue Owner signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "userType": "venue_owner",
    "email": "test-venue-api@example.com",
    "password": "TestPassword123!",
    "name": "John Doe",
    "venue_name": "Test Venue",
    "venue_type": "loft_warehouse",
    "capacity": 100,
    "phone": "5551234567"
  }'

# Test Vendor signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "userType": "vendor",
    "email": "test-vendor-api@example.com",
    "password": "TestPassword123!",
    "name": "Jane Smith",
    "business_name": "Test Catering Co",
    "service_type": "catering",
    "service_area": "San Francisco, CA",
    "phone": "5559876543"
  }'
```

### Expected API Responses

#### Success Response:
```json
{
  "success": true,
  "user": {
    "id": "user-uuid",
    "email": "test@example.com"
  }
}
```

#### Error Response:
```json
{
  "error": "Error message here"
}
```

---

## Database Verification

After each signup, verify in Supabase:

### 1. Auth Users Table
```sql
SELECT id, email, created_at, raw_user_meta_data
FROM auth.users
WHERE email = 'test-{type}@example.com';
```

### 2. Profiles Table
```sql
SELECT id, email, name, user_type, created_at
FROM profiles
WHERE email = 'test-{type}@example.com';
```

### 3. Venues Table (for venue owners)
```sql
SELECT id, owner_id, name, venue_type, capacity, is_active, is_verified
FROM venues
WHERE owner_id = 'user-uuid';
```

### 4. Vendors Table (for vendors)
```sql
SELECT id, owner_id, name, business_name, service_type, is_active, is_verified
FROM vendors
WHERE owner_id = 'user-uuid';
```

---

## Common Issues & Solutions

### Issue: "Missing Supabase environment variables"
**Solution:** Check `.env.local` has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Issue: "Failed to create account"
**Solution:** 
- Check Supabase project is active
- Verify email isn't already registered
- Check network tab for API errors

### Issue: "Redirect not working"
**Solution:**
- Verify middleware isn't blocking
- Check user session is created
- Verify dashboard routes exist

### Issue: "Database insert fails"
**Solution:**
- Check RLS policies allow inserts
- Verify table structure matches
- Check foreign key constraints

---

## Performance Testing

- [ ] Signup completes in < 3 seconds
- [ ] Form validation is instant
- [ ] API response time < 1 second
- [ ] No console errors
- [ ] No network errors

---

## Accessibility Testing

- [ ] All form fields are keyboard navigable
- [ ] Labels are properly associated with inputs
- [ ] Error messages are announced to screen readers
- [ ] Focus management works correctly
- [ ] Color contrast meets WCAG standards

---

## Browser Compatibility

Test on:
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)
